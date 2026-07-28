import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { authFetch } from '@/utils/api';
import Toast from 'react-native-toast-message';
import type { LocationNode } from '@/components/LocationPicker';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

// 空间 Tab：房间列表（空间树第一级）
export default function SpaceScreen() {
  const router = useSafeRouter();
  const [rooms, setRooms] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTree = useCallback(async () => {
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：GET /api/v1/locations/tree
       * 无参数
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/tree`);
      if (res.ok) setRooms(await res.json());
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTree();
    }, [fetchTree])
  );

  const handleAddRoom = async () => {
    const name = roomName.trim();
    if (!name) {
      Toast.show({ type: 'error', text1: '请输入房间名称' });
      return;
    }
    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：POST /api/v1/locations/rooms
       * Body 参数：name: string
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || '创建失败');
      }
      setAddVisible(false);
      setRoomName('');
      fetchTree();
      Toast.show({ type: 'success', text1: `已创建「${name}」` });
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : '创建失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const handleRoomOptions = (room: LocationNode) => {
    Alert.alert(room.name, undefined, [
      {
        text: '重命名',
        onPress: () => {
          if (Platform.OS === 'ios') {
            Alert.prompt(
              '重命名房间',
              undefined,
              async (text) => {
                const name = (text || '').trim();
                if (!name) return;
                /**
                 * 服务端文件：server/src/routes/locations.ts
                 * 接口：PUT /api/v1/locations/:id
                 * Body 参数：name: string
                 */
                await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${room.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name }),
                });
                fetchTree();
              },
              'plain-text',
              room.name
            );
          } else {
            Toast.show({ type: 'info', text1: '请在房间内长按名称修改' });
          }
        },
      },
      {
        text: '删除房间',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            '删除房间',
            `将删除「${room.name}」及其中所有家具和隔层。\n\n里面的物品不会被删除，只是脱离空间位置。`,
            [
              { text: '取消', style: 'cancel' },
              {
                text: '删除',
                style: 'destructive',
                onPress: async () => {
                  /**
                   * 服务端文件：server/src/routes/locations.ts
                   * 接口：DELETE /api/v1/locations/:id
                   * 无参数
                   */
                  const res = await authFetch(
                    `${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${room.id}`,
                    { method: 'DELETE' }
                  );
                  if (res.ok) {
                    fetchTree();
                    Toast.show({ type: 'success', text1: '已删除房间' });
                  } else {
                    Toast.show({ type: 'error', text1: '删除失败，请重试' });
                  }
                },
              },
            ]
          ),
      },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <Screen style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的空间</Text>
        <Text style={styles.headerSubtitle}>像翻真实柜子一样找东西</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {rooms.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <FontAwesome6 name="door-open" size={40} color="#6C63FF" />
              </View>
              <Text style={styles.emptyTitle}>还没有空间</Text>
              <Text style={styles.emptyDesc}>
                创建房间和家具，把物品挂到具体的柜子隔层里，{'\n'}找东西时就能按位置逐层翻找
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => setAddVisible(true)} activeOpacity={0.85}>
                <FontAwesome6 name="plus" size={14} color="#FFF" />
                <Text style={styles.emptyBtnText}>创建第一个房间</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {rooms.map((room) => (
                <TouchableOpacity
                  key={room.id}
                  style={styles.roomCard}
                  onPress={() => router.push('/space-room', { id: room.id, name: room.name })}
                  onLongPress={() => handleRoomOptions(room)}
                  delayLongPress={400}
                  activeOpacity={0.75}
                >
                  <View style={styles.roomIcon}>
                    <FontAwesome6 name="door-open" size={20} color="#6C63FF" />
                  </View>
                  <View style={styles.roomBody}>
                    <Text style={styles.roomName}>{room.name}</Text>
                    <Text style={styles.roomSub}>
                      {room.children.length} 件家具 · {room.total_count} 件物品
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRoomOptions(room)} hitSlop={8} style={styles.moreBtn}>
                    <FontAwesome6 name="ellipsis" size={16} color="#B2BEC3" />
                  </TouchableOpacity>
                  <FontAwesome6 name="chevron-right" size={14} color="#C0C0C8" />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.addCard} onPress={() => setAddVisible(true)} activeOpacity={0.75}>
                <FontAwesome6 name="plus" size={15} color="#6C63FF" />
                <Text style={styles.addCardText}>添加房间</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* 添加房间 Modal */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>创建房间</Text>
            <TextInput
              style={styles.modalInput}
              value={roomName}
              onChangeText={setRoomName}
              placeholder="例如：主卧、客厅、书房"
              placeholderTextColor="#9EA0A5"
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setAddVisible(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, saving && { opacity: 0.6 }]}
                onPress={handleAddRoom}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>创建</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F0F0F3',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2D3436',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 4,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 12,
  },
  emptyBox: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 14,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
  },
  emptyDesc: {
    fontSize: 14,
    color: '#9EA0A5',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#6C63FF',
    paddingHorizontal: 22,
    height: 48,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    gap: 14,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  roomIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomBody: {
    flex: 1,
  },
  roomName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
  },
  roomSub: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 3,
  },
  moreBtn: {
    padding: 4,
  },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: '#E3E1FF',
    borderStyle: 'dashed',
  },
  addCardText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6C63FF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 14,
  },
  modalInput: {
    height: 50,
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#2D3436',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalCancel: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F7',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  modalConfirm: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6C63FF',
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
});
