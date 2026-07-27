/**
 * React Native 端 Supabase 客户端
 * - url/anonKey 从后端 /api/v1/supabase-config 动态获取（不硬编码密钥）
 * - session 持久化使用 AsyncStorage（三端兼容）
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
let initPromise: Promise<SupabaseClient> | null = null;

async function fetchSupabaseConfig(): Promise<{ url: string; anonKey: string }> {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl}/api/v1/supabase-config`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`获取配置失败: ${res.status}`);
    const config = await res.json();
    if (!config.url || !config.anonKey) throw new Error('Supabase 配置无效');
    return config;
  } finally {
    clearTimeout(timer);
  }
}

async function initClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;
  const config = await fetchSupabaseConfig();
  cachedClient = createClient(config.url, config.anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

/**
 * 获取 Supabase 客户端（首次调用时异步初始化，后续返回缓存实例）
 */
export async function getSupabase(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;
  if (!initPromise) {
    initPromise = initClient().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}
