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
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { authFetch } from '@/utils/api';
import Toast from 'react-native-toast-message';
import type { LocationNode } from '@/components/LocationPicker';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface FurnitureTemplate {
  key: string;
  name: string;
  icon: string;
  layers: string[];
}

// 房间详情：家具列表（空间树第二级）
export default function SpaceRoomScreen() {
  const router = useSafeRouter();
  const { id, name } = useSafeSearchParams<{ id: number; name: string }>();
  const roomId = Number(id);

  const [room, setRoom] = useState<LocationNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [templates, setTemplates] = useState<FurnitureTemplate[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<FurnitureTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchRoom = useCallback(async () => {
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：GET /api/v1/locations/tree
       * 无参数（返回整棵树，本页取当前房间节点）
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/tree`);
      if (res.ok) {
        const tree: LocationNode[] = await res.json();
        setRoom(tree.find((n) => n.id === roomId) || null);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useFocusEffect(
    useCallback(() => {
      fetchRoom();
    }, [fetchRoom])
  );

  const openAddModal = async () => {
    setAddVisible(true);
    setSelectedTpl(null);
    setCustomName('');
    if (templates.length === 0) {
      try {
        /**
         * 服务端文件：server/src/routes/locations.ts
         * 接口：GET /api/v1/locations/templates
         * 无参数
         */
        const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/templates`);
        if (res.ok) setTemplates(await res.json());
      } catch {
        // 静默失败
      }
    }
  };

  const handleAddFurniture = async () => {
    if (!selectedTpl) {
      Toast.show({ type: 'error', text1: '请选择家具类型' });
      return;
    }
    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：POST /api/v1/locations/furniture
       * Body 参数：room_id: number, template: string, name?: string
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/furniture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          template: selectedTpl.key,
          name: customName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || '创建失败');
      }
      setAddVisible(false);
      fetchRoom();
      Toast.show({ type: 'success', text1: `已添加「${customName.trim() || selectedTpl.name}」` });
    } catch (e) {
      Toast.show({ type: 'error', text1: e instanceof Error ? e.message : '创建失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFurniture = (node: LocationNode) => {
    Alert.alert(
      '删除家具',
      `将删除「${node.name}」及其所有隔层。\n\n里面的物品不会被删除，只是脱离空间位置。`,
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
            const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${node.id}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              fetchRoom();
              Toast.show({ type: 'success', text1: '已删除家具' });
            } else {
              Toast.show({ type: 'error', text1: '删除失败，请重试' });
            }
          },
        },
      ]
    );
  };

  const furnitureList = room?.children || [];

  return (
    <Screen style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <FontAwesome6 name="chevron-left" size={18} color="#2D3436" />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle} numberOfLines={1}>{name || '房间'}</Text>
          <Text style={styles.headerSubtitle}>
            {furnitureList.length} 件家具 · {room?.total_count ?? 0} 件物品
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {furnitureList.length === 0 ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIconWrap}>
                <FontAwesome6 name="couch" size={36} color="#6C63FF" />
              </View>
              <Text style={styles.emptyTitle}>这个房间还没有家具</Text>
              <Text style={styles.emptyDesc}>添加衣柜、书架等家具，{'\n'}隔层会自动生成</Text>
            </View>
          ) : (
            furnitureList.map((node) => (
              <TouchableOpacity
                key={node.id}
                style={styles.card}
                onPress={() => router.push('/space-furniture', { id: node.id, name: node.name })}
                onLongPress={() => handleDeleteFurniture(node)}
                delayLongPress={400}
                activeOpacity={0.75}
              >
                <View style={styles.cardIcon}>
                  <FontAwesome6 name={(node.template && TPL_ICON[node.template]) || 'box'} size={19} color="#A0845C" />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName}>{node.name}</Text>
                  <Text style={styles.cardSub}>
                    {node.children.length} 个隔层 · {node.total_count} 件物品
                  </Text>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color="#C0C0C8" />
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity style={styles.addCard} onPress={openAddModal} activeOpacity={0.75}>
            <FontAwesome6 name="plus" size={15} color="#6C63FF" />
            <Text style={styles.addCardText}>添加家具</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* 添加家具 Modal */}
      <Modal visible={addVisible} transparent animationType="slide" onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAddVisible(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>选择家具类型</Text>
            <ScrollView style={styles.tplScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.tplGrid}>
                {templates.map((tpl) => {
                  const active = selectedTpl?.key === tpl.key;
                  return (
                    <TouchableOpacity
                      key={tpl.key}
                      style={[styles.tplItem, active && styles.tplItemActive]}
                      onPress={() => setSelectedTpl(tpl)}
                      activeOpacity={0.75}
                    >
                      <FontAwesome6 name={tpl.icon as never} size={22} color={active ? '#6C63FF' : '#A0845C'} />
                      <Text style={[styles.tplName, active && styles.tplNameActive]}>{tpl.name}</Text>
                      <Text style={styles.tplLayers}>{tpl.layers.length} 层</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            {selectedTpl && (
              <>
                <TextInput
                  style={styles.nameInput}
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder={`自定义名称（默认「${selectedTpl.name}」）`}
                  placeholderTextColor="#9EA0A5"
                  maxLength={20}
                />
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>将自动生成隔层：</Text>
                  <Text style={styles.previewLayers}>{selectedTpl.layers.join('、')}</Text>
                </View>
              </>
            )}
            <TouchableOpacity
              style={[styles.confirmBtn, (!selectedTpl || saving) && { opacity: 0.5 }]}
              onPress={handleAddFurniture}
              disabled={!selectedTpl || saving}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.confirmText}>添加</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const TPL_ICON: Record<string, string> = {
  wardrobe: 'door-closed',
  drawer_chest: 'box-archive',
  bookshelf: 'book',
  shelf: 'layer-group',
  cabinet: 'boxes-stacked',
  desk: 'laptop',
  bedside: 'bed',
  fridge: 'snowflake',
  shoe_rack: 'shoe-prints',
  box: 'box-open',
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F0F0F3',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBody: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2D3436',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 2,
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
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
  },
  emptyDesc: {
    fontSize: 14,
    color: '#9EA0A5',
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
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
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F7F2EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  cardSub: {
    fontSize: 13,
    color: '#9EA0A5',
    marginTop: 3,
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
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '82%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E6',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 14,
  },
  tplScroll: {
    flexGrow: 0,
  },
  tplGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tplItem: {
    width: '30.5%',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderRadius: 16,
    paddingVertical: 16,
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tplItemActive: {
    backgroundColor: '#F0EFFF',
    borderColor: '#6C63FF',
  },
  tplName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3436',
  },
  tplNameActive: {
    color: '#6C63FF',
  },
  tplLayers: {
    fontSize: 11,
    color: '#9EA0A5',
  },
  nameInput: {
    height: 50,
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#2D3436',
    marginTop: 14,
  },
  previewBox: {
    backgroundColor: '#F7F2EA',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  previewLabel: {
    fontSize: 12,
    color: '#A0845C',
    fontWeight: '600',
  },
  previewLayers: {
    fontSize: 13,
    color: '#6B5B3E',
    marginTop: 4,
  },
  confirmBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
});
