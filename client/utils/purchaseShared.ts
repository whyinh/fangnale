/**
 * 支付渠道共享定义（跨平台）
 * 被 purchase.ts（web/默认：开发模式）与 purchase.ios.ts（App Store IAP）共同使用。
 */

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
    title: '连续包月',
    price: '¥12',
    unit: '/月',
    desc: '每月自动续费 · 随时取消',
  },
};

/** 用户主动取消购买时抛出的错误（paywall 捕获后静默处理，不弹失败提示） */
export function isPurchaseCancelled(e: unknown): boolean {
  return e instanceof Error && e.name === 'PurchaseCancelledError';
}
