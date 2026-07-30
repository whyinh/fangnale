const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL!;

/**
 * 构造物品照片的稳定代理 URL（服务端 302 到签名 URL）。
 * 优势：URL 永久稳定，expo-image 的 memory-disk 缓存永久生效，
 * 无需再为每件物品单独请求签名 URL（原串行 N 次请求 -> 0 次）。
 *
 * 服务端文件：server/src/routes/upload.ts
 * 接口：GET /api/v1/upload/photo
 * Query 参数：key: string
 */
export function photoProxyUrl(key: string): string {
  return `${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo?key=${encodeURIComponent(key)}`;
}
