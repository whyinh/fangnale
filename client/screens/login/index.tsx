/**
 * 登录/注册页
 * - 登录方式：手机号验证码（默认，登录注册一体）/ 邮箱密码（登录、注册分视图）
 * - 品牌区展示 Auth 配置的应用图标与名称
 * - 内联错误提示、loading 防重复、键盘避让
 */
import React, { useState, useRef, useEffect } from 'react';
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
  Image,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';

// 与 Supabase Auth 配置保持一致的应用图标与名称
const APP_ICON_URL =
  'https://coze-coding-project.tos.coze.site/gen_project_icon/2026-07-28/7667241492628422698_1785177754.png?sign=4907255132-a1fae8a669-0-5a9065abea1a8e997c0875a49c6c9f57c94800fa73160ffa94409f00cf16f0a1';
const APP_NAME = '放哪了';

type Method = 'phone' | 'email';

function mapError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return '邮箱或密码错误';
  if (m.includes('user already registered')) return '该邮箱已注册，请直接登录';
  if (m.includes('password') && m.includes('least')) return '密码至少需要 6 位';
  if (m.includes('invalid') && m.includes('email')) return '邮箱格式不正确';
  if (m.includes('otp') && (m.includes('expired') || m.includes('invalid'))) {
    return '验证码错误或已过期，请重试或重新获取';
  }
  if (m.includes('rate limit') || m.includes('too many') || m.includes('frequency')) {
    return '操作太频繁，请稍后再试';
  }
  return msg || '操作失败，请重试';
}

export default function LoginScreen() {
  const [method, setMethod] = useState<Method>('phone');

  return (
    <Screen style={styles.screen}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
        <View style={styles.container}>
          {/* 品牌区 */}
          <View style={styles.brand}>
            <Image source={{ uri: APP_ICON_URL }} style={styles.appIcon} />
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.appSlogan}>你的物品，一目了然</Text>
          </View>

          {/* 登录方式切换（手机号优先） */}
          <View style={styles.methodTabs}>
            <TouchableOpacity
              style={[styles.methodTab, method === 'phone' && styles.methodTabActive]}
              onPress={() => setMethod('phone')}
              activeOpacity={0.8}
            >
              <Text style={[styles.methodTabText, method === 'phone' && styles.methodTabTextActive]}>
                手机号
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.methodTab, method === 'email' && styles.methodTabActive]}
              onPress={() => setMethod('email')}
              activeOpacity={0.8}
            >
              <Text style={[styles.methodTabText, method === 'email' && styles.methodTabTextActive]}>
                邮箱
              </Text>
            </TouchableOpacity>
          </View>

          {/* 表单区（key 强制重挂载重置表单） */}
          <View key={method} style={styles.formArea}>
            {method === 'phone' ? <PhoneForm /> : <EmailForm />}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

/* ================= 手机号验证码登录（登录注册一体） ================= */

function PhoneForm() {
  const { sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [resendTick, setResendTick] = useState(0);

  const handleSend = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      setErrorText('请输入正确的 11 位手机号');
      return;
    }
    setSending(true);
    setErrorText('');
    try {
      await sendPhoneOtp(phone);
      // 发送成功直接进入验证码步骤（倒计时自动开始）
      setStep('code');
    } catch (e) {
      setErrorText(mapError(e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  };

  return (
    <View>
      {step === 'phone' ? (
        <View>
          <Text style={styles.title}>手机号登录</Text>
          <Text style={styles.subtitle}>未注册的手机号验证通过后将自动注册</Text>

          {/* 手机号输入（区号 +86 固定） */}
          <View style={styles.inputWrap}>
            <Text style={styles.areaCode}>+86</Text>
            <View style={styles.areaDivider} />
            <TextInput
              style={styles.input}
              placeholder="请输入手机号"
              placeholderTextColor="#9EA0A5"
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 11))}
              keyboardType="phone-pad"
              maxLength={11}
            />
          </View>

          {errorText ? (
            <View style={styles.errorWrap}>
              <FontAwesome6 name="circle-exclamation" size={13} color="#E24A4A" />
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, sending && styles.submitBtnDisabled]}
            onPress={handleSend}
            disabled={sending}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitBtnText}>获取验证码</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <OtpCodeForm
          phone={phone}
          resendTick={resendTick}
          onResend={async () => {
            await sendPhoneOtp(phone);
            setResendTick((t) => t + 1);
          }}
          onVerify={async (code) => {
            await verifyPhoneOtp(phone, code);
            // 成功后由路由守卫自动跳转首页
          }}
          onBack={() => {
            setStep('phone');
            setErrorText('');
          }}
        />
      )}
    </View>
  );
}

/** 6 位验证码输入视图 */
function OtpCodeForm({
  phone,
  resendTick,
  onResend,
  onVerify,
  onBack,
}: {
  phone: string;
  resendTick: number;
  onResend: () => Promise<void>;
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
}) {
  const [codes, setCodes] = useState<string[]>(Array(6).fill(''));
  const [countdown, setCountdown] = useState(60);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorText, setErrorText] = useState('');
  const inputRefs = useRef<Array<TextInput | null>>([]);
  const verifyingRef = useRef(false);

  // 倒计时：进入本步骤或重发后重置为 60 秒
  useEffect(() => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTick]);

  // 首次进入自动聚焦第一个输入框
  useEffect(() => {
    const t = setTimeout(() => inputRefs.current[0]?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const submit = async (fullCode: string) => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    setErrorText('');
    try {
      await onVerify(fullCode);
    } catch (e) {
      // 校验失败：提示并清空已输入验证码，重新聚焦第一个输入框
      setErrorText(mapError(e instanceof Error ? e.message : String(e)));
      setCodes(Array(6).fill(''));
      inputRefs.current[0]?.focus();
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  const handleChange = (text: string, index: number) => {
    const digits = text.replace(/\D/g, '');
    if (!digits) {
      // 清空当前格
      const next = [...codes];
      next[index] = '';
      setCodes(next);
      return;
    }
    if (digits.length > 1) {
      // 粘贴：逐位填充
      const next = [...codes];
      for (let i = 0; i < digits.length && index + i < 6; i++) {
        next[index + i] = digits[i];
      }
      setCodes(next);
      const focusIdx = Math.min(index + digits.length, 5);
      inputRefs.current[focusIdx]?.focus();
      if (next.every((c) => c)) submit(next.join(''));
      return;
    }
    const next = [...codes];
    next[index] = digits;
    setCodes(next);
    if (index < 5) inputRefs.current[index + 1]?.focus();
    if (next.every((c) => c)) submit(next.join(''));
  };

  const handleKeyPress = (e: { nativeEvent: { key: string } }, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !codes[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setErrorText('');
    try {
      await onResend();
      setCodes(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    } catch (e) {
      setErrorText(mapError(e instanceof Error ? e.message : String(e)));
    } finally {
      setResending(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>输入验证码</Text>
      <Text style={styles.subtitle}>验证码已发送至 +86 {phone}</Text>

      {/* 6 位验证码框 */}
      <View style={styles.otpRow}>
        {codes.map((code, idx) => (
          <TextInput
            key={idx}
            ref={(r) => {
              inputRefs.current[idx] = r;
            }}
            style={[styles.otpBox, code ? styles.otpBoxFilled : null]}
            value={code}
            onChangeText={(t) => handleChange(t, idx)}
            onKeyPress={(e) => handleKeyPress(e, idx)}
            keyboardType="number-pad"
            maxLength={6}
            selectTextOnFocus
          />
        ))}
      </View>

      {errorText ? (
        <View style={styles.errorWrap}>
          <FontAwesome6 name="circle-exclamation" size={13} color="#E24A4A" />
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      ) : null}

      {verifying ? (
        <View style={styles.verifyingRow}>
          <ActivityIndicator size="small" color="#6C63FF" />
          <Text style={styles.verifyingText}>验证中…</Text>
        </View>
      ) : null}

      {/* 重新发送 / 倒计时 */}
      <TouchableOpacity
        style={styles.resendWrap}
        onPress={handleResend}
        disabled={countdown > 0 || resending}
      >
        {resending ? (
          <ActivityIndicator size="small" color="#6C63FF" />
        ) : (
          <Text style={[styles.resendText, countdown > 0 && styles.resendTextDisabled]}>
            {countdown > 0 ? `重新发送（${countdown}s）` : '重新发送'}
          </Text>
        )}
      </TouchableOpacity>

      {/* 返回修改手机号 */}
      <TouchableOpacity style={styles.switchWrap} onPress={onBack}>
        <Text style={styles.switchText}>更换手机号</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ================= 邮箱密码登录/注册 ================= */

function EmailForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  return (
    <View key={mode}>
      <EmailAuthForm mode={mode} onSwitch={() => setMode(mode === 'login' ? 'register' : 'login')} />
    </View>
  );
}

function EmailAuthForm({ mode, onSwitch }: { mode: 'login' | 'register'; onSwitch: () => void }) {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  const isRegister = mode === 'register';

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

      {errorText ? (
        <View style={styles.errorWrap}>
          <FontAwesome6 name="circle-exclamation" size={13} color="#E24A4A" />
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      ) : null}

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
    marginBottom: 28,
  },
  appIcon: {
    width: 72,
    height: 72,
    borderRadius: 16,
  },
  appName: {
    marginTop: 14,
    fontSize: 26,
    fontWeight: '700',
    color: '#2D3436',
  },
  appSlogan: {
    marginTop: 6,
    fontSize: 14,
    color: '#9EA0A5',
  },
  methodTabs: {
    flexDirection: 'row',
    backgroundColor: '#E8E8EE',
    borderRadius: 14,
    padding: 4,
    marginBottom: 22,
  },
  methodTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
  },
  methodTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  methodTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9EA0A5',
  },
  methodTabTextActive: {
    color: '#2D3436',
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
  areaCode: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  areaDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E0E0E6',
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
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  otpBox: {
    width: 48,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#F5F5F7',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: '#2D3436',
  },
  otpBoxFilled: {
    backgroundColor: '#6C63FF15',
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  verifyingText: {
    fontSize: 13,
    color: '#6C63FF',
  },
  resendWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  resendText: {
    fontSize: 14,
    color: '#6C63FF',
    fontWeight: '600',
  },
  resendTextDisabled: {
    color: '#9EA0A5',
  },
});
