import type { Request, Response, NextFunction } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";

// 通过全局命名空间合并扩展 Express Request（兼容当前 moduleResolution）
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export {};

/**
 * 鉴权中间件：从 x-session header 取 Supabase access_token 并校验
 * 通过后挂载 req.userId / req.userEmail
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers["x-session"] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "未登录或登录已过期，请重新登录" });
    return;
  }
  try {
    const client = getSupabaseClient(token);
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) {
      res.status(401).json({ error: "未登录或登录已过期，请重新登录" });
      return;
    }
    req.userId = user.id;
    // 邮箱用户取 email，手机用户回退到 phone（用于"谁记的"/成员列表展示）
    req.userEmail = user.email || user.phone || undefined;
    next();
  } catch (e) {
    console.error("requireAuth error:", e);
    res.status(401).json({ error: "登录状态验证失败，请重新登录" });
  }
}

/**
 * 获取当前用户可见的 owner_id 集合：自己 + 同家庭全部成员
 * 使用 service key 查询（后端统一绕过 RLS，人为控制可见范围）
 */
export async function getVisibleOwnerIds(userId: string): Promise<string[]> {
  const client = getSupabaseClient();
  const { data: membership, error } = await client
    .from("family_members")
    .select("family_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getVisibleOwnerIds membership error:", error);
    return [userId];
  }
  if (!membership) return [userId];

  const { data: members, error: membersError } = await client
    .from("family_members")
    .select("user_id")
    .eq("family_id", membership.family_id);
  if (membersError || !members || members.length === 0) return [userId];
  return members.map((m) => m.user_id as string);
}

/** 查询家庭成员 user_id -> email 映射（用于展示"谁记的"） */
export async function getFamilyEmailMap(userId: string): Promise<Record<string, string>> {
  const client = getSupabaseClient();
  const { data: membership } = await client
    .from("family_members")
    .select("family_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!membership) return {};
  const { data: members } = await client
    .from("family_members")
    .select("user_id, user_email")
    .eq("family_id", membership.family_id);
  const map: Record<string, string> = {};
  for (const m of members || []) {
    if (m.user_id && m.user_email) map[m.user_id as string] = m.user_email as string;
  }
  return map;
}
