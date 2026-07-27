/**
 * 我的页：用户信息 + 家庭共享管理 + 退出登录
 * 服务端接口：
 * - GET  /api/v1/families/my              （family + members[]，无家庭 family 为 null）
 * - POST /api/v1/families/create          Body: { name: string }
 * - POST /api/v1/families/join            Body: { invite_code: string }
 * - POST /api/v1/families/leave           （owner 退出 = 解散家庭）
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/utils/api';
import { formatContact, contactAvatarText } from '@/utils/format';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface FamilyMember {
  id: number;
  user_id: string;
  user_email: string;
  user_name?: string | null;
  role: 'owner' | 'member';
  joined_at: string;
}

interface Family {
  id: number;
  name: string;
  invite_code: string;
  owner_id: string;
}

export default function ProfileScreen() {
  const { user, signOut, updateProfile } = useAuth();
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchFamily = useCallback(async () => {
    /**
     * 服务端文件：server/src/routes/families.ts
     * 接口：GET /api/v1/families/my
     * 响应：{ family: Family | null, members: FamilyMember[] }
     */
    try {
      const res = await authFetch(`${BASE_URL}/api/v1/families/my`);
      const data = await res.json();
      if (res.ok) {
        setFamily(data.family ?? null);
        setMembers(data.members ?? []);
      }
    } catch {
      // 静默失败，保持旧数据
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchFamily();
    }, [fetchFamily])
  );

  const handleCreate = async () => {
    if (!familyName.trim()) {
      Toast.show({ type: 'error', text1: '请输入家庭名称' });
      return;
    }
    setCreating(true);
    /**
     * 服务端文件：server/src/routes/families.ts
     * 接口：POST /api/v1/families/create
     * Body 参数：name: string
     */
    try {
      const res = await authFetch(`${BASE_URL}/api/v1/families/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: familyName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        Toast.show({ type: 'success', text1: '家庭创建成功' });
        setFamilyName('');
        fetchFamily();
      } else {
        Toast.show({ type: 'error', text1: data.error || '创建失败' });
      }
    } catch {
      Toast.show({ type: 'error', text1: '网络异常，请重试' });
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteInput.trim()) {
      Toast.show({ type: 'error', text1: '请输入邀请码' });
      return;
    }
    setJoining(true);
    /**
     * 服务端文件：server/src/routes/families.ts
     * 接口：POST /api/v1/families/join
     * Body 参数：invite_code: string
     */
    try {
      const res = await authFetch(`${BASE_URL}/api/v1/families/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_code: inviteInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        Toast.show({ type: 'success', text1: '已加入家庭' });
        setInviteInput('');
        fetchFamily();
      } else {
        Toast.show({ type: 'error', text1: data.error || '加入失败' });
      }
    } catch {
      Toast.show({ type: 'error', text1: '网络异常，请重试' });
    } finally {
      setJoining(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!family) return;
    await Clipboard.setStringAsync(family.invite_code);
    Toast.show({ type: 'success', text1: '邀请码已复制' });
  };

  const doLeave = async () => {
    setLeaving(true);
    /**
     * 服务端文件：server/src/routes/families.ts
     * 接口：POST /api/v1/families/leave
     * Body 参数：无（owner 退出即解散家庭）
     */
    try {
      const res = await authFetch(`${BASE_URL}/api/v1/families/leave`, { method: 'POST' });
      if (res.ok) {
        setFamily(null);
        setMembers([]);
        Toast.show({ type: 'success', text1: '已退出家庭' });
      } else {
        const data = await res.json();
        Toast.show({ type: 'error', text1: data.error || '退出失败' });
      }
    } catch {
      Toast.show({ type: 'error', text1: '网络异常，请重试' });
    } finally {
      setLeaving(false);
    }
  };

  const handleLeave = () => {
    if (!family) return;
    const isOwner = family.owner_id === user?.id;
    Alert.alert(
      isOwner ? '解散家庭' : '退出家庭',
      isOwner
        ? '你是家庭创建者，退出将解散家庭，所有成员都会被移出。确定要解散吗？'
        : '退出后你将看不到其他成员的物品。确定要退出吗？',
      [
        { text: '取消', style: 'cancel' },
        { text: isOwner ? '解散' : '退出', style: 'destructive', onPress: doLeave },
      ]
    );
  };

  const handleSignOut = () => {
    Alert.alert('退出登录', '退出后需要重新登录才能访问数据。确定要退出吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          // 路由守卫自动跳登录页
        },
      },
    ]);
  };

  const myContact = user?.email || user?.phone || '';
  const myName =
    typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? (user.user_metadata.full_name as string).trim()
      : '';
  const userInitial = contactAvatarText(myName || myContact);
  const isOwner = family?.owner_id === user?.id;

  const openNameModal = () => {
    setNameInput(myName);
    setNameModalVisible(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      Toast.show({ type: 'error', text1: '昵称不能为空' });
      return;
    }
    if (trimmed.length > 20) {
      Toast.show({ type: 'error', text1: '昵称最多 20 个字符' });
      return;
    }
    setSavingName(true);
    try {
      await updateProfile(trimmed);
      setNameModalVisible(false);
      Toast.show({ type: 'success', text1: '昵称已更新' });
      // 后端会随下次请求自动同步昵称到家庭成员，这里主动刷新成员列表
      fetchFamily();
    } catch {
      Toast.show({ type: 'error', text1: '保存失败，请重试' });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>我的</Text>

        {/* 用户信息卡 */}
        <View style={styles.card}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{userInitial}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userEmail} numberOfLines={1}>
                {myName || '未设置昵称'}
              </Text>
              <Text style={styles.userContact} numberOfLines={1}>
                {formatContact(myContact) || '—'}
              </Text>
            </View>
            <TouchableOpacity style={styles.editNameBtn} onPress={openNameModal} activeOpacity={0.7}>
              <FontAwesome6 name="pen" size={13} color="#6C63FF" />
            </TouchableOpacity>
          </View>
          <View style={styles.syncBadge}>
            <FontAwesome6 name="cloud-arrow-up" size={11} color="#4CAF50" />
            <Text style={styles.syncText}>云端同步已开启</Text>
          </View>
        </View>

        {/* 家庭卡 */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIconBox}>
              <FontAwesome6 name="people-roof" size={18} color="#6C63FF" />
            </View>
            <Text style={styles.cardTitle}>我的家庭</Text>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color="#6C63FF" style={{ marginVertical: 20 }} />
          ) : family ? (
            <View>
              {/* 家庭信息 + 邀请码 */}
              <View style={styles.familyInfoRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.familyName}>{family.name}</Text>
                  <Text style={styles.memberCount}>{members.length} 位成员</Text>
                </View>
                <TouchableOpacity style={styles.inviteBtn} onPress={handleCopyInvite}>
                  <FontAwesome6 name="copy" size={13} color="#6C63FF" />
                  <Text style={styles.inviteBtnText}>{family.invite_code}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.inviteHint}>把邀请码分享给家人，加入后全家物品互通</Text>

              {/* 成员列表 */}
              <View style={styles.memberList}>
                {members.map((m) => (
                  <View key={m.id} style={styles.memberRow}>
                    <View style={[styles.memberAvatar, m.role === 'owner' && styles.ownerAvatar]}>
                      <Text style={[styles.memberAvatarText, m.role === 'owner' && styles.ownerAvatarText]}>
                        {contactAvatarText(m.user_name || m.user_email)}
                      </Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberEmail} numberOfLines={1}>
                        {m.user_name || formatContact(m.user_email)}
                        {m.user_id === user?.id ? '（我）' : ''}
                      </Text>
                      {m.user_name ? (
                        <Text style={styles.memberContact} numberOfLines={1}>
                          {formatContact(m.user_email)}
                        </Text>
                      ) : null}
                    </View>
                    {m.role === 'owner' && (
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleBadgeText}>创建者</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* 退出/解散 */}
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={handleLeave}
                disabled={leaving}
              >
                {leaving ? (
                  <ActivityIndicator size="small" color="#E24A4A" />
                ) : (
                  <Text style={styles.leaveBtnText}>{isOwner ? '解散家庭' : '退出家庭'}</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.emptyDesc}>
                创建家庭或输入邀请码加入，全家人的物品记录自动互通，共同管理
              </Text>

              {/* 创建家庭 */}
              <View style={styles.formBlock}>
                <TextInput
                  style={styles.textInput}
                  placeholder="家庭名称，如：我们仨"
                  placeholderTextColor="#9EA0A5"
                  value={familyName}
                  onChangeText={setFamilyName}
                  maxLength={20}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, creating && styles.btnDisabled]}
                  onPress={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryBtnText}>创建家庭</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>或</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* 加入家庭 */}
              <View style={styles.formBlock}>
                <TextInput
                  style={styles.textInput}
                  placeholder="输入 6 位邀请码"
                  placeholderTextColor="#9EA0A5"
                  value={inviteInput}
                  onChangeText={setInviteInput}
                  autoCapitalize="characters"
                  maxLength={6}
                />
                <TouchableOpacity
                  style={[styles.secondaryBtn, joining && styles.btnDisabled]}
                  onPress={handleJoin}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#6C63FF" />
                  ) : (
                    <Text style={styles.secondaryBtnText}>加入家庭</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* 退出登录 */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <FontAwesome6 name="right-from-bracket" size={15} color="#E24A4A" />
          <Text style={styles.signOutText}>退出登录</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>StashSpot v1.0.0</Text>
      </ScrollView>

      {/* 修改昵称弹窗 */}
      <Modal visible={nameModalVisible} transparent animationType="fade" onRequestClose={() => setNameModalVisible(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>修改昵称</Text>
              <Text style={styles.modalHint}>家庭成员将通过昵称认出你</Text>
              <TextInput
                style={styles.modalInput}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="请输入昵称"
                placeholderTextColor="#9EA0A5"
                maxLength={20}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
              />
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalCancelBtn]}
                  onPress={() => setNameModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalSaveBtn, savingName && styles.btnDisabled]}
                  onPress={handleSaveName}
                  disabled={savingName}
                  activeOpacity={0.8}
                >
                  {savingName ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSaveText}>保存</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F0F0F5',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  userInfo: {
    marginLeft: 14,
    flex: 1,
  },
  userEmail: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 6,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  syncText: {
    fontSize: 12,
    color: '#4CAF50',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#6C63FF15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
  },
  familyInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  familyName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
  },
  memberCount: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 3,
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6C63FF15',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  inviteBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6C63FF',
    letterSpacing: 1,
  },
  inviteHint: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 8,
    marginBottom: 14,
  },
  memberList: {
    borderTopWidth: 1,
    borderTopColor: '#F0F0F5',
    paddingTop: 12,
    gap: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatar: {
    backgroundColor: '#6C63FF',
  },
  memberAvatarText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C63FF',
  },
  ownerAvatarText: {
    color: '#FFFFFF',
  },
  memberEmail: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
  },
  roleBadge: {
    backgroundColor: '#6C63FF15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 11,
    color: '#6C63FF',
    fontWeight: '600',
  },
  leaveBtn: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E24A4A10',
  },
  leaveBtnText: {
    fontSize: 14,
    color: '#E24A4A',
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#9EA0A5',
    lineHeight: 20,
    marginBottom: 16,
  },
  formBlock: {
    gap: 10,
  },
  textInput: {
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    height: 50,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#2D3436',
  },
  primaryBtn: {
    backgroundColor: '#6C63FF',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtn: {
    backgroundColor: '#6C63FF15',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#6C63FF',
    fontSize: 15,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#F0F0F5',
  },
  dividerText: {
    fontSize: 12,
    color: '#9EA0A5',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 16,
  },
  signOutText: {
    fontSize: 15,
    color: '#E24A4A',
    fontWeight: '600',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#C0C0C8',
  },
  userContact: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 2,
  },
  editNameBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInfo: {
    flex: 1,
  },
  memberContact: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
    textAlign: 'center',
  },
  modalHint: {
    fontSize: 13,
    color: '#9EA0A5',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  modalInput: {
    height: 52,
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#2D3436',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtn: {
    backgroundColor: '#F5F5F7',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  modalSaveBtn: {
    backgroundColor: '#6C63FF',
  },
  modalSaveText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
