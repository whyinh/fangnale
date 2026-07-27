/**
 * 登录/注册页（邮箱密码，注册自动确认后直接登录）
 * - mode 切换登录/注册视图，span 带 key 强制重挂载重置表单
 * - 内联错误提示、loading 防重复、键盘避让
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';

type Mode = 'login' | 'register';

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login');

  return (
    <Screen style={styles.screen}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
        <View style={styles.container}>
          {/* 品牌区 */}
          <View style={styles.brand}>
            <View style={styles.logoBox}>
              <FontAwesome6 name="box-archive" size={34} color="#FFFFFF" />
            </View>
            <Text style={styles.appName}>StashSpot</Text>
            <Text style={styles.appSlogan}>你的物品，一目了然</Text>
          </View>

          {/* 登录/注册视图（key 强制重挂载重置表单） */}
          <View key={mode} style={styles.formArea}>
            <AuthForm mode={mode} onSwitch={() => setMode(mode === 'login' ? 'register' : 'login')} />
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

function AuthForm({ mode, onSwitch }: { mode: Mode; onSwitch: () => void }) {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  const isRegister = mode === 'register';

  const mapError = (msg: string): string => {
    const m = msg.toLowerCase();
    if (m.includes('invalid login credentials')) return '邮箱或密码错误';
    if (m.includes('user already registered')) return '该邮箱已注册，请直接登录';
    if (m.includes('password') && m.includes('least')) return '密码至少需要 6 位';
    if (m.includes('invalid') && m.includes('email')) return '邮箱格式不正确';
    if (m.includes('rate limit') || m.includes('too many')) return '操作太频繁，请稍后再试';
    return msg || '操作失败，请重试';
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorText('请输入邮箱');
      return;
    }
    const atIdx = trimmedEmail.indexOf('@');
    const domain = atIdx >= 0 ? trimmedEmail.slice(atIdx + 1) : '';
    if (atIdx <= 0 || atIdx !== trimmedEmail.lastIndexOf('@') || !domain.includes('.')) {
      setErrorText('邮箱格式不正确');
      return;
    }
    if (password.length < 6) {
      setErrorText('密码至少需要 6 位');
      return;
    }
    if (isRegister && password !== confirmPassword) {
      setErrorText('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    setErrorText('');
    try {
      if (isRegister) {
        await signUp(trimmedEmail, password);
      } else {
        await signIn(trimmedEmail, password);
      }
      // 成功后由路由守卫自动跳转首页，无需手动导航
    } catch (e) {
      setErrorText(mapError(e instanceof Error ? e.message : String(e)));
      setSubmitting(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>{isRegister ? '创建账号' : '欢迎回来'}</Text>
      <Text style={styles.subtitle}>
        {isRegister ? '注册后自动登录，数据云端同步' : '登录后可跨设备同步、与家人共享'}
      </Text>

      {/* 邮箱 */}
      <View style={styles.inputWrap}>
        <FontAwesome6 name="envelope" size={15} color="#9EA0A5" />
        <TextInput
          style={styles.input}
          placeholder="邮箱"
          placeholderTextColor="#9EA0A5"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* 密码 */}
      <View style={styles.inputWrap}>
        <FontAwesome6 name="lock" size={15} color="#9EA0A5" />
        <TextInput
          style={styles.input}
          placeholder="密码（至少 6 位）"
          placeholderTextColor="#9EA0A5"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
          <FontAwesome6 name={showPassword ? 'eye' : 'eye-slash'} size={15} color="#9EA0A5" />
        </TouchableOpacity>
      </View>

      {/* 确认密码（注册） */}
      {isRegister && (
        <View style={styles.inputWrap}>
          <FontAwesome6 name="lock" size={15} color="#9EA0A5" />
          <TextInput
            style={styles.input}
            placeholder="确认密码"
            placeholderTextColor="#9EA0A5"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
        </View>
      )}

      {/* 内联错误提示 */}
      {errorText ? (
        <View style={styles.errorWrap}>
          <FontAwesome6 name="circle-exclamation" size={13} color="#E24A4A" />
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      ) : null}

      {/* 提交按钮 */}
      <TouchableOpacity
        style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
        activeOpacity={0.85}
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.submitBtnText}>{isRegister ? '注册并登录' : '登录'}</Text>
        )}
      </TouchableOpacity>

      {/* 切换登录/注册 */}
      <TouchableOpacity style={styles.switchWrap} onPress={onSwitch} disabled={submitting}>
        <Text style={styles.switchText}>
          {isRegister ? '已有账号？去登录' : '还没有账号？去注册'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F0F0F5',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  appName: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: '700',
    color: '#2D3436',
  },
  appSlogan: {
    marginTop: 6,
    fontSize: 14,
    color: '#9EA0A5',
  },
  formArea: {
    width: '100%',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#9EA0A5',
    marginBottom: 22,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    height: 52,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    height: '100%',
  },
  errorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#E24A4A',
    flex: 1,
  },
  submitBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  switchWrap: {
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 8,
  },
  switchText: {
    fontSize: 14,
    color: '#6C63FF',
  },
});
