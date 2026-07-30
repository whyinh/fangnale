import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome6 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useAuth } from '@/contexts/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SEEN_KEY = 'has_seen_onboarding_v1';

type SlideDef = {
  key: string;
  kind: 'photo' | 'chat';
  image?: string;
  icon: string;
  iconBg: string;
  title: string;
  subtitle: string;
};

const SLIDES: SlideDef[] = [
  {
    key: 'pain',
    kind: 'photo',
    image: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800&q=80',
    icon: 'magnifying-glass',
    iconBg: '#E17055',
    title: '又翻箱倒柜了？',
    subtitle: '护照、社保卡、备用钥匙……\n用过的东西，总是想不起来收在哪',
  },
  {
    key: 'capture',
    kind: 'photo',
    image: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800&q=80',
    icon: 'camera',
    iconBg: '#6C63FF',
    title: '拍张照，剩下的交给 AI',
    subtitle: '自动识别物品和分类\n说个位置就存好，一件不到 10 秒',
  },
  {
    key: 'ask',
    kind: 'chat',
    icon: 'wand-magic-sparkles',
    iconBg: '#00B894',
    title: '找东西，问一句就行',
    subtitle: '它记得你录过的每一件物品\n下次着急出门，不再翻箱倒柜',
  },
];

export default function OnboardingScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<SlideDef>>(null);
  const isLast = activeIndex === SLIDES.length - 1;

  const handleFinish = async () => {
    try {
      await AsyncStorage.setItem(SEEN_KEY, '1');
    } catch {
      // 本地标记失败不影响使用
    }
    router.replace(isAuthenticated ? '/' : '/login');
  };

  const handleNext = () => {
    if (isLast) {
      void handleFinish();
      return;
    }
    listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
  };

  return (
    <Screen safeAreaEdges={['top', 'bottom']} backgroundColor="#F6F4FF">
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleFinish} hitSlop={12} style={styles.skipBtn}>
            <Text style={styles.skipText}>跳过</Text>
          </TouchableOpacity>
        </View>

        <Animated.FlatList
          ref={listRef as any}
          data={SLIDES}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setActiveIndex(Math.min(Math.max(idx, 0), SLIDES.length - 1));
          }}
          renderItem={({ item, index }) => (
            <Slide item={item} index={index} scrollX={scrollX} isActive={index === activeIndex} />
          )}
          style={styles.flex}
        />

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View key={s.key} style={[styles.dot, i === activeIndex && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity style={styles.ctaBtn} onPress={handleNext} activeOpacity={0.85}>
            <Text style={styles.ctaText}>{isLast ? '免费开始记录' : '下一步'}</Text>
            <FontAwesome6 name={isLast ? 'check' : 'arrow-right'} size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  );
}

function Slide({
  item,
  index,
  scrollX,
  isActive,
}: {
  item: SlideDef;
  index: number;
  scrollX: Animated.Value;
  isActive: boolean;
}) {
  // 对话演示：切到本屏时逐条出现（问句 → 停顿 → AI 回答），离开重置以便重播
  const userAnim = useRef(new Animated.Value(0)).current;
  const aiAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (item.kind !== 'chat') return;
    if (isActive) {
      userAnim.setValue(0);
      aiAnim.setValue(0);
      Animated.sequence([
        Animated.timing(userAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(400),
        Animated.timing(aiAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]).start();
    } else {
      userAnim.setValue(0);
      aiAnim.setValue(0);
    }
  }, [isActive, item.kind, userAnim, aiAnim]);

  const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];
  const visualScale = scrollX.interpolate({
    inputRange,
    outputRange: [0.88, 1, 0.88],
    extrapolate: 'clamp',
  });
  const visualOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0.4, 1, 0.4],
    extrapolate: 'clamp',
  });
  const textTranslate = scrollX.interpolate({
    inputRange,
    outputRange: [28, 0, 28],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
      <Animated.View
        style={[styles.visualCard, { transform: [{ scale: visualScale }], opacity: visualOpacity }]}
      >
        {item.kind === 'photo' ? (
          <>
            <Image
              source={{ uri: item.image }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={300}
            />
            <LinearGradient
              colors={['rgba(20,16,44,0)', 'rgba(20,16,44,0.45)']}
              style={styles.visualMask}
            />
            <View style={[styles.iconBadgeOnPhoto, { backgroundColor: item.iconBg }]}>
              <FontAwesome6 name={item.icon} size={26} color="#FFFFFF" />
            </View>
          </>
        ) : (
          <View style={styles.chatMock}>
            <Animated.View
              style={[styles.chatBubbleUser, {
                opacity: userAnim,
                transform: [{ translateY: userAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              }]}
            >
              <Text style={styles.chatUserText}>我的护照在哪？</Text>
            </Animated.View>
            <Animated.View
              style={[styles.chatBubbleAi, {
                opacity: aiAnim,
                transform: [{ translateY: aiAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              }]}
            >
              <View style={styles.chatAiHeader}>
                <FontAwesome6 name="location-dot" size={12} color="#00B894" />
                <Text style={styles.chatAiLabel}>放哪了 AI</Text>
              </View>
              <Text style={styles.chatAiText}>在「主卧 / 衣柜 / 顶层」</Text>
              <Text style={styles.chatAiMeta}>12 天前录入 · 有照片可查看</Text>
            </Animated.View>
            <View style={styles.chatHintRow}>
              <FontAwesome6 name={item.icon} size={11} color="#8B83C8" />
              <Text style={styles.chatHint}>真实回答，来自你录过的物品</Text>
            </View>
          </View>
        )}
      </Animated.View>

      <Animated.View
        style={[styles.slideTextWrap, { transform: [{ translateY: textTranslate }], opacity: visualOpacity }]}
      >
        <Text style={styles.slideTitle}>{item.title}</Text>
        <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(108,99,255,0.08)',
  },
  skipText: { fontSize: 14, color: '#8B83C8', fontWeight: '600' },
  slide: { flex: 1, paddingHorizontal: 24 },
  visualCard: {
    height: Math.max(SCREEN_HEIGHT * 0.44, 300),
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 10,
  },
  visualMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
  },
  iconBadgeOnPhoto: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  chatMock: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 14,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#6C63FF',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '85%',
  },
  chatUserText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  chatBubbleAi: {
    alignSelf: 'flex-start',
    backgroundColor: '#F6F4FF',
    borderWidth: 1,
    borderColor: '#E9E4FF',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '88%',
    gap: 6,
  },
  chatAiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatAiLabel: { fontSize: 11, color: '#00B894', fontWeight: '700' },
  chatAiText: { fontSize: 16, color: '#2D3436', fontWeight: '700' },
  chatAiMeta: { fontSize: 11, color: '#8B83C8' },
  chatHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  chatHint: { fontSize: 11, color: '#8B83C8' },
  slideTextWrap: { alignItems: 'center', paddingTop: 28, paddingHorizontal: 8 },
  slideTitle: { fontSize: 26, fontWeight: '700', color: '#2D3436', marginBottom: 12, textAlign: 'center' },
  slideSubtitle: { fontSize: 15, color: '#7A7599', textAlign: 'center', lineHeight: 23 },
  footer: { paddingHorizontal: 24, paddingBottom: 12, gap: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D5CEFF' },
  dotActive: { width: 22, backgroundColor: '#6C63FF' },
  ctaBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
