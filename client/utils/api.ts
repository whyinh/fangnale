/**
 * 带登录态的 fetch 封装
 * - 自动携带 x-session header（Supabase access_token）
 * - 401 时回调上层（触发跳转登录页）
 */
import { getSupabase } from '@/utils/supabase';

let onUnauthorized: (() => void) | null = null;

/** 注册 401 回调（由 AuthProvider 外层注入，用于跳转登录页） */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function resolveToken(): Promise<string | null> {
  try {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** 获取带登录态的 headers（用于 SSE 等非 fetch 场景） */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await resolveToken();
  return token ? { 'x-session': token } : {};
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await resolveToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('x-session', token);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    onUnauthorized?.();
  }
  return res;
}

/** FormData 上传场景（不设置 Content-Type，由 fetch 自动生成 boundary） */
export async function authUpload(
  url: string,
  formData: FormData,
  method: 'POST' | 'PUT' = 'POST'
): Promise<Response> {
  const token = await resolveToken();
  const headers = new Headers();
  if (token) headers.set('x-session', token);
  const res = await fetch(url, { method, headers, body: formData });
  if (res.status === 401) {
    onUnauthorized?.();
  }
  return res;
}
