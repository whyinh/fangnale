import { Router } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth } from "../middleware/auth.js";
import {
  isPremium,
  getActiveMembership,
  getQuota,
  getAskCountToday,
  logAskUsage,
  FREE_ASK_DAILY_LIMIT,
} from "../utils/premium.js";

const router = Router();
const client = getSupabaseClient();

/**
 * GET /api/v1/premium
 * 当前用户的会员状态与配额用量。
 * 响应：{ isPremium, plan, expiresAt, quota: { itemsUsed, itemsLimit, asksUsedToday, asksDailyLimit } }
 * （limit 为 null 表示不限量）
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const premium = await isPremium(userId);
    const [membership, quota] = await Promise.all([
      premium ? getActiveMembership(userId) : Promise.resolve(null),
      getQuota(userId, premium),
    ]);
    res.json({
      isPremium: premium,
      plan: membership?.plan ?? null,
      expiresAt: membership?.expiresAt ?? null,
      provider: membership?.provider ?? null,
      quota,
    });
  } catch (error: any) {
    console.error("[premium] 获取会员状态失败:", error?.message);
    res.status(500).json({ error: "获取会员状态失败" });
  }
});

/**
 * POST /api/v1/premium/usage/ask
 * 记录一次问 AI 使用（问 AI 面板发起会话时调用，用于免费用户每日 3 次额度统计）。
 */
router.post("/usage/ask", requireAuth, async (req, res) => {
  try {
    await logAskUsage(req.userId!);
    const used = await getAskCountToday(req.userId!);
    return res.json({ used, limit: FREE_ASK_DAILY_LIMIT });
  } catch (e) {
    console.error("record usage error:", e);
    return res.status(500).json({ error: "记录失败" });
  }
});

/**
 * POST /api/v1/premium/dev-activate
 * 【开发模式专用】直接开通会员，用于在 Apple IAP 接入前验证完整业务链路。
 * Body: { plan: 'monthly' | 'yearly' }
 * 生产环境（NODE_ENV=production）自动关闭；上架前由 /iap-verify 替代。
 */
router.post("/dev-activate", requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "生产环境不可用", code: "DEV_ONLY" });
  }
  try {
    const userId = req.userId!;
    const rawPlan = req.body?.plan;
    if (rawPlan !== undefined && rawPlan !== "monthly" && rawPlan !== "yearly" && rawPlan !== "lifetime") {
      return res.status(400).json({ error: "无效的套餐类型", code: "INVALID_PLAN" });
    }
    const plan = rawPlan === "lifetime" ? "lifetime" : rawPlan === "yearly" ? "yearly" : "monthly";

    // 终身会员为最高级：已是终身则直接返回当前状态，禁止任何变更写入（防误操作降级丢失买断权益）
    const current = await getActiveMembership(userId);
    if (current?.plan === "lifetime") {
      return res.json({ ok: true, plan: "lifetime", expiresAt: null, unchanged: true });
    }

    // 终身会员无到期时间；月度 30 天，年度 365 天
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (plan === "yearly" ? 365 : 30));

    // 幂等：已有有效会员则顺延覆盖（避免重复记录）
    const { error } = await client.from("premium_memberships").insert({
      user_id: userId,
      plan,
      status: "active",
      provider: "dev_grant",
      expires_at: plan === "lifetime" ? null : expiresAt.toISOString(),
    });
    if (error) {
      console.error("[premium] 开发模式开通失败:", error.message);
      return res.status(500).json({ error: "开通失败，请重试" });
    }
    res.json({ ok: true, plan, expiresAt: plan === "lifetime" ? null : expiresAt.toISOString() });
  } catch (error: any) {
    console.error("[premium] 开发模式开通异常:", error?.message);
    res.status(500).json({ error: "开通失败，请重试" });
  }
});

/**
 * POST /api/v1/premium/dev-deactivate
 * 【开发模式专用】关闭当前会员（便于测试免费配额拦截逻辑）。
 */
router.post("/dev-deactivate", requireAuth, async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "生产环境不可用", code: "DEV_ONLY" });
  }
  try {
    const userId = req.userId!;
    const { error } = await client
      .from("premium_memberships")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");
    if (error) {
      console.error("[premium] 开发模式关闭失败:", error.message);
      return res.status(500).json({ error: "操作失败，请重试" });
    }
    res.json({ ok: true });
  } catch (error: any) {
    console.error("[premium] 开发模式关闭异常:", error?.message);
    res.status(500).json({ error: "操作失败，请重试" });
  }
});

/**
 * POST /api/v1/premium/iap-sync
 * 【App Store IAP】客户端 RevenueCat 扣款成功后调用。
 * 服务端用 RevenueCat Secret API Key 查询该用户的 entitlement，
 * 校验有效才写入会员表（provider='app_store'）——不轻信客户端上报。
 * Body: 无（以登录用户 ID 作为 RevenueCat appUserID）
 * 响应：{ isPremium, plan?, expiresAt?, unchanged? }
 */
router.post("/iap-sync", requireAuth, async (req, res) => {
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "支付服务未配置", code: "IAP_NOT_CONFIGURED" });
  }
  try {
    const userId = req.userId!;
    // RevenueCat 服务端查询订阅状态（REST API v1）
    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
    );
    if (rcRes.status === 404) {
      // RevenueCat 中无此用户购买记录
      return res.json({ isPremium: false });
    }
    if (!rcRes.ok) {
      console.error("[premium] RevenueCat 查询失败:", rcRes.status);
      return res.status(502).json({ error: "支付状态校验失败，请稍后重试" });
    }

    const data: any = await rcRes.json();
    const ent = data?.subscriber?.entitlements?.premium;
    const expiresAt: string | null = ent?.expires_date ?? null;
    const active = !!ent && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
    if (!active) {
      return res.json({ isPremium: false });
    }

    // 商品 ID → 套餐（fangnale_lifetime 为终身买断，expires_date 为 null）
    const productId: string = ent?.product_identifier ?? "";
    const plan = productId.includes("lifetime")
      ? "lifetime"
      : productId.includes("yearly")
        ? "yearly"
        : "monthly";

    // 幂等：当前有效会员与本次校验结果一致则直接返回（购买/恢复/刷新会多次触发本接口）
    const current = await getActiveMembership(userId);
    if (current?.provider === "app_store" && current.plan === plan && current.expiresAt === expiresAt) {
      return res.json({ ok: true, isPremium: true, plan, expiresAt, unchanged: true });
    }
    // 终身为最高级：已是终身且本次非终身，不降级（防止订阅同步覆盖买断权益）
    if (current?.plan === "lifetime" && plan !== "lifetime") {
      return res.json({ ok: true, isPremium: true, plan: "lifetime", expiresAt: null, unchanged: true });
    }

    const { error } = await client.from("premium_memberships").insert({
      user_id: userId,
      plan,
      status: "active",
      provider: "app_store",
      expires_at: expiresAt,
    });
    if (error) {
      console.error("[premium] IAP 会员写入失败:", error.message);
      return res.status(500).json({ error: "会员状态同步失败，请稍后重试" });
    }
    return res.json({ ok: true, isPremium: true, plan, expiresAt });
  } catch (error: any) {
    console.error("[premium] IAP 同步异常:", error?.message);
    return res.status(500).json({ error: "会员状态同步失败，请稍后重试" });
  }
});

export default router;
