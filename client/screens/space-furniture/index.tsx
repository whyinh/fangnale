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
  Image,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { authFetch } from '@/utils/api';
import Toast from 'react-native-toast-message';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface LayerInfo {
  id: number;
  name: string;
  grid_pos: number | null;
  item_count: number;
}

interface SpaceItem {
  id: number;
  name: string;
  photo_key: string | null;
  location_id: number | null;
  layer_id: number | null;
  layer_name: string | null;
  categories?: { id: number; name: string } | null;
}

// 家具详情：隔层网格 + 物品列表（空间树第三级）
export default function SpaceFurnitureScreen() {
  const router = useSafeRouter();
  const { id, name } = useSafeSearchParams<{ id: number; name: string }>();
  const furnitureId = Number(id);

  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<number | null>(null); // null = 全部
  const [addVisible, setAddVisible] = useState(false);
  const [layerName, setLayerName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：GET /api/v1/locations/:id/items
       * 返回：{ layers: LayerInfo[], items: SpaceItem[] }
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${furnitureId}/items`);
      if (res.ok) {
        const data = await res.json();
        setLayers(data.layers || []);
        setItems(data.items || []);

        // 异步补齐照片签名 URL
        (data.items || []).forEach(async (item: SpaceItem) => {
          if (item.photo_key && !photoUrls[item.id]) {
            try {
              /**
               * 服务端文件：server/src/routes/upload.ts
               * 接口：POST /api/v1/upload/photo-url
               * Body 参数：key: string
               */
              const photoRes = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: item.photo_key }),
              });
              if (photoRes.ok) {
                const { url } = await photoRes.json();
                setPhotoUrls((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: url }));
              }
            } catch {
              // 单张失败忽略
            }
          }
        });
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [furnitureId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleAddLayer = async () => {
    const lname = layerName.trim();
    if (!lname) {
      Toast.show({ type: 'error', text1: '请输入隔层名称' });
      return;
    }
    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：POST /api/v1/locations/:id/layers
       * Body 参数：name: string
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${furnitureId}/layers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: lname }),
      });
      if (!res.ok) throw new Error();
      setAddVisible(false);
      setLayerName('');
      fetchData();
      Toast.show({ type: 'success', text1: `已添加「${lname}」` });
    } catch {
      Toast.show({ type: 'error', text1: '添加失败，请重试' });
    } finally {
      setSaving(false);
    }
  };

  const displayItems = activeLayer === null ? items : items.filter((it) => it.layer_id === activeLayer);
  const activeLayerName = activeLayer === null ? null : layers.find((l) => l.id === activeLayer)?.name;

  return (
    <Screen style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <FontAwesome6 name="chevron-left" size={18} color="#2D3436" />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle} numberOfLines={1}>{name || '家具'}</Text>
          <Text style={styles.headerSubtitle}>{layers.length} 个隔层 · {items.length} 件物品</Text>
        </View>
        <TouchableOpacity onPress={() => setAddVisible(true)} hitSlop={8} style={styles.addLayerBtn}>
          <FontAwesome6 name="plus" size={15} color="#6C63FF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* 隔层网格 */}
          <View style={styles.grid}>
            {/* 「全部」格 */}
            <TouchableOpacity
              style={[styles.cell, activeLayer === null && styles.cellActive]}
              onPress={() => setActiveLayer(null)}
              activeOpacity={0.75}
            >
              <View style={styles.cellIconWrap}>
                <FontAwesome6 name="border-all" size={18} color={activeLayer === null ? '#6C63FF' : '#9EA0A5'} />
              </View>
              <Text style={[styles.cellName, activeLayer === null && styles.cellNameActive]}>全部</Text>
              <Text style={styles.cellCount}>{items.length} 件</Text>
            </TouchableOpacity>

            {layers.map((layer) => {
              const active = activeLayer === layer.id;
              const layerItems = items.filter((it) => it.layer_id === layer.id);
              const firstPhoto = layerItems.find((it) => it.photo_key && photoUrls[it.id]);
              return (
                <TouchableOpacity
                  key={layer.id}
                  style={[styles.cell, active && styles.cellActive, layer.item_count === 0 && styles.cellEmpty]}
                  onPress={() => setActiveLayer(active ? null : layer.id)}
                  activeOpacity={0.75}
                >
                  {firstPhoto && photoUrls[firstPhoto.id] ? (
                    <Image source={{ uri: photoUrls[firstPhoto.id] }} style={styles.cellThumb} />
                  ) : (
                    <View style={styles.cellIconWrap}>
                      <FontAwesome6
                        name={layer.item_count > 0 ? 'grip-lines' : 'plus'}
                        size={16}
                        color={active ? '#6C63FF' : '#C0C0C8'}
                      />
                    </View>
                  )}
                  <Text style={[styles.cellName, active && styles.cellNameActive]} numberOfLines={1}>
                    {layer.name}
                  </Text>
                  <Text style={styles.cellCount}>{layer.item_count} 件</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 物品列表 */}
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>{activeLayerName ? `「${activeLayerName}」里的物品` : '全部物品'}</Text>
          </View>

          {displayItems.length === 0 ? (
            <View style={styles.emptyItems}>
              <FontAwesome6 name="box-open" size={28} color="#C0C0C8" />
              <Text style={styles.emptyItemsText}>
                {activeLayerName ? '这个隔层还是空的' : '这件家具还没有物品'}
              </Text>
              <Text style={styles.emptyItemsDesc}>在物品详情页可以把物品挂到隔层里</Text>
            </View>
          ) : (
            displayItems.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.itemCard}
                onPress={() => router.push('/item-detail', { id: item.id })}
                activeOpacity={0.75}
              >
                {photoUrls[item.id] ? (
                  <Image source={{ uri: photoUrls[item.id] }} style={styles.itemImage} />
                ) : (
                  <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                    <FontAwesome6 name="image" size={18} color="#B2BEC3" />
                  </View>
                )}
                <View style={styles.itemBody}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {item.categories?.name || '未分类'}
                    {item.layer_name ? ` · ${item.layer_name}` : ''}
                  </Text>
                </View>
                <FontAwesome6 name="chevron-right" size={12} color="#C0C0C8" />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* 添加隔层 Modal */}
      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>添加隔层</Text>
            <TextInput
              style={styles.modalInput}
              value={layerName}
              onChangeText={setLayerName}
              placeholder="例如：顶层抽屉、最里侧"
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
                onPress={handleAddLayer}
                disabled={saving}
              >
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.modalConfirmText}>添加</Text>}
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
  addLayerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell: {
    width: '31.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  cellActive: {
    borderColor: '#6C63FF',
    backgroundColor: '#F7F6FF',
  },
  cellEmpty: {
    borderColor: '#E8E8EE',
    borderStyle: 'dashed',
    shadowOpacity: 0,
    elevation: 0,
  },
  cellThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  cellIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
    maxWidth: '100%',
  },
  cellNameActive: {
    color: '#6C63FF',
  },
  cellCount: {
    fontSize: 11,
    color: '#9EA0A5',
  },
  itemsHeader: {
    marginTop: 22,
    marginBottom: 12,
  },
  itemsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  emptyItems: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyItemsText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  emptyItemsDesc: {
    fontSize: 13,
    color: '#9EA0A5',
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  itemImage: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },
  itemImagePlaceholder: {
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  itemSub: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 3,
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
