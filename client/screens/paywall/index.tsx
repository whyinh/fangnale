import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { useMembership } from '@/contexts/MembershipContext';
import { purchasePlan, restorePurchases, PLANS, type PlanId } from '@/utils/purchase';

const ACCENT = '#6C63FF';
const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

/** 免费版 vs 会员权益对比 */
const BENEFITS: { icon: string; title: string; free: string; premium: string }[] = [
  { icon: 'box', title: '物品记录数量', free: '30 件', premium: '不限' },
  { icon: 'wand-magic-sparkles', title: 'AI 拍照识别', free: '支持', premium: '支持' },
  { icon: 'layer-group', title: '一拍多录', free: '3 件/次', premium: '不限' },
  { icon: 'comments', title: '问 AI 找东西', free: '3 次/天', premium: '不限' },
  { icon: 'cloud-arrow-up', title: '多设备同步', free: '支持', premium: '支持' },
];

export default function PaywallScreen() {
  const router = useSafeRouter();
  const { reason } = useSafeSearchParams<{ reason?: string }>();
  const { isPremium, plan, expiresAt, refresh } = useMembership();
  const [selected, setSelected] = useState<PlanId>('yearly');
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const reasonText =
    reason === 'item_limit'
      ? '免费版最多记录 30 件物品，升级会员解除限制'
      : reason === 'ask_limit'
        ? '免费版每天可问 AI 3 次，升级会员不限次数'
        : null;

  const handleSubscribe = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 支付渠道可插拔（utils/purchase.ts）：当前为开发模式，正式版切换为 Apple IAP
      await purchasePlan(selected);
      await refresh();
      Toast.show({ type: 'success', text1: '会员已开通', text2: '全部功能已解锁' });
      router.back();
    } catch (e) {
      Alert.alert('开通失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      await restorePurchases();
      await refresh();
      Toast.show({ type: 'info', text1: '已刷新购买状态' });
    } catch {
      Toast.show({ type: 'error', text1: '恢复失败，请稍后重试' });
    } finally {
      setRestoring(false);
    }
  };

  const openPrivacy = () => {
    void Linking.openURL(`${API_BASE}/privacy`);
  };

  return (
    <Screen safeAreaEdges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* 顶部关闭 */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} hitSlop={12}>
            <FontAwesome6 name="xmark" size={18} color="#6B6B7A" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.crownWrap}>
              <FontAwesome6 name="crown" size={34} color="#FFD664" />
            </View>
            <Text style={styles.heroTitle}>放哪了 会员</Text>
            <Text style={styles.heroSub}>全屋物品，想记多少记多少</Text>
            {reasonText ? (
              <View style={styles.reasonBanner}>
                <Text style={styles.reasonText}>{reasonText}</Text>
              </View>
            ) : null}
          </View>

          {isPremium ? (
            /* 已是会员 */
            <View style={styles.memberCard}>
              <FontAwesome6 name="circle-check" size={22} color={ACCENT} />
              <View style={{ flex: 1 }}>
                <Text style={styles.memberTitle}>会员生效中</Text>
                <Text style={styles.memberDesc}>
                  {plan === 'yearly' ? '年度会员' : '月度会员'}
                  {expiresAt ? ` · ${new Date(expiresAt).toLocaleDateString('zh-CN')} 到期` : ''}
                </Text>
              </View>
            </View>
          ) : (
            <>
              {/* 权益对比 */}
              <View style={styles.benefitCard}>
                <View style={styles.benefitHeader}>
                  <Text style={styles.benefitHeaderText}>功能</Text>
                  <Text style={[styles.benefitHeaderText, styles.colFree]}>免费版</Text>
                  <Text style={[styles.benefitHeaderText, styles.colPremium]}>会员</Text>
                </View>
                {BENEFITS.map((b) => (
                  <View key={b.title} style={styles.benefitRow}>
                    <View style={styles.benefitTitleWrap}>
                      <View style={styles.benefitIcon}>
                        <FontAwesome6 name={b.icon} size={12} color={ACCENT} />
                      </View>
                      <Text style={styles.benefitTitle}>{b.title}</Text>
                    </View>
                    <Text style={[styles.benefitValue, styles.colFree, b.free === '不限' || b.free === '支持' ? null : styles.dim]}>
                      {b.free}
                    </Text>
                    <Text style={[styles.benefitValue, styles.colPremium, styles.premiumValue]}>{b.premium}</Text>
                  </View>
                ))}
              </View>

              {/* 套餐选择 */}
              <View style={styles.planWrap}>
                {(Object.keys(PLANS) as PlanId[]).map((id) => {
                  const p = PLANS[id];
                  const active = selected === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.planCard, active && styles.planCardActive]}
                      onPress={() => setSelected(id)}
                      activeOpacity={0.8}
                    >
                      {id === 'yearly' && (
                        <View style={styles.planBadge}>
                          <Text style={styles.planBadgeText}>推荐</Text>
                        </View>
                      )}
                      <View style={[styles.radio, active && styles.radioActive]}>
                        {active && <View style={styles.radioDot} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planTitle}>{p.title}</Text>
                        <Text style={styles.planDesc}>{p.desc}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.planPrice}>
                          {p.price}
                          <Text style={styles.planUnit}>{p.unit}</Text>
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 订阅按钮 */}
              <TouchableOpacity
                style={[styles.subscribeBtn, submitting && { opacity: 0.6 }]}
                onPress={handleSubscribe}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.subscribeText}>
                    {selected === 'yearly' ? '¥45 开通年度会员' : '¥6 开通月度会员'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* 恢复购买（App Store 审核要求） */}
              <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={restoring}>
                <Text style={styles.restoreText}>{restoring ? '正在恢复…' : '恢复购买'}</Text>
              </TouchableOpacity>

              {/* 订阅条款 */}
              <Text style={styles.termsText}>
                订阅将按所选周期自动续费，可随时在系统设置中取消；取消后当期会员权益保持至周期结束。
              </Text>
              <View style={styles.linkRow}>
                <TouchableOpacity onPress={openPrivacy}>
                  <Text style={styles.linkText}>隐私政策</Text>
                </TouchableOpacity>
                <Text style={styles.linkDivider}>·</Text>
                <TouchableOpacity onPress={openPrivacy}>
                  <Text style={styles.linkText}>用户协议</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F6FA' },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 4 : 8 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#EDEDF3',
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  hero: { alignItems: 'center', marginTop: 8, marginBottom: 20 },
  crownWrap: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
    elevation: 8,
  },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#1A1A2E' },
  heroSub: { fontSize: 14, color: '#6B6B7A', marginTop: 6 },
  reasonBanner: {
    marginTop: 14, backgroundColor: '#FFF4E0', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  reasonText: { fontSize: 13, color: '#B45309', fontWeight: '600' },
  memberCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  memberTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E' },
  memberDesc: { fontSize: 13, color: '#6B6B7A', marginTop: 3 },
  benefitCard: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, marginBottom: 16,
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  benefitHeader: { flexDirection: 'row', paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E8E8F0', marginBottom: 6 },
  benefitHeaderText: { flex: 1, fontSize: 12, color: '#9C9CAE', fontWeight: '600' },
  benefitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  benefitTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefitIcon: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: '#F0EFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  benefitTitle: { fontSize: 14, color: '#1A1A2E', fontWeight: '600' },
  benefitValue: { fontSize: 13, color: '#6B6B7A' },
  colFree: { width: 62, textAlign: 'center' },
  colPremium: { width: 56, textAlign: 'center' },
  premiumValue: { color: ACCENT, fontWeight: '700' },
  dim: { color: '#9C9CAE' },
  planWrap: { gap: 10, marginBottom: 16 },
  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16,
    borderWidth: 2, borderColor: 'transparent',
  },
  planCardActive: { borderColor: ACCENT, backgroundColor: '#FBFAFF' },
  planBadge: {
    position: 'absolute', top: -9, right: 14, backgroundColor: ACCENT,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
  },
  planBadgeText: { fontSize: 10, color: '#FFF', fontWeight: '700' },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D0D0DC',
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: ACCENT },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT },
  planTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A2E' },
  planDesc: { fontSize: 12, color: '#9C9CAE', marginTop: 2 },
  planPrice: { fontSize: 20, fontWeight: '800', color: '#1A1A2E' },
  planUnit: { fontSize: 12, fontWeight: '500', color: '#9C9CAE' },
  subscribeBtn: {
    backgroundColor: ACCENT, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  subscribeText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  restoreBtn: { alignItems: 'center', paddingVertical: 14 },
  restoreText: { fontSize: 14, color: ACCENT, fontWeight: '600' },
  termsText: { fontSize: 11, color: '#9C9CAE', textAlign: 'center', lineHeight: 17 },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  linkText: { fontSize: 12, color: ACCENT, textDecorationLine: 'underline' },
  linkDivider: { color: '#9C9CAE' },
});
