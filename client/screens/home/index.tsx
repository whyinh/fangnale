import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
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
  tags: string;
  photo_key: string;
  note: string;
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
}: {
  item: Item;
  photoUrl?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.groupCard} onPress={onPress} activeOpacity={0.7}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.groupCardImage} />
      ) : (
        <View style={[styles.groupCardImage, styles.groupCardImagePlaceholder]}>
          <FontAwesome6 name="image" size={20} color="#B2BEC3" />
        </View>
      )}
      <Text style={styles.groupCardName} numberOfLines={1}>{item.name}</Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 已提交的搜索词：只有用户主动点搜索键/搜索图标时才更新，输入过程绝不触发请求
  const [submittedQuery, setSubmittedQuery] = useState('');
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
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(data);
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
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
      const res = await fetch(url);
      const data = await res.json();
      setItems(data);

      // 拉取物品照片的签名 URL
      const urlMap: Record<number, string> = {};
      for (const item of data) {
        if (item.photo_key && !photoUrls[item.id]) {
          try {
            /**
             * 服务端文件：server/src/routes/upload.ts
             * 接口：POST /api/v1/upload/photo-url
             * Body 参数：key: string
             */
            const photoRes = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo-url`, {
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
  };

  const handleQuickSaved = () => {
    fetchItems();
  };

  const renderItem = ({ item }: { item: Item }) => (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={() => router.push(`/item-detail`, { id: item.id })}
      activeOpacity={0.7}
    >
      {photoUrls[item.id] ? (
        <Image source={{ uri: photoUrls[item.id] }} style={styles.itemImage} />
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
        {item.location ? (
          <View style={styles.locationRow}>
            <FontAwesome6 name="map-pin" size={11} color="#636E72" />
            <Text style={styles.itemLocation} numberOfLines={1}>{item.location}</Text>
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
          <Text style={styles.headerTitle}>StashSpot</Text>
          <Text style={styles.headerSubtitle}>你的物品，一目了然</Text>
        </View>

        {/* Search Bar + AI 问 + 视图切换 */}
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
        <FlatList
          data={categories}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.categoryList}
          renderItem={({ item }) => (
            <TouchableOpacity
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
          )}
        />

        {/* 物品列表 / 位置分组 */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6C63FF" />
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
              <FontAwesome6 name="camera" size={36} color="#6C63FF" />
            </View>
            <Text style={styles.emptyTitle}>还没有物品记录</Text>
            <Text style={styles.emptySubtitle}>点右下角相机，拍一张就记好了</Text>
          </View>
        ) : viewMode === 'all' ? (
          <FlatList
            data={displayItems}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.itemsList}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <FlatList
            data={locationGroups}
            keyExtractor={(group) => group.location}
            renderItem={renderLocationGroup}
            contentContainerStyle={styles.itemsList}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* 语音速记/语音查找入口（相机 FAB 上方） */}
        <TouchableOpacity
          style={[styles.voiceFab, { bottom: 164 + (Platform.OS === 'ios' ? insets.bottom : 0) }]}
          onPress={() => setShowVoicePanel(true)}
          activeOpacity={0.85}
        >
          <FontAwesome6 name="microphone" size={20} color="#FFF" />
        </TouchableOpacity>

        {/* 浮动拍照按钮（FAB） */}
        <TouchableOpacity
          style={[styles.fab, { bottom: 92 + (Platform.OS === 'ios' ? insets.bottom : 0) }]}
          onPress={handleQuickCapture}
          activeOpacity={0.85}
        >
          <FontAwesome6 name="camera" size={24} color="#FFF" />
        </TouchableOpacity>

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
        />

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
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    marginLeft: 10,
    padding: 0,
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
  groupCardName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3436',
    marginTop: 8,
    marginHorizontal: 2,
  },
});
