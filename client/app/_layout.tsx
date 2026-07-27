import { Stack, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox, View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import Toast from 'react-native-toast-message';
import { Provider } from '@/components/Provider';
import { LinkPreviewContextProvider } from 'expo-router/build/link/preview/LinkPreviewContext';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { setUnauthorizedHandler } from '@/utils/api';
import { useSafeRouter } from '@/hooks/useSafeRouter';

import '../global.css';

LogBox.ignoreLogs([
  "TurboModuleRegistry.getEnforcing(...): 'RNMapsAirModule' could not be found",
  // 添加其它想暂时忽略的错误或警告信息
]);

/**
 * 路由守卫：
 * - 导航未挂载 / 鉴权加载中 → 等待
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

    if (!isAuthenticated && !inLoginRoute) {
      router.replace('/login');
    } else if (isAuthenticated && inLoginRoute) {
      router.replace('/');
    }
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
              <Stack.Screen name="login" options={{ title: "", gestureEnabled: false }} />
              <Stack.Screen name="item-detail" options={{ title: "" }} />
            </Stack>
          </AuthGate>
        </LinkPreviewContextProvider>
        <Toast />
      </AuthProvider>
    </Provider>
  );
}
