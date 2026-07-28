import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { authFetch } from '@/utils/api';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL!;

/** 统一的整理动作（ checkbox 列表项 ） */
interface OrganizeAction {
  key: string;
  /** 对应后端 /organize/apply 的 action payload */
  payload: Record<string, unknown>;
  group: 'merge' | 'recat' | 'dup' | 'stale';
  title: string;
  desc?: string;
}

interface AnalyzeResponse {
  merge_categories?: Array<{ from_id: number; from_name: string; to_id: number; to_name: string; reason?: string }>;
  recategorize?: Array<{ item_id: number; item_name: string; to_category_id: number; to_category: string; reason?: string }>;
  duplicates?: Array<{ item_ids: number[]; name: string; reason?: string }>;
  stale?: Array<{ item_id: number; item_name: string; reason?: string }>;
  stats?: { items: number; categories: number };
}

const GROUP_META: Record<OrganizeAction['group'], { icon: string; color: string; label: string }> = {
  merge: { icon: 'object-group', color: '#6C63FF', label: '分类归并' },
  recat: { icon: 'arrow-right-arrow-left', color: '#FF9800', label: '错放纠正' },
  dup: { icon: 'clone', color: '#E91E63', label: '疑似重复' },
  stale: { icon: 'box-archive', color: '#795548', label: '断舍离建议' },
};

export default function OrganizeScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actions, setActions] = useState<OrganizeAction[]>([]);
  const [stats, setStats] = useState<{ items: number; categories: number }>({ items: 0, categories: 0 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items/organize/analyze
       * Body 参数：无
       * 响应：AnalyzeResponse（LLM 已按实际数据校验清洗）
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/organize/analyze`, {
        method: 'POST',
      });
      const data: AnalyzeResponse = await res.json();
      if (!res.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : '分析失败');

      const list: OrganizeAction[] = [];
      for (const m of data.merge_categories || []) {
        list.push({
          key: `merge-${m.from_id}-${m.to_id}`,
          payload: { type: 'merge_category', from_id: m.from_id, to_id: m.to_id },
          group: 'merge',
          title: `合并「${m.from_name}」→「${m.to_name}」`,
          desc: m.reason,
        });
      }
      for (const r of data.recategorize || []) {
        list.push({
          key: `recat-${r.item_id}`,
          payload: { type: 'recategorize', item_id: r.item_id, to_category_id: r.to_category_id },
          group: 'recat',
          title: `「${r.item_name}」移到「${r.to_category}」`,
          desc: r.reason,
        });
      }
      for (const d of data.duplicates || []) {
        // 保留第一条，清理其余
        const rest = d.item_ids.slice(1);
        if (rest.length === 0) continue;
        list.push({
          key: `dup-${d.item_ids.join('-')}`,
          payload: { type: 'delete_items', item_ids: rest },
          group: 'dup',
          title: `清理重复的「${d.name}」（保留 1 条，删 ${rest.length} 条）`,
          desc: d.reason,
        });
      }
      for (const s of data.stale || []) {
        list.push({
          key: `stale-${s.item_id}`,
          payload: { type: 'delete_items', item_ids: [s.item_id] },
          group: 'stale',
          title: `考虑清理「${s.item_name}」`,
          desc: s.reason,
        });
      }

      setActions(list);
      setChecked(new Set(list.map((a) => a.key)));
      setStats(data.stats || { items: 0, categories: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    analyze();
  }, [analyze]);

  const grouped = useMemo(() => {
    const order: OrganizeAction['group'][] = ['merge', 'recat', 'dup', 'stale'];
    return order
      .map((g) => ({ group: g, items: actions.filter((a) => a.group === g) }))
      .filter((s) => s.items.length > 0);
  }, [actions]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleApply = async () => {
    const selected = actions.filter((a) => checked.has(a.key));
    if (selected.length === 0) return;
    setApplying(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items/organize/apply
       * Body 参数：actions: Array<{ type: string, ... }>（整理动作 payload，最多 200 条）
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/organize/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: selected.map((a) => a.payload) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '执行失败');
      const r = data.results || {};
      const parts: string[] = [];
      if (r.merged) parts.push(`合并 ${r.merged} 个分类`);
      if (r.recategorized) parts.push(`调整 ${r.recategorized} 件`);
      if (r.deleted) parts.push(`清理 ${r.deleted} 件`);
      if (r.failed) parts.push(`${r.failed} 条失败`);
      Toast.show({ type: 'success', text1: '整理完成', text2: parts.join('，') || '已执行' });
      router.back();
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : '执行失败，请重试' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} backgroundColor="#F0F0F3">
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <FontAwesome6 name="arrow-left" size={17} color="#2D3436" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>智能整理</Text>
          <View style={{ width: 32 }} />
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <View style={styles.loadingIconWrap}>
              <FontAwesome6 name="wand-magic-sparkles" size={26} color="#6C63FF" />
            </View>
            <ActivityIndicator size="large" color="#6C63FF" style={{ marginTop: 20 }} />
            <Text style={styles.loadingTitle}>AI 正在盘点你的物品…</Text>
            <Text style={styles.loadingDesc}>会检查分类合理性、重复记录与闲置物品</Text>
          </View>
        ) : error ? (
          <View style={styles.centerBox}>
            <View style={[styles.loadingIconWrap, { backgroundColor: '#FDECEA' }]}>
              <FontAwesome6 name="circle-exclamation" size={24} color="#E17055" />
            </View>
            <Text style={styles.loadingTitle}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={analyze} activeOpacity={0.8}>
              <Text style={styles.retryBtnText}>重新分析</Text>
            </TouchableOpacity>
          </View>
        ) : actions.length === 0 ? (
          <View style={styles.centerBox}>
            <View style={[styles.loadingIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <FontAwesome6 name="circle-check" size={26} color="#4CAF50" />
            </View>
            <Text style={styles.loadingTitle}>物品井井有条</Text>
            <Text style={styles.loadingDesc}>
              共检查 {stats.items} 件物品、{stats.categories} 个分类，没有发现需要整理的地方
            </Text>
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
              <Text style={styles.summaryText}>
                共 {stats.items} 件物品 · 发现 {actions.length} 条整理建议
              </Text>
              {grouped.map((section) => {
                const meta = GROUP_META[section.group];
                return (
                  <View key={section.group} style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                      <View style={[styles.sectionIconWrap, { backgroundColor: `${meta.color}18` }]}>
                        <FontAwesome6 name={meta.icon as never} size={13} color={meta.color} />
                      </View>
                      <Text style={styles.sectionTitle}>{meta.label}</Text>
                      <Text style={styles.sectionCount}>{section.items.length}</Text>
                    </View>
                    {section.items.map((action) => {
                      const isChecked = checked.has(action.key);
                      return (
                        <TouchableOpacity
                          key={action.key}
                          style={styles.actionRow}
                          onPress={() => toggle(action.key)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.checkbox, isChecked && styles.checkboxActive]}>
                            {isChecked && <FontAwesome6 name="check" size={11} color="#FFF" />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.actionTitle}>{action.title}</Text>
                            {action.desc ? (
                              <Text style={styles.actionDesc} numberOfLines={2}>{action.desc}</Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              <Text style={styles.tipText}>默认全选，可点掉不想执行的建议</Text>
            </ScrollView>

            {/* 底部 CTA */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
              <TouchableOpacity
                style={[styles.applyBtn, (checked.size === 0 || applying) && styles.applyBtnDisabled]}
                onPress={handleApply}
                disabled={checked.size === 0 || applying}
                activeOpacity={0.85}
              >
                {applying ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.applyBtnText}>执行所选整理（{checked.size}）</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  loadingIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    marginTop: 20,
    textAlign: 'center',
  },
  loadingDesc: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 24,
    backgroundColor: '#6C63FF',
    borderRadius: 14,
    paddingHorizontal: 28,
    height: 46,
    justifyContent: 'center',
  },
  retryBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  summaryText: {
    fontSize: 13,
    color: '#9EA0A5',
    marginBottom: 12,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sectionIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2D3436',
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9EA0A5',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#D8D8E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxActive: {
    backgroundColor: '#6C63FF',
    borderColor: '#6C63FF',
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
    lineHeight: 20,
  },
  actionDesc: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 2,
    lineHeight: 17,
  },
  tipText: {
    fontSize: 12,
    color: '#C0C0C8',
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: 'rgba(240,240,243,0.96)',
  },
  applyBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnDisabled: {
    opacity: 0.5,
  },
  applyBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
