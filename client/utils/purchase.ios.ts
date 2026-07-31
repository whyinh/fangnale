/**
 * 支付渠道封装 —— iOS 生产实现（RevenueCat + App Store IAP）
 *
 * Metro 在 iOS 平台自动选用本文件替代 purchase.ts（平台后缀解析）。
 * 闭环：RevenueCat SDK 完成扣款 → 后端 /premium/iap-sync 用 RevenueCat
 * 服务端 API 二次校验 entitlement → 写入会员表。客户端不直接信任本地状态。
 *
 * 前置配置（RevenueCat Dashboard / App Store Connect）：
 *  - iOS App 公钥：EXPO_PUBLIC_REVENUECAT_IOS_KEY
 *  - 商品 ID：fangnale_monthly / fangnale_yearly（自动续费订阅）、fangnale_lifetime（非消耗型）
 *  - Entitlement：premium（关联以上三个商品）
 */
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { authFetch } from '@/utils/api';
import { getSupabase } from '@/utils/supabase';

export { PLANS, isPurchaseCancelled } from '@/utils/purchaseShared';
export type { PlanId, PlanInfo } from '@/utils/purchaseShared';
import type { PlanId } from '@/utils/purchaseShared';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';
const RC_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';

/** App Store Connect 中配置的商品 ID（与 PLANS 一一对应） */
const PRODUCT_IDS: Record<PlanId, string> = {
  monthly: 'fangnale_monthly',
  yearly: 'fangnale_yearly',
  lifetime: 'fangnale_lifetime',
};

let configuredUserId: string | null = null;

/**
 * 登录后初始化 RevenueCat（MembershipContext 在登录态就绪后调用）。
 * appUserID 使用我们的用户 ID，服务端据此校验购买归属。
 */
export async function configurePurchases(userId: string): Promise<void> {
  if (!RC_IOS_KEY || configuredUserId === userId) return;
  Purchases.configure({ apiKey: RC_IOS_KEY, appUserID: userId });
  configuredUserId = userId;
}

/** 兜底：未显式初始化时从当前会话取用户 ID 完成配置 */
async function ensureConfigured(): Promise<void> {
  if (configuredUserId) return;
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) throw new Error('请先登录后再购买');
  await configurePurchases(userId);
}

function findPackage(packages: PurchasesPackage[], plan: PlanId): PurchasesPackage | null {
  const productId = PRODUCT_IDS[plan];
  return packages.find((p) => p.product.identifier === productId) ?? null;
}

/**
 * 服务端文件：server/src/routes/premium.ts
 * 接口：POST /api/v1/premium/iap-sync
 * Body 参数：无（服务端以登录用户 ID 向 RevenueCat 校验并写入会员）
 */
async function syncWithBackend(): Promise<boolean> {
  const res = await authFetch(`${API_BASE}/api/v1/premium/iap-sync`, { method: 'POST' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || '会员状态同步失败，请稍后在「恢复购买」中重试');
  }
  const d = await res.json();
  return !!d.isPremium;
}

/** 订阅指定套餐；用户取消时抛出 name='PurchaseCancelledError' 的错误（调用方静默处理） */
export async function purchasePlan(plan: PlanId): Promise<void> {
  await ensureConfigured();
  let pkg: PurchasesPackage;
  try {
    const offerings = await Purchases.getOfferings();
    const found = findPackage(offerings.current?.availablePackages ?? [], plan);
    if (!found) throw new Error('商品暂不可用，请稍后重试');
    pkg = found;
  } catch (e) {
    if (e instanceof Error && e.message.includes('商品暂不可用')) throw e;
    throw new Error('无法连接 App Store，请检查网络后重试');
  }

  try {
    await Purchases.purchasePackage(pkg);
  } catch (e: any) {
    if (e?.userCancelled) {
      const cancelled = new Error('已取消购买');
      cancelled.name = 'PurchaseCancelledError';
      throw cancelled;
    }
    throw new Error(e?.message || '支付未完成，请稍后重试');
  }

  // 扣款成功：服务端二次校验 entitlement 并写入会员表（不轻信客户端状态）
  await syncWithBackend();
}

/** 恢复购买（App Store 审核强制入口）：RC 恢复 + 服务端校验同步 */
export async function restorePurchases(): Promise<boolean> {
  await ensureConfigured();
  try {
    await Purchases.restorePurchases();
  } catch {
    throw new Error('恢复购买失败，请稍后重试');
  }
  return syncWithBackend();
}
