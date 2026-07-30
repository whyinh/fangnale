import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '@/components/Screen';
import { QuickSaveModal } from '@/components/QuickSaveModal';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { authFetch } from '@/utils/api';
import Toast from 'react-native-toast-message';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface NodeInfo {
  id: number;
  name: string;
  type: 'room' | 'furniture' | 'layer';
  template: string | null;
  cols: number | null;
}

interface LayerInfo {
  id: number;
  name: string;
  grid_pos: number | null;
  item_count: number;
}

interface AllItem {
  id: number;
  name: string;
  location: string;
  location_id: number | null;
  location_path: string | null;
}

interface SpaceItem {
  id: number;
  name: string;
  photo_key: string | null;
  location_id: number | null;
  location_path?: string;
  layer_id: number | null;
  layer_name: string | null;
  categories?: { id: number; name: string } | null;
}

// 家具图标映射（与后端模板一致）
const TEMPLATE_ICONS: Record<string, string> = {
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

// 家具详情（V2）：家具格子视图（按模板布局）+ 高亮定位 + 物品列表
export default function SpaceFurnitureScreen() {
  const router = useSafeRouter();
  const { id, name, highlightLayer, highlightItem } = useSafeSearchParams<{
    id: number;
    name?: string;
    highlightLayer?: number;
    highlightItem?: number;
  }>();
  const furnitureId = Number(id);
  const hlLayer = highlightLayer ? Number(highlightLayer) : null;
  const hlItem = highlightItem ? Number(highlightItem) : null;

  const [node, setNode] = useState<NodeInfo | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  // photoUrls 最新值镜像：fetchData 的 useCallback 闭包捕获的是定义时的旧 state（初始为空），
  // 导致"已有 URL 跳过"失效、每次刷新都重复请求签名 URL。闭包内必须读 ref。
  const photoUrlsRef = useRef<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState<number | null>(hlLayer);
  const [addVisible, setAddVisible] = useState(false);
  const [layerName, setLayerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [quickUri, setQuickUri] = useState<string | null>(null);
  const [quickVisible, setQuickVisible] = useState(false);
  const [moveInVisible, setMoveInVisible] = useState(false);
  const [allItems, setAllItems] = useState<AllItem[]>([]);
  const [moveInSearch, setMoveInSearch] = useState('');
  const [moveInBusyId, setMoveInBusyId] = useState<number | null>(null);
  const [moveInLoading, setMoveInLoading] = useState(false);

  // 高亮格脉冲动画（进入页面时呼吸 4 次后静止，保持高亮边框）
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!hlLayer) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 550, useNativeDriver: false }),
      ]),
      { iterations: 4 }
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlLayer]);
  const pulseBorder = pulse.interpolate({ inputRange: [0, 1], outputRange: ['#6C63FF', '#C9C4FF'] });
  const pulseBg = pulse.interpolate({ inputRange: [0, 1], outputRange: ['#F7F6FF', '#E9E6FF'] });

  const fetchData = useCallback(async () => {
    try {
      /**
       * 服务端文件：server/src/routes/locations.ts
       * 接口：GET /api/v1/locations/:id/items
       * 返回：{ node: NodeInfo, layers: LayerInfo[], items: SpaceItem[] }
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/${furnitureId}/items`);
      if (res.ok) {
        const data = await res.json();
        setNode(data.node || null);
        setLayers(data.layers || []);
        setItems(data.items || []);

        // 异步补齐照片签名 URL
        (data.items || []).forEach(async (item: SpaceItem) => {
          if (item.photo_key && !photoUrlsRef.current[item.id]) {
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
                if (!photoUrlsRef.current[item.id]) {
                  photoUrlsRef.current = { ...photoUrlsRef.current, [item.id]: url };
                  setPhotoUrls(photoUrlsRef.current);
                }
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

  const activeLayerInfo = activeLayer !== null ? layers.find((l) => l.id === activeLayer) : null;

  // 相机并发守卫：连点"再来一件"会导致多个相机调用排队，弹窗反复弹出
  const capturingRef = useRef(false);
  const retakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拍照放入当前隔层：拍照后打开极简保存（预设空间挂载）
  const handleCaptureToLayer = async () => {
    if (activeLayer === null || !activeLayerInfo) return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要相机权限才能拍照');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        setQuickUri(result.assets[0].uri);
        setQuickVisible(true);
      }
    } catch (e) {
      // iOS 上相机异常（如临时文件读取失败）时静默降级，避免 unhandled rejection
      console.error('Camera failed:', e);
      Toast.show({ type: 'error', text1: '相机打开失败', text2: '请重试一次' });
    } finally {
      capturingRef.current = false;
    }
  };

  // 连拍"再来一件"：iOS 上 Modal 显示中直接开相机会导致照片读取失败、
  // 相机关闭后 Modal 被系统重新 present（弹窗反复弹出）。先关弹窗再拉起相机。
  const handleRetakeToLayer = () => {
    if (capturingRef.current) return;
    setQuickVisible(false);
    if (retakeTimerRef.current) clearTimeout(retakeTimerRef.current);
    retakeTimerRef.current = setTimeout(() => {
      retakeTimerRef.current = null;
      void handleCaptureToLayer();
    }, 450);
  };

  // 打开移入弹窗：拉取全部物品
  const openMoveIn = async () => {
    setMoveInVisible(true);
    setMoveInSearch('');
    setMoveInLoading(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：GET /api/v1/items
       * Query 参数：无
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`);
      if (!res.ok) throw new Error();
      setAllItems(await res.json());
    } catch {
      setAllItems([]);
    } finally {
      setMoveInLoading(false);
    }
  };

  // 把现有物品移入当前隔层
  const handleMoveIn = async (itemId: number) => {
    if (activeLayer === null) return;
    setMoveInBusyId(itemId);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：PUT /api/v1/items/:id
       * Body 参数：location_id: number
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: activeLayer }),
      });
      if (!res.ok) throw new Error();
      setAllItems((prev) => prev.filter((it) => it.id !== itemId));
      fetchData();
      Toast.show({ type: 'success', text1: '已移入', text2: activeLayerInfo?.name || '' });
    } catch {
      Toast.show({ type: 'error', text1: '移入失败，请重试' });
    } finally {
      setMoveInBusyId(null);
    }
  };

  // 移入候选：不在当前隔层的物品，按名称搜索
  const moveInCandidates = allItems.filter((it) => {
    if (it.location_id === activeLayer) return false;
    if (moveInSearch.trim() && !it.name.toLowerCase().includes(moveInSearch.trim().toLowerCase())) return false;
    return true;
  });

  const displayItems = activeLayer === null ? items : items.filter((it) => it.layer_id === activeLayer);
  const activeLayerName = activeLayer === null ? null : layers.find((l) => l.id === activeLayer)?.name;
  const cols = node?.cols === 1 ? 1 : 2; // 默认 2 列
  const furnitureIcon = TEMPLATE_ICONS[node?.template || ''] || 'box';
  const title = node?.name || name || '家具';

  // 渲染单个隔层格（高亮格用 Animated 包裹）
  const renderCell = (layer: LayerInfo) => {
    const active = activeLayer === layer.id;
    const isHighlight = hlLayer === layer.id;
    const layerItems = items.filter((it) => it.layer_id === layer.id);
    const firstPhoto = layerItems.find((it) => it.photo_key && photoUrls[it.id]);
    const wide = cols === 1;

    const inner = (
      <>
        {firstPhoto && photoUrls[firstPhoto.id] ? (
          <Image
            source={{ uri: photoUrls[firstPhoto.id] }}
            style={wide ? styles.cellThumbRow : styles.cellThumb}
            contentFit="cover"
            transition={200}
            recyclingKey={`layer_${firstPhoto.id}`}
          />
        ) : (
          <View style={[styles.cellIconWrap, wide && styles.cellIconWrapRow]}>
            <FontAwesome6
              name={layer.item_count > 0 ? 'grip-lines' : 'plus'}
              size={16}
              color={active ? '#6C63FF' : '#C0C0C8'}
            />
          </View>
        )}
        <View style={wide ? styles.cellTextRow : styles.cellTextCol}>
          <Text style={[styles.cellName, active && styles.cellNameActive, wide && styles.cellNameRow]} numberOfLines={1}>
            {layer.name}
          </Text>
          <Text style={styles.cellCount}>{layer.item_count} 件</Text>
        </View>
        {wide && active && <FontAwesome6 name="circle-check" size={16} color="#6C63FF" />}
      </>
    );

    const cellStyle = [
      styles.cell,
      wide ? styles.cellWide : styles.cellHalf,
      active && styles.cellActive,
      layer.item_count === 0 && !isHighlight && styles.cellEmpty,
    ];

    if (isHighlight) {
      return (
        <Animated.View
          key={layer.id}
          style={[cellStyle, { borderColor: pulseBorder, backgroundColor: pulseBg, borderWidth: 2 }]}
        >
          <TouchableOpacity
            style={[styles.cellInner, wide && styles.cellInnerRow]}
            onPress={() => setActiveLayer(active ? null : layer.id)}
            activeOpacity={0.75}
          >
            {inner}
          </TouchableOpacity>
        </Animated.View>
      );
    }
    return (
      <TouchableOpacity
        key={layer.id}
        style={cellStyle}
        onPress={() => setActiveLayer(active ? null : layer.id)}
        activeOpacity={0.75}
      >
        <View style={[styles.cellInner, wide && styles.cellInnerRow]}>{inner}</View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <FontAwesome6 name="chevron-left" size={18} color="#2D3436" />
        </TouchableOpacity>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
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
          {/* 家具格子视图：外框模拟柜体，格子按模板布局 */}
          <View style={styles.frame}>
            <View style={styles.frameHeader}>
              <View style={styles.frameIconWrap}>
                <FontAwesome6 name={furnitureIcon} size={14} color="#A0845C" />
              </View>
              <Text style={styles.frameTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.frameHint}>点格子看里面</Text>
            </View>
            <View style={[styles.grid, cols === 1 && styles.gridSingle]}>
              {layers.map(renderCell)}
            </View>
          </View>

          {/* 添加物品入口：选中某层时出现 */}
          {activeLayer !== null && activeLayerInfo && (
            <View style={styles.addBar}>
              <TouchableOpacity style={styles.addBarBtn} onPress={handleCaptureToLayer} activeOpacity={0.8}>
                <View style={[styles.addBarIcon, { backgroundColor: '#F0EFFF' }]}>
                  <FontAwesome6 name="camera" size={15} color="#6C63FF" />
                </View>
                <Text style={styles.addBarText}>拍照放入此层</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addBarBtn} onPress={openMoveIn} activeOpacity={0.8}>
                <View style={[styles.addBarIcon, { backgroundColor: '#E6F7F5' }]}>
                  <FontAwesome6 name="box-open" size={15} color="#0D9488" />
                </View>
                <Text style={styles.addBarText}>移入现有物品</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 物品列表标题行 */}
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>
              {activeLayerName ? `「${activeLayerName}」里的物品` : '全部物品'}
            </Text>
            {activeLayer !== null && (
              <TouchableOpacity onPress={() => setActiveLayer(null)} hitSlop={8}>
                <Text style={styles.showAllText}>查看全部</Text>
              </TouchableOpacity>
            )}
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
                style={[styles.itemCard, hlItem === item.id && styles.itemCardHighlight]}
                onPress={() => router.push('/item-detail', { id: item.id })}
                activeOpacity={0.75}
              >
                {photoUrls[item.id] ? (
                  <Image
                    source={{ uri: photoUrls[item.id] }}
                    style={styles.itemImage}
                    contentFit="cover"
                    transition={200}
                    recyclingKey={`sf_${item.id}`}
                  />
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
                {hlItem === item.id ? (
                  <View style={styles.locatedBadge}>
                    <FontAwesome6 name="location-crosshairs" size={11} color="#FFFFFF" />
                    <Text style={styles.locatedBadgeText}>在这</Text>
                  </View>
                ) : (
                  <FontAwesome6 name="chevron-right" size={12} color="#C0C0C8" />
                )}
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

      {/* 移入现有物品 Modal */}
      <Modal visible={moveInVisible} transparent animationType="slide" onRequestClose={() => setMoveInVisible(false)}>
        <View style={styles.moveOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMoveInVisible(false)} />
          <View style={styles.moveSheet}>
            <View style={styles.moveHandle} />
            <Text style={styles.modalTitle}>移入到「{activeLayerInfo?.name}」</Text>
            <View style={styles.moveSearchRow}>
              <FontAwesome6 name="magnifying-glass" size={13} color="#B2BEC3" />
              <TextInput
                style={styles.moveSearchInput}
                value={moveInSearch}
                onChangeText={setMoveInSearch}
                placeholder="搜索物品名称"
                placeholderTextColor="#B2BEC3"
              />
            </View>
            {moveInLoading ? (
              <ActivityIndicator size="small" color="#6C63FF" style={{ marginVertical: 32 }} />
            ) : (
              <FlatList
                data={moveInCandidates}
                keyExtractor={(it) => String(it.id)}
                style={{ maxHeight: 360 }}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={10}
                maxToRenderPerBatch={6}
                windowSize={7}
                ListEmptyComponent={
                  <Text style={styles.moveEmpty}>{allItems.length === 0 ? '还没有可移入的物品' : '没有匹配的物品'}</Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.moveRow}
                    onPress={() => handleMoveIn(item.id)}
                    disabled={moveInBusyId === item.id}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.moveRowName} numberOfLines={1}>{item.name}</Text>
                      {(item.location_path || item.location) ? (
                        <Text style={styles.moveRowLoc} numberOfLines={1}>
                          现在：{item.location_path || item.location}
                        </Text>
                      ) : (
                        <Text style={styles.moveRowLoc}>现在：未设置位置</Text>
                      )}
                    </View>
                    {moveInBusyId === item.id ? (
                      <ActivityIndicator size="small" color="#6C63FF" />
                    ) : (
                      <FontAwesome6 name="arrow-right-to-bracket" size={14} color="#6C63FF" />
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* 拍照放入此层（预设空间挂载） */}
      <QuickSaveModal
        visible={quickVisible}
        photoUri={quickUri}
        presetSpace={
          activeLayer !== null && activeLayerInfo
            ? { location_id: activeLayer, path: `${node?.name || ''} / ${activeLayerInfo.name}` }
            : null
        }
        onClose={() => setQuickVisible(false)}
        onSaved={() => {
          fetchData();
        }}
        onRetake={handleRetakeToLayer}
      />
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
  // 家具外框：暖棕柜体感
  frame: {
    backgroundColor: 'rgba(160,132,92,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(160,132,92,0.28)',
    borderRadius: 22,
    padding: 12,
  },
  frameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  frameIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(160,132,92,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#7A6547',
  },
  frameHint: {
    fontSize: 11,
    color: '#B49B7A',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridSingle: {
    flexDirection: 'column',
  },
  cell: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  cellHalf: {
    width: '47.5%',
  },
  cellWide: {
    width: '100%',
  },
  cellInner: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 5,
  },
  cellInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
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
  cellThumbRow: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  cellIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellIconWrapRow: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  cellTextCol: {
    alignItems: 'center',
    gap: 2,
  },
  cellTextRow: {
    flex: 1,
    gap: 1,
  },
  cellName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
    maxWidth: '100%',
  },
  cellNameRow: {
    fontSize: 14,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  showAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
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
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  itemCardHighlight: {
    borderColor: '#6C63FF',
    backgroundColor: '#F7F6FF',
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
    gap: 2,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  itemSub: {
    fontSize: 12,
    color: '#9EA0A5',
  },
  locatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#6C63FF',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  locatedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  moveHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E6',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 14,
  },
  modalInput: {
    height: 48,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#2D3436',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancel: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#F5F5F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  modalConfirm: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBar: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  addBarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  addBarIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBarText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
  },
  moveOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  moveSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  moveSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  moveSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    paddingVertical: 0,
  },
  moveEmpty: {
    textAlign: 'center',
    fontSize: 13,
    color: '#9EA0A5',
    marginVertical: 28,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F4',
  },
  moveRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  moveRowLoc: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 2,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
