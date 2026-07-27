import { Router, type Request, type Response } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function generateInviteCode(): string {
  // 6 位数字+大写字母邀请码，去掉易混淆字符
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getMyMembership(userId: string) {
  const client = getSupabaseClient();
  const { data } = await client
    .from("family_members")
    .select("id, family_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data;
}

// GET /api/v1/families/my - 我的家庭信息（含成员与邀请码）
router.get("/my", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const membership = await getMyMembership(userId);
    if (!membership) {
      res.json({ family: null });
      return;
    }
    const client = getSupabaseClient();
    const [{ data: family }, { data: members }] = await Promise.all([
      client.from("families").select("id, name, invite_code, created_by, created_at").eq("id", membership.family_id).single(),
      client.from("family_members").select("user_id, user_email, role, joined_at").eq("family_id", membership.family_id).order("joined_at", { ascending: true }),
    ]);
    res.json({
      family: family || null,
      myRole: membership.role,
      members: members || [],
    });
  } catch (e) {
    console.error("GET /families/my error:", e);
    res.status(500).json({ error: "查询家庭信息失败" });
  }
});

// POST /api/v1/families/create - 创建家庭
// Body: { name?: string }
router.post("/create", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const existing = await getMyMembership(userId);
    if (existing) {
      res.status(400).json({ error: "你已在一个家庭中，请先退出再创建" });
      return;
    }
    const name = (req.body?.name || "我的家庭").toString().trim().slice(0, 30) || "我的家庭";
    const client = getSupabaseClient();

    // 生成唯一邀请码（冲突时重试）
    let family = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await client
        .from("families")
        .insert({ name, invite_code: generateInviteCode(), created_by: userId })
        .select("id, name, invite_code")
        .single();
      if (!error && data) {
        family = data;
        break;
      }
      if (error && !String(error.message).includes("duplicate")) {
        throw new Error(`创建家庭失败: ${error.message}`);
      }
    }
    if (!family) throw new Error("邀请码生成失败，请重试");

    const { error: memberError } = await client.from("family_members").insert({
      family_id: family.id,
      user_id: userId,
      user_email: req.userEmail || null,
      role: "owner",
    });
    if (memberError) throw new Error(`加入家庭失败: ${memberError.message}`);

    res.json({ family, myRole: "owner" });
  } catch (e) {
    console.error("POST /families/create error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "创建家庭失败" });
  }
});

// POST /api/v1/families/join - 通过邀请码加入家庭
// Body: { invite_code: string }
router.post("/join", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const inviteCode = (req.body?.invite_code || "").toString().trim().toUpperCase();
    if (!inviteCode) {
      res.status(400).json({ error: "请输入邀请码" });
      return;
    }
    const existing = await getMyMembership(userId);
    if (existing) {
      res.status(400).json({ error: "你已在一个家庭中，请先退出再加入" });
      return;
    }
    const client = getSupabaseClient();
    const { data: family } = await client
      .from("families")
      .select("id, name")
      .eq("invite_code", inviteCode)
      .maybeSingle();
    if (!family) {
      res.status(404).json({ error: "邀请码无效，请确认后重试" });
      return;
    }
    const { error: memberError } = await client.from("family_members").insert({
      family_id: family.id,
      user_id: userId,
      user_email: req.userEmail || null,
      role: "member",
    });
    if (memberError) throw new Error(`加入家庭失败: ${memberError.message}`);
    res.json({ family: { id: family.id, name: family.name }, myRole: "member" });
  } catch (e) {
    console.error("POST /families/join error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "加入家庭失败" });
  }
});

// POST /api/v1/families/leave - 退出家庭（创建者退出则解散家庭）
router.post("/leave", async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const membership = await getMyMembership(userId);
    if (!membership) {
      res.status(400).json({ error: "你不在任何家庭中" });
      return;
    }
    const client = getSupabaseClient();
    if (membership.role === "owner") {
      // 解散家庭：删除全部成员后删除家庭（成员有外键 ON DELETE CASCADE，直接删 family 即可）
      const { error } = await client.from("families").delete().eq("id", membership.family_id);
      if (error) throw new Error(`解散家庭失败: ${error.message}`);
      res.json({ ok: true, dissolved: true });
      return;
    }
    const { error } = await client.from("family_members").delete().eq("id", membership.id);
    if (error) throw new Error(`退出家庭失败: ${error.message}`);
    res.json({ ok: true, dissolved: false });
  } catch (e) {
    console.error("POST /families/leave error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "退出家庭失败" });
  }
});

export default router;
