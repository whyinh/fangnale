/**
 * 支付渠道封装（可插拔架构）—— 默认实现（web / 非 iOS 平台）
 *
 * 当前实现：开发模式——直接调用后端 dev-activate 开通会员（真实写入数据库，功能真实解锁）。
 * iOS 生产实现见 purchase.ios.ts（RevenueCat + App Store IAP，Metro 按平台自动选用）。
 * 业务调用方（paywall 等）无需关心平台差异。
 */
import { authFetch } from '@/utils/api';

export { PLANS, isPurchaseCancelled } from '@/utils/purchaseShared';
export type { PlanId, PlanInfo } from '@/utils/purchaseShared';
import type { PlanId } from '@/utils/purchaseShared';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

/** 登录后初始化支付渠道（开发模式为 no-op；iOS 版会初始化 RevenueCat） */
export async function configurePurchases(_userId: string): Promise<void> {
  // 开发模式无需初始化
}

/** 订阅指定套餐，成功后会员立即生效 */
export async function purchasePlan(plan: PlanId): Promise<void> {
  /**
   * 服务端文件：server/src/routes/premium.ts
   * 接口：POST /api/v1/premium/dev-activate
   * Body 参数：plan: 'monthly' | 'yearly' | 'lifetime'
   */
  const res = await authFetch(`${API_BASE}/api/v1/premium/dev-activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || '开通失败，请稍后重试');
  }
}

/**
 * 恢复购买（App Store 审核强制要求的入口）
 * 开发模式实现：刷新会员状态；iOS 正式版：RevenueCat restoreTransactions + 服务端校验。
 */
export async function restorePurchases(): Promise<boolean> {
  /**
   * 服务端文件：server/src/routes/premium.ts
   * 接口：GET /api/v1/premium
   */
  const res = await authFetch(`${API_BASE}/api/v1/premium`);
  if (!res.ok) return false;
  const d = await res.json();
  return !!d.isPremium;
}
