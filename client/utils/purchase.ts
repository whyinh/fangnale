/**
 * 支付渠道封装（可插拔架构）
 *
 * 当前实现：开发模式——直接调用后端 dev-activate 开通会员（真实写入数据库，功能真实解锁）。
 * 上架切换：配置 Apple Developer 账号与 App Store 订阅商品后，接入 RevenueCat，
 *          仅需替换 purchasePlan / restorePurchases 的内部实现，
 *          业务调用方（paywall 等）无需改动。
 */
import { authFetch } from '@/utils/api';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

export type PlanId = 'yearly' | 'lifetime' | 'monthly';

export interface PlanInfo {
  title: string;
  price: string;
  unit: string;
  desc: string;
  /** 划线原价（仅优惠价档位） */
  originalPrice?: string;
  /** 角标文案 */
  badge?: string;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  yearly: {
    title: '年度会员',
    price: '¥45',
    unit: '/年',
    originalPrice: '¥88',
    badge: '早鸟价',
    desc: '月均 ¥3.75 · 首发限时，随时恢复原价',
  },
  lifetime: {
    title: '终身买断',
    price: '¥168',
    unit: '',
    badge: '一次买断',
    desc: '一次付费，终身使用，再无续费',
  },
  monthly: {
    title: '月度会员',
    price: '¥12',
    unit: '/月',
    desc: '按月订阅，随时取消',
  },
};

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
 * 开发模式实现：刷新会员状态；正式版（RevenueCat）：restoreTransactions + 服务端校验。
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
