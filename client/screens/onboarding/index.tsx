import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useAuth } from '@/contexts/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** 首次启动引导完成标记（读端在 app/_layout.tsx 的 AuthGate） */
export const ONBOARDING_KEY = 'has_seen_onboarding_v1';

interface Slide {
  key: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  decoIcon: string;
  decoColor: string;
  title: string;
  subtitle: string;
}

/** 三屏价值叙事：痛点共鸣 → 解决方案 → 价值承诺 */
const SLIDES: Slide[] = [
  {
    key: 'pain',
    icon: 'magnifying-glass',
    iconBg: '#FFE8E6',
    iconColor: '#E17055',
    decoIcon: 'box-open',
    decoColor: '#E17055',
    title: '又翻箱倒柜了？',
    subtitle: '护照、社保卡、备用钥匙……\n用过的东西，总是想不起来收在哪',
  },
  {
    key: 'record',
    icon: 'camera',
    iconBg: '#E8E6FF',
    iconColor: '#6C63FF',
    decoIcon: 'wand-magic-sparkles',
    decoColor: '#6C63FF',
    title: '拍张照，交给 AI',
    subtitle: '拍照自动识别物品，说一句位置就记好\n一片区域还能一次清点多件',
  },
  {
    key: 'find',
    icon: 'comments',
    iconBg: '#E0F5EF',
    iconColor: '#00B894',
    decoIcon: 'location-dot',
    decoColor: '#00B894',
    title: '找东西，问一句',
    subtitle: '“我的护照在哪？”\n它记得你录过的每一件物品的位置',
  },
];

export default function OnboardingScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const listRef = useRef<FlatList<Slide>>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const isLast = pageIndex === SLIDES.length - 1;

  const handleFinish = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // 标记失败不阻塞进入
    }
    router.replace(isAuthenticated ? '/' : '/login');
  };

  const handleNext = () => {
    if (isLast) {
      void handleFinish();
      return;
    }
    listRef.current?.scrollToIndex({ index: pageIndex + 1, animated: true });
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <View style={[styles.iconStage, { backgroundColor: item.iconBg }]}>
        <View style={[styles.decoBubble, { top: 26, right: 30 }]}>
          <FontAwesome6 name={item.decoIcon} size={20} color={item.decoColor} />
        </View>
        <View style={[styles.decoDot, { top: 44, left: 34, backgroundColor: item.decoColor }]} />
        <View style={[styles.decoDotSmall, { bottom: 40, right: 52, backgroundColor: item.decoColor }]} />
        <View style={styles.iconCircle}>
          <FontAwesome6 name={item.icon} size={72} color={item.iconColor} />
        </View>
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.subtitle}>{item.subtitle}</Text>
    </View>
  );

  return (
    <Screen safeAreaEdges={['top', 'bottom']} backgroundColor="#F0F0F3">
      <View style={styles.container}>
        {/* 跳过 */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleFinish} hitSlop={12} activeOpacity={0.7}>
            <Text style={styles.skipText}>跳过</Text>
          </TouchableOpacity>
        </View>

        {/* 横滑三屏 */}
        <FlatList
          ref={listRef}
          data={SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={renderSlide}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setPageIndex(Math.max(0, Math.min(idx, SLIDES.length - 1)));
          }}
        />

        {/* 底部：页码点 + 主按钮 */}
        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View
                key={s.key}
                style={[styles.dot, i === pageIndex && styles.dotActive]}
              />
            ))}
          </View>
          <TouchableOpacity style={styles.ctaBtn} onPress={handleNext} activeOpacity={0.85}>
            <Text style={styles.ctaText}>{isLast ? '立即开始' : '下一步'}</Text>
            <FontAwesome6 name={isLast ? 'check' : 'arrow-right'} size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  skipText: { fontSize: 14, color: '#B2BEC3' },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  iconStage: {
    width: 232,
    height: 232,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 44,
  },
  iconCircle: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  decoBubble: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  decoDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.35,
  },
  decoDotSmall: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.3,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2D3436',
    marginBottom: 14,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 24,
    color: '#636E72',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 22,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D8DCE3',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#6C63FF',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
