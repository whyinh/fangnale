import { getSupabaseClient } from "../storage/database/supabase-client.js";

/**
 * 会员体系（Premium）
 *
 * 免费配额：
 *  - 物品数量上限 30 件（POST /items 保存时拦截）
 *  - 问 AI 每日 3 次（POST /items/ask 调用时拦截）
 * 会员：以上均不限量。
 *
 * 支付渠道说明：
 *  - 当前为开发模式（provider='dev_grant'），通过 /api/v1/premium/dev-activate 直接开通，
 *    用于在 Apple 开发者账号就绪前完整验证会员业务链路。
 *  - 上架前接入 RevenueCat/App Store IAP：新增 /iap-verify 接口校验收据后写入本表
 *    （provider='iap'），dev 接口在生产环境自动关闭。业务代码无需改动。
 */

export const FREE_ITEM_LIMIT = 30;
export const FREE_ASK_DAILY_LIMIT = 3;

const client = getSupabaseClient();

/** 当前是否为有效会员 */
export async function isPremium(userId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("premium_memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[premium] 查询会员状态失败:", error.message);
    return false; // 查询失败按免费处理（保守策略：不误放配额）
  }
  return !!data;
}

/** 当前有效会员记录（含套餐与到期时间） */
export async function getActiveMembership(userId: string): Promise<{
  plan: string;
  expiresAt: string | null;
  provider: string;
} | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("premium_memberships")
    .select("plan, expires_at, provider")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    plan: data.plan as string,
    expiresAt: (data.expires_at as string | null) ?? null,
    provider: data.provider as string,
  };
}

/** 用户物品总数 */
export async function getItemCount(userId: string): Promise<number> {
  const { count, error } = await client
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) {
    console.error("[premium] 统计物品数失败:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** 今日问 AI 已用次数 */
export async function getAskCountToday(userId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count, error } = await client
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "ask")
    .gte("created_at", dayStart.toISOString());
  if (error) {
    console.error("[premium] 统计问AI次数失败:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** 记录一次问 AI 使用（在请求入口处即记录，防止并发刷次数） */
export async function logAskUsage(userId: string): Promise<void> {
  const { error } = await client
    .from("usage_logs")
    .insert({ user_id: userId, action: "ask" });
  if (error) console.error("[premium] 记录问AI用量失败:", error.message);
}

/** 配额信息汇总（供 /api/v1/premium 返回；limit 为 null 表示不限） */
export async function getQuota(userId: string, premium: boolean) {
  const [itemsUsed, asksUsedToday] = await Promise.all([
    getItemCount(userId),
    getAskCountToday(userId),
  ]);
  return {
    itemsUsed,
    itemsLimit: premium ? null : FREE_ITEM_LIMIT,
    asksUsedToday,
    asksDailyLimit: premium ? null : FREE_ASK_DAILY_LIMIT,
  };
}
