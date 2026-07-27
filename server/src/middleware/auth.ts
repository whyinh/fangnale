import type { Request, Response, NextFunction } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";

// 通过全局命名空间合并扩展 Express Request（兼容当前 moduleResolution）
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userName?: string;
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
    // 昵称（用户资料 full_name），可选
    const meta = user.user_metadata as { full_name?: string } | undefined;
    req.userName = typeof meta?.full_name === "string" && meta.full_name.trim() ? meta.full_name.trim() : undefined;

    // 惰性同步昵称到 family_members（成员列表/归属徽章展示用；不一致才写，失败不阻塞请求）
    if (req.userName) {
      try {
        await getSupabaseClient()
          .from("family_members")
          .update({ user_name: req.userName })
          .eq("user_id", req.userId);
      } catch (syncErr) {
        console.error("sync user_name error:", syncErr);
      }
    }
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

export interface FamilyMemberBrief {
  email: string | null;
  name: string | null;
}

/** 查询家庭成员 user_id -> { email, name } 映射（用于展示"谁记的"） */
export async function getFamilyMemberMap(userId: string): Promise<Record<string, FamilyMemberBrief>> {
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
    .select("user_id, user_email, user_name")
    .eq("family_id", membership.family_id);
  const map: Record<string, FamilyMemberBrief> = {};
  for (const m of members || []) {
    if (m.user_id) {
      map[m.user_id as string] = {
        email: (m.user_email as string | null) ?? null,
        name: (m.user_name as string | null) ?? null,
      };
    }
  }
  return map;
}
