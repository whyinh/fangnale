/**
 * 会员状态上下文
 * - 登录后自动加载会员状态与配额（/api/v1/premium）
 * - 提供 refresh() 供订阅/保存操作后刷新
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authFetch } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

export interface Quota {
  itemsUsed: number;
  itemsLimit: number | null;
  asksUsedToday: number;
  asksDailyLimit: number | null;
}

interface MembershipValue {
  isPremium: boolean;
  plan: string | null;
  expiresAt: string | null;
  quota: Quota | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** 本地当日提问计数 +1（与服务端"进入流即计费"时机对齐） */
  incrementAskUsage: () => void;
}

const MembershipContext = createContext<MembershipValue | null>(null);

export function MembershipProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setIsPremium(false);
      setPlan(null);
      setExpiresAt(null);
      setQuota(null);
      return;
    }
    setLoading(true);
    try {
      /**
       * 服务端文件：server/src/routes/premium.ts
       * 接口：GET /api/v1/premium
       * 响应：{ isPremium: boolean, plan: string|null, expiresAt: string|null, quota: Quota }
       */
      const res = await authFetch(`${API_BASE}/api/v1/premium`);
      if (res.ok) {
        const d = await res.json();
        setIsPremium(!!d.isPremium);
        setPlan(d.plan ?? null);
        setExpiresAt(d.expiresAt ?? null);
        setQuota(d.quota ?? null);
      }
    } catch {
      /* 网络失败保持现状，不打断使用 */
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const incrementAskUsage = useCallback(() => {
    setQuota((prev) => (prev ? { ...prev, asksUsedToday: prev.asksUsedToday + 1 } : prev));
  }, []);

  return (
    <MembershipContext.Provider value={{ isPremium, plan, expiresAt, quota, loading, refresh, incrementAskUsage }}>
      {children}
    </MembershipContext.Provider>
  );
}

export function useMembership(): MembershipValue {
  const ctx = useContext(MembershipContext);
  if (!ctx) throw new Error('useMembership must be used within MembershipProvider');
  return ctx;
}
