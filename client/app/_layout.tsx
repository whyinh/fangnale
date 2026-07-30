import { Stack, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';
import { LinkPreviewContextProvider } from 'expo-router/build/link/preview/LinkPreviewContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { MembershipProvider } from '@/contexts/MembershipContext';
import { setUnauthorizedHandler } from '@/utils/api';
import { useSafeRouter } from '@/hooks/useSafeRouter';

import '../global.css';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

/** 首次启动引导标记（看完后置为 '1'，之后不再展示） */
const ONBOARDING_KEY = 'has_seen_onboarding_v1';

/**
 * 路由守卫：
 * - 导航未挂载 / 鉴权加载中 → 等待
 * - 首次启动未看过引导 → 进引导页（每次路由变化时重读标记，看完即放行）
 * - 未登录且不在登录页 → 跳登录页
 * - 已登录但在登录页 → 回首页
 * - 401 时全局登出（守卫随后自动跳登录页）
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const rootState = useRootNavigationState();
  const segments = useSegments();
  const router = useSafeRouter();
  const { isAuthenticated, isLoading, signOut } = useAuth();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut().catch((e) => console.warn('signOut on 401 failed:', e));
    });
  }, [signOut]);

  useEffect(() => {
    if (!rootState?.key || isLoading) return;

    const inLoginRoute = segments[0] === 'login';
    const inOnboardingRoute = segments[0] === 'onboarding';

    void (async () => {
      const seenOnboarding = await AsyncStorage.getItem(ONBOARDING_KEY);

      if (seenOnboarding !== '1' && !inOnboardingRoute) {
        router.replace('/onboarding');
        return;
      }

      if (!isAuthenticated && !inLoginRoute && !inOnboardingRoute) {
        router.replace('/login');
      } else if (isAuthenticated && inLoginRoute) {
        router.replace('/');
      }
    })();
  }, [rootState?.key, isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F0F5' }}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <Provider>
      <AuthProvider>
        <MembershipProvider>
        <LinkPreviewContextProvider>
          <AuthGate>
            <Stack
              screenOptions={{
                animation: 'slide_from_right',
                gestureEnabled: true,
                gestureDirection: 'horizontal',
                headerShown: false
              }}
            >
              <Stack.Screen name="(tabs)" options={{ title: "" }} />
              <Stack.Screen name="onboarding" options={{ title: "", gestureEnabled: false, animation: 'fade' }} />
              <Stack.Screen name="login" options={{ title: "", gestureEnabled: false }} />
              <Stack.Screen name="item-detail" options={{ title: "" }} />
              <Stack.Screen name="organize" options={{ title: "" }} />
              <Stack.Screen name="space-room" options={{ title: "" }} />
              <Stack.Screen name="space-furniture" options={{ title: "" }} />
              <Stack.Screen name="paywall" options={{ title: "", presentation: 'modal', animation: 'slide_from_bottom' }} />
            </Stack>
          </AuthGate>
        </LinkPreviewContextProvider>
        </MembershipProvider>
        <Toast />
      </AuthProvider>
    </Provider>
  );
}
