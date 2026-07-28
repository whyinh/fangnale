import { authFetch } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';
import { contactLabel, contactAvatarText } from '@/utils/format';
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
  Modal,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { QuickSaveModal } from '@/components/QuickSaveModal';
import AskModal from '@/components/AskModal';
import VoicePanel from '@/components/VoicePanel';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

interface Item {
  id: number;
  name: string;
  category_id: number;
  location: string;
  location_id?: number | null;
  location_path?: string | null;
  tags: string;
  photo_key: string;
  note: string;
  owner_email?: string;
  owner_name?: string;
  borrowed_to: string | null;
  borrowed_at: string | null;
  expiry_date: string | null;
  created_at: string;
  categories: Category;
}

// 计算距过期天数（负数表示已过期）
function daysUntilExpiry(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

interface LocationGroup {
  location: string;
  items: Item[];
}

type ViewMode = 'all' | 'byLocation';

// 位置分组内的小卡片（顶层组件，避免 Hooks 陷阱）
function GroupItemCard({
  item,
  photoUrl,
  onPress,
  myEmail,
}: {
  item: Item;
  photoUrl?: string;
  onPress: () => void;
  myEmail?: string | null;
}) {
  const ownerLabel = item.owner_name || item.owner_email || '';
  const showOwner = !!ownerLabel && item.owner_email !== myEmail;
  return (
    <TouchableOpacity style={styles.groupCard} onPress={onPress} activeOpacity={0.7}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.groupCardImage}
          contentFit="cover"
          transition={180}
          recyclingKey={String(item.id)}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.groupCardImage, styles.groupCardImagePlaceholder]}>
          <FontAwesome6 name="image" size={20} color="#B2BEC3" />
        </View>
      )}
      {showOwner ? (
        <View style={styles.ownerDot}>
          <Text style={styles.ownerDotText}>
            {contactAvatarText(ownerLabel)}
          </Text>
        </View>
      ) : null}
      <Text style={styles.groupCardName} numberOfLines={1}>{item.name}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const { user } = useAuth();
  const myEmail = user?.email || user?.phone || null;
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 已提交的搜索词：只有用户主动点搜索键/搜索图标时才更新，输入过程绝不触发请求
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchModal, setBatchModal] = useState<'category' | 'move' | null>(null);
  const [moveInput, setMoveInput] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  // 智能搜索：字面匹配无结果时自动 fallback 到 AI 语义搜索
  const [smartSearching, setSmartSearching] = useState(false);
  const [smartMatched, setSmartMatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [quickSaveUri, setQuickSaveUri] = useState<string | null>(null);
  const [quickSaveVisible, setQuickSaveVisible] = useState(false);
  const [askVisible, setAskVisible] = useState(false);
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [showExpiringOnly, setShowExpiringOnly] = useState(false);

  const fetchCategories = useCallback(async () => {
    try {
      /**
       * 服务端文件：server/src/routes/categories.ts
       * 接口：GET /api/v1/categories
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(data);
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    // 拉取物品照片的签名 URL
    const fetchPhotoUrls = async (list: Item[]) => {
      const urlMap: Record<number, string> = {};
      for (const item of list) {
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
            const photoData = await photoRes.json();
            urlMap[item.id] = photoData.url;
          } catch {
            // skip
          }
        }
      }
      if (Object.keys(urlMap).length > 0) {
        setPhotoUrls(prev => ({ ...prev, ...urlMap }));
      }
    };

    try {
      setLoading(true);
      setSmartMatched(false);
      let url = `${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`;
      const params: string[] = [];
      if (selectedCategory) params.push(`category_id=${selectedCategory}`);
      if (submittedQuery) params.push(`search=${encodeURIComponent(submittedQuery)}`);
      if (params.length > 0) url += `?${params.join('&')}`;

      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：GET /api/v1/items
       * Query 参数：category_id?: number, search?: string
       */
      const res = await authFetch(url);
      const data = await res.json();

      // 字面匹配无结果且有搜索词：自动 fallback 到 AI 语义搜索（同义词/类别推理）
      if (Array.isArray(data) && data.length === 0 && submittedQuery) {
        setLoading(false);
        setSmartSearching(true);
        try {
          /**
           * 服务端文件：server/src/routes/items.ts
           * 接口：POST /api/v1/items/smart-search
           * Body 参数：query: string
           */
          const smartRes = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/smart-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: submittedQuery }),
          });
          const smartData = await smartRes.json();
          if (Array.isArray(smartData) && smartData.length > 0) {
            setItems(smartData);
            setSmartMatched(true);
            await fetchPhotoUrls(smartData);
          } else {
            setItems([]);
          }
        } catch (e) {
          console.error('Smart search failed:', e);
          setItems([]);
        } finally {
          setSmartSearching(false);
        }
        return;
      }

      setItems(data);
      await fetchPhotoUrls(data);
    } catch (e) {
      console.error('Failed to fetch items:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, submittedQuery]);

  useFocusEffect(
    useCallback(() => {
      fetchCategories();
      fetchItems();
    }, [fetchCategories, fetchItems])
  );

  // 按位置分组
  const locationGroups = useMemo<LocationGroup[]>(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      const loc = item.location?.trim() || '未标记位置';
      if (!map.has(loc)) map.set(loc, []);
      map.get(loc)!.push(item);
    }
    const groups: LocationGroup[] = [];
    for (const [location, groupItems] of map) {
      groups.push({ location, items: groupItems });
    }
    groups.sort((a, b) => b.items.length - a.items.length);
    return groups;
  }, [items]);

  // 临期物品（30 天内到期或已过期）
  const expiringItems = useMemo(
    () =>
      items.filter((i) => {
        const d = daysUntilExpiry(i.expiry_date);
        return d !== null && d <= 30;
      }),
    [items]
  );

  // 列表数据源（临期筛选时只看临期物品）
  const displayItems = useMemo(
    () => (showExpiringOnly ? expiringItems : items),
    [showExpiringOnly, expiringItems, items]
  );

  // 提交搜索：仅在用户主动触发时生效
  const handleSearch = () => {
    setSubmittedQuery(searchQuery.trim());
  };

  // AI 问一问
  const handleAsk = () => {
    const q = searchQuery.trim();
    if (!q) {
      Alert.alert('问一问', '先在搜索框输入你的问题，例如：\n\n我的护照放在哪？\n书房里有什么？\n什么东西快过期了？');
      return;
    }
    setAskQuestion(q);
    setAskVisible(true);
  };

  const handleCategorySelect = (categoryId: number | null) => {
    setSelectedCategory(categoryId === selectedCategory ? null : categoryId);
  };

  // 一键拍照 → 弹出极简保存
  const handleQuickCapture = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要相机权限才能拍照');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setQuickSaveUri(result.assets[0].uri);
        setQuickSaveVisible(true);
      }
    } catch (e) {
      // iOS 上相机异常（如临时文件读取失败）时静默降级，避免 unhandled rejection
      console.error('Camera failed:', e);
      Toast.show({ type: 'error', text1: '相机打开失败', text2: '请重试一次' });
    }
  };

  // 连拍"再来一件"：iOS 上 Modal 显示中直接开相机会导致照片读取失败、
  // 相机关闭后 Modal 被系统重新 present（弹窗反复弹出）。先关弹窗再拉起相机。
  const handleQuickRetake = () => {
    setQuickSaveVisible(false);
    setTimeout(() => {
      void handleQuickCapture();
    }, 450);
  };

  const handleQuickSaved = () => {
    fetchItems();
  };

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const enterSelection = useCallback((id: number) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === displayItems.length && displayItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayItems.map((it) => it.id)));
    }
  }, [selectedIds.size, displayItems]);

  /**
   * 服务端文件：server/src/routes/items.ts
   * 接口：POST /api/v1/items/batch
   * Body 参数：action: 'recategorize' | 'move' | 'delete', item_ids: number[], category_id?: number, location?: string
   */
  const runBatch = useCallback(
    async (body: Record<string, unknown>) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      setBatchBusy(true);
      try {
        const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, item_ids: ids }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setBatchModal(null);
        setMoveInput('');
        exitSelection();
        fetchItems();
        Toast.show({ type: 'success', text1: '批量操作完成' });
      } catch {
        Toast.show({ type: 'error', text1: '操作失败，请重试' });
      } finally {
        setBatchBusy(false);
      }
    },
    [selectedIds, exitSelection]
  );

  const handleBatchDelete = useCallback(() => {
    Alert.alert('批量删除', `确定删除选中的 ${selectedIds.size} 件物品吗？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => runBatch({ action: 'delete' }),
      },
    ]);
  }, [selectedIds.size, runBatch]);

  const renderItem = ({ item }: { item: Item }) => {
    const isSelected = selectedIds.has(item.id);
    return (
    <TouchableOpacity
      style={[styles.itemCard, selectionMode && isSelected && styles.itemCardSelected]}
      onPress={() => (selectionMode ? toggleSelect(item.id) : router.push(`/item-detail`, { id: item.id }))}
      onLongPress={() => {
        if (!selectionMode && viewMode === 'all') enterSelection(item.id);
      }}
      delayLongPress={350}
      activeOpacity={0.7}
    >
      {selectionMode && (
        <View style={[styles.selectCircle, isSelected && styles.selectCircleActive]}>
          {isSelected && <FontAwesome6 name="check" size={11} color="#FFF" />}
        </View>
      )}
      {photoUrls[item.id] ? (
        <Image
          source={{ uri: photoUrls[item.id] }}
          style={styles.itemImage}
          contentFit="cover"
          transition={180}
          recyclingKey={String(item.id)}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          <FontAwesome6 name="image" size={24} color="#B2BEC3" />
        </View>
      )}
      {item.borrowed_to ? (
        <View style={styles.borrowedBadge}>
          <FontAwesome6 name="hand-holding" size={9} color="#FFF" />
          <Text style={styles.borrowedBadgeText}>借出</Text>
        </View>
      ) : null}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
        {(item.location_path || item.location) ? (
          <View style={styles.locationRow}>
            <FontAwesome6 name="map-pin" size={11} color="#636E72" />
            <Text style={styles.itemLocation} numberOfLines={1}>{item.location_path || item.location}</Text>
          </View>
        ) : null}
        {(item.owner_name || item.owner_email) && item.owner_email !== myEmail ? (
          <View style={styles.locationRow}>
            <FontAwesome6 name="user" size={10} color="#6C63FF" />
            <Text style={styles.ownerText} numberOfLines={1}>
              {item.owner_name || contactLabel(item.owner_email)} 记的
            </Text>
          </View>
        ) : null}
        {item.tags ? (
          <View style={styles.tagsRow}>
            {item.tags.split(',').slice(0, 3).map((tag, idx) => (
              <View key={idx} style={[styles.tag, { backgroundColor: `${item.categories?.color || '#6C63FF'}18` }]}>
                <Text style={[styles.tagText, { color: item.categories?.color || '#6C63FF' }]}>{tag.trim()}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
    );
  };

  const renderLocationGroup = ({ item: group }: { item: LocationGroup }) => (
    <View style={styles.groupSection}>
      <View style={styles.groupHeader}>
        <View style={styles.groupHeaderLeft}>
          <View style={styles.groupIconWrap}>
            <FontAwesome6 name="map-pin" size={13} color="#6C63FF" />
          </View>
          <Text style={styles.groupTitle}>{group.location}</Text>
        </View>
        <Text style={styles.groupCount}>{group.items.length} 件</Text>
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.groupCards}
        >
          {group.items.map((item) => (
            <GroupItemCard
              key={item.id}
              item={item}
              myEmail={myEmail}
              photoUrl={photoUrls[item.id]}
              onPress={() => router.push(`/item-detail`, { id: item.id })}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} backgroundColor="#F0F0F3">
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>放哪了</Text>
              <Text style={styles.headerSubtitle}>你的物品，一目了然</Text>
            </View>
            <TouchableOpacity
              style={styles.organizeBtn}
              onPress={() => router.push('/organize')}
              activeOpacity={0.75}
            >
              <FontAwesome6 name="wand-magic-sparkles" size={12} color="#6C63FF" />
              <Text style={styles.organizeBtnText}>整理</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 选择模式工具栏 */}
        {selectionMode && (
          <View style={styles.selectionBar}>
            <TouchableOpacity onPress={exitSelection} hitSlop={8}>
              <FontAwesome6 name="xmark" size={18} color="#636E72" />
            </TouchableOpacity>
            <Text style={styles.selectionCount}>已选 {selectedIds.size} 项</Text>
            <TouchableOpacity onPress={toggleSelectAll} hitSlop={8}>
              <Text style={styles.selectionAllText}>
                {selectedIds.size === displayItems.length && displayItems.length > 0 ? '取消全选' : '全选'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Search Bar + AI 问 + 视图切换 */}
        {!selectionMode && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <TouchableOpacity onPress={handleSearch} hitSlop={8}>
              <FontAwesome6 name="magnifying-glass" size={16} color="#B2BEC3" />
            </TouchableOpacity>
            <TextInput
              style={styles.searchInput}
              placeholder="输入后点搜索，或问：护照在哪..."
              placeholderTextColor="#B2BEC3"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              blurOnSubmit
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSubmittedQuery(''); }}>
                <FontAwesome6 name="xmark" size={16} color="#B2BEC3" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity style={styles.askBtn} onPress={handleAsk} activeOpacity={0.8}>
            <FontAwesome6 name="wand-magic-sparkles" size={15} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleBtn, viewMode === 'all' && styles.viewToggleBtnActive]}
              onPress={() => setViewMode('all')}
            >
              <FontAwesome6
                name="list"
                size={13}
                color={viewMode === 'all' ? '#FFF' : '#636E72'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleBtn, viewMode === 'byLocation' && styles.viewToggleBtnActive]}
              onPress={() => setViewMode('byLocation')}
            >
              <FontAwesome6
                name="map-pin"
                size={13}
                color={viewMode === 'byLocation' ? '#FFF' : '#636E72'}
              />
            </TouchableOpacity>
          </View>
        </View>
        )}

        {/* 临期提醒横幅 */}
        {expiringItems.length > 0 && (
          <TouchableOpacity
            style={[styles.expiringBanner, showExpiringOnly && styles.expiringBannerActive]}
            onPress={() => setShowExpiringOnly(prev => !prev)}
            activeOpacity={0.8}
          >
            <FontAwesome6 name="clock" size={13} color={showExpiringOnly ? '#FFF' : '#E17055'} />
            <Text style={[styles.expiringBannerText, showExpiringOnly && styles.expiringBannerTextActive]}>
              {expiringItems.length} 件物品临近或已过期
            </Text>
            <Text style={[styles.expiringBannerAction, showExpiringOnly && styles.expiringBannerTextActive]}>
              {showExpiringOnly ? '取消筛选' : '查看'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Category Filter */}
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={styles.categoryList}
          >
            {categories.map((item) => (
            <TouchableOpacity
              key={String(item.id)}
              style={[
                styles.categoryChip,
                selectedCategory === item.id && { backgroundColor: item.color },
              ]}
              onPress={() => handleCategorySelect(item.id)}
            >
              <FontAwesome6
                name={item.icon as any}
                size={14}
                color={selectedCategory === item.id ? '#FFF' : item.color}
              />
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === item.id && { color: '#FFF' },
                ]}
              >
                {item.name}
              </Text>
            </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 物品列表 / 位置分组 */}
        {loading || smartSearching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6C63FF" />
            {smartSearching && (
              <Text style={styles.smartSearchText}>字面没匹配到，AI 正在帮你联想…</Text>
            )}
          </View>
        ) : displayItems.length === 0 && showExpiringOnly ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <FontAwesome6 name="circle-check" size={36} color="#00B894" />
            </View>
            <Text style={styles.emptyTitle}>没有临期物品</Text>
            <Text style={styles.emptySubtitle}>所有物品都在保质期内</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <FontAwesome6 name={submittedQuery ? 'magnifying-glass' : 'camera'} size={36} color="#6C63FF" />
            </View>
            {submittedQuery ? (
              <>
                <Text style={styles.emptyTitle}>没有找到相关物品</Text>
                <Text style={styles.emptySubtitle}>换个说法试试，或点搜索框右侧的魔法棒直接问 AI</Text>
              </>
            ) : (
              <>
                <Text style={styles.emptyTitle}>还没有物品记录</Text>
                <Text style={styles.emptySubtitle}>点右下角相机，拍一张就记好了</Text>
              </>
            )}
          </View>
        ) : viewMode === 'all' ? (
          <FlatList
            data={displayItems}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={[styles.itemsList, selectionMode && { paddingBottom: 120 }]}
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
            updateCellsBatchingPeriod={40}
          />
        ) : (
          <FlatList
            data={locationGroups}
            keyExtractor={(group) => group.location}
            renderItem={renderLocationGroup}
            contentContainerStyle={styles.itemsList}
            showsVerticalScrollIndicator={false}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            updateCellsBatchingPeriod={40}
          />
        )}

        {/* 语音速记/语音查找入口（相机 FAB 上方） */}
        {!selectionMode && (
          <TouchableOpacity
            style={[styles.voiceFab, { bottom: 164 + (Platform.OS === 'ios' ? insets.bottom : 0) }]}
            onPress={() => setShowVoicePanel(true)}
            activeOpacity={0.85}
          >
            <FontAwesome6 name="microphone" size={20} color="#FFF" />
          </TouchableOpacity>
        )}

        {/* 浮动拍照按钮（FAB） */}
        {!selectionMode && (
          <TouchableOpacity
            style={[styles.fab, { bottom: 92 + (Platform.OS === 'ios' ? insets.bottom : 0) }]}
            onPress={handleQuickCapture}
            activeOpacity={0.85}
          >
            <FontAwesome6 name="camera" size={24} color="#FFF" />
          </TouchableOpacity>
        )}

        {/* 语音面板（速记 + 语音查找） */}
        <VoicePanel
          visible={showVoicePanel}
          categories={categories}
          onClose={() => setShowVoicePanel(false)}
          onSaved={fetchItems}
        />

        {/* 极简快速保存 */}
        <QuickSaveModal
          visible={quickSaveVisible}
          photoUri={quickSaveUri}
          onClose={() => setQuickSaveVisible(false)}
          onSaved={handleQuickSaved}
          onRetake={handleQuickRetake}
        />

        {/* 批量操作栏 */}
        {selectionMode && (
          <View style={[styles.batchBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.batchBtn}
              onPress={() => setBatchModal('category')}
              activeOpacity={0.75}
            >
              <FontAwesome6 name="folder-open" size={16} color="#6C63FF" />
              <Text style={styles.batchBtnText}>改分类</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batchBtn}
              onPress={() => setBatchModal('move')}
              activeOpacity={0.75}
            >
              <FontAwesome6 name="map-pin" size={16} color="#0D9488" />
              <Text style={styles.batchBtnText}>移位置</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.batchBtn}
              onPress={handleBatchDelete}
              disabled={batchBusy}
              activeOpacity={0.75}
            >
              {batchBusy ? (
                <ActivityIndicator size="small" color="#E17055" />
              ) : (
                <FontAwesome6 name="trash-can" size={16} color="#E17055" />
              )}
              <Text style={[styles.batchBtnText, { color: '#E17055' }]}>删除</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 批量改分类弹窗 */}
        <Modal
          visible={batchModal === 'category'}
          transparent
          animationType="slide"
          onRequestClose={() => setBatchModal(null)}
        >
          <View style={styles.batchOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setBatchModal(null)} />
            <View style={[styles.batchSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.batchHandle} />
              <Text style={styles.batchSheetTitle}>移动到分类（{selectedIds.size} 件）</Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {categories.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.batchSheetRow}
                    onPress={() => runBatch({ action: 'recategorize', category_id: c.id })}
                    disabled={batchBusy}
                    activeOpacity={0.7}
                  >
                    <View style={styles.batchCatIcon}>
                      <FontAwesome6 name="tag" size={13} color="#6C63FF" />
                    </View>
                    <Text style={styles.batchCatName}>{c.name}</Text>
                    <FontAwesome6 name="chevron-right" size={12} color="#C0C0C8" />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* 批量移位置弹窗 */}
        <Modal
          visible={batchModal === 'move'}
          transparent
          animationType="slide"
          onRequestClose={() => setBatchModal(null)}
        >
          <KeyboardAvoidingView
            style={styles.batchOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setBatchModal(null)} />
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.batchSheet, { paddingBottom: insets.bottom + 16 }]}>
                <View style={styles.batchHandle} />
                <Text style={styles.batchSheetTitle}>移动到位置（{selectedIds.size} 件）</Text>
                <TextInput
                  style={styles.batchInput}
                  value={moveInput}
                  onChangeText={setMoveInput}
                  placeholder="例如：储藏室、衣柜顶层"
                  placeholderTextColor="#9EA0A5"
                  maxLength={50}
                />
                <TouchableOpacity
                  style={[styles.batchConfirmBtn, (!moveInput.trim() || batchBusy) && styles.batchConfirmBtnDisabled]}
                  onPress={() => runBatch({ action: 'move', location: moveInput.trim() })}
                  disabled={!moveInput.trim() || batchBusy}
                  activeOpacity={0.8}
                >
                  {batchBusy ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.batchConfirmText}>确认移动</Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* AI 问一问（条件渲染，每次提问重新挂载以重置状态） */}
        {askVisible && askQuestion ? (
          <AskModal question={askQuestion} onClose={() => setAskVisible(false)} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: '#F0F0F3',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  organizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0EFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 32,
    marginTop: 4,
  },
  organizeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  selectionCount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  selectionAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6C63FF',
  },
  itemCardSelected: {
    borderColor: '#6C63FF',
    borderWidth: 1.5,
  },
  selectCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#C0C0C8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    alignSelf: 'center',
  },
  selectCircleActive: {
    backgroundColor: '#6C63FF',
    borderColor: '#6C63FF',
  },
  batchBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECECF1',
    paddingTop: 12,
    paddingHorizontal: 24,
    justifyContent: 'space-around',
  },
  batchBtn: {
    alignItems: 'center',
    gap: 5,
    minWidth: 72,
  },
  batchBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D3436',
  },
  batchOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  batchSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  batchHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E6',
    alignSelf: 'center',
    marginBottom: 14,
  },
  batchSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 12,
  },
  batchSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F4',
  },
  batchCatIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchCatName: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
  },
  batchInput: {
    height: 52,
    backgroundColor: '#F5F5F7',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#2D3436',
  },
  batchConfirmBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  batchConfirmBtnDisabled: {
    opacity: 0.5,
  },
  batchConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2D3436',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 12,
    gap: 10,
  },
  askBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  expiringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 12,
    backgroundColor: '#E1705515',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E1705530',
  },
  expiringBannerActive: {
    backgroundColor: '#E17055',
    borderColor: '#E17055',
  },
  expiringBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#E17055',
  },
  expiringBannerTextActive: {
    color: '#FFF',
  },
  expiringBannerAction: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E17055',
  },
  borrowedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FDCB6E',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 2,
  },
  borrowedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2D3436',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    marginLeft: 10,
    padding: 0,
    lineHeight: 20,
  },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    padding: 4,
    gap: 2,
  },
  viewToggleBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewToggleBtnActive: {
    backgroundColor: '#6C63FF',
  },
  categoryList: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(108,99,255,0.08)',
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
  },
  itemsList: {
    paddingHorizontal: 24,
    paddingBottom: 160,
  },
  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#F0F0F3',
    borderRadius: 24,
    marginBottom: 16,
    padding: 12,
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
  },
  imagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  itemLocation: {
    fontSize: 13,
    color: '#636E72',
    flex: 1,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 7,
  },
  tag: {
    borderRadius: 9999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smartSearchText: {
    marginTop: 12,
    fontSize: 13,
    color: '#6C63FF',
  },
  smartHintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(108,99,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  smartHintText: {
    fontSize: 12,
    color: '#6C63FF',
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: 'rgba(108,99,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 8,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 24,
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: '#6C63FF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  voiceFab: {
    position: 'absolute',
    right: 28,
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#3ECFCF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3ECFCF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  groupSection: {
    marginBottom: 22,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  groupIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(108,99,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  groupCount: {
    fontSize: 12,
    color: '#636E72',
    fontWeight: '600',
  },
  groupCards: {
    gap: 10,
    paddingRight: 24,
  },
  groupCard: {
    width: 120,
    backgroundColor: '#F0F0F3',
    borderRadius: 18,
    padding: 8,
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 5,
    elevation: 3,
  },
  groupCardImage: {
    width: '100%',
    height: 96,
    borderRadius: 12,
    backgroundColor: '#E8E8EB',
  },
  groupCardImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ownerDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  ownerText: {
    fontSize: 12,
    color: '#6C63FF',
    flexShrink: 1,
  },
  groupCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3436',
    marginTop: 8,
    marginHorizontal: 2,
  },
});
