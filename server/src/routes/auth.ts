import { Router, type Request, type Response } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// GET /api/v1/auth/me - 当前用户信息（登录后调用）
// 副作用：自动把历史无归属数据（owner_id IS NULL）认领到当前用户（幂等，老用户数据平滑迁移）
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const client = getSupabaseClient();

    // 认领无归属的历史数据（仅影响 owner_id 为 NULL 的行，幂等安全）
    const [{ error: claimItemsError }, { error: claimCatsError }] = await Promise.all([
      client.from("items").update({ owner_id: userId }).is("owner_id", null),
      client.from("categories").update({ owner_id: userId }).is("owner_id", null),
    ]);
    if (claimItemsError) console.error("claim items error:", claimItemsError);
    if (claimCatsError) console.error("claim categories error:", claimCatsError);

    // 家庭摘要
    const { data: membership } = await client
      .from("family_members")
      .select("family_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    let family = null;
    if (membership) {
      const { data } = await client
        .from("families")
        .select("id, name")
        .eq("id", membership.family_id)
        .single();
      family = data;
    }

    res.json({
      user: { id: userId, email: req.userEmail || null },
      family,
      myRole: membership?.role || null,
    });
  } catch (e) {
    console.error("GET /auth/me error:", e);
    res.status(500).json({ error: "获取用户信息失败" });
  }
});

export default router;
