import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  created_at: string;
  categories: Category;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useSafeRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});

  const fetchCategories = useCallback(async () => {
    try {
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
      if (searchQuery) params.push(`search=${encodeURIComponent(searchQuery)}`);
      if (params.length > 0) url += `?${params.join('&')}`;

      const res = await fetch(url);
      const data = await res.json();
      setItems(data);

      // Fetch photo URLs for items
      const urlMap: Record<number, string> = {};
      for (const item of data) {
        if (item.photo_key && !photoUrls[item.id]) {
          try {
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
  }, [selectedCategory, searchQuery]);

  useFocusEffect(
    useCallback(() => {
      fetchCategories();
      fetchItems();
    }, [fetchCategories, fetchItems])
  );

  const handleSearch = () => {
    fetchItems();
  };

  const handleCategorySelect = (categoryId: number | null) => {
    setSelectedCategory(categoryId === selectedCategory ? null : categoryId);
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

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} backgroundColor="#F0F0F3">
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>StashSpot</Text>
          <Text style={styles.headerSubtitle}>你的物品，一目了然</Text>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <FontAwesome6 name="magnifying-glass" size={16} color="#B2BEC3" />
            <TextInput
              style={styles.searchInput}
              placeholder="搜索物品名称、位置、标签..."
              placeholderTextColor="#B2BEC3"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); }}>
                <FontAwesome6 name="xmark" size={16} color="#B2BEC3" />
              </TouchableOpacity>
            )}
          </View>
        </View>

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

        {/* Items List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6C63FF" />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FontAwesome6 name="box-open" size={48} color="#B2BEC3" />
            <Text style={styles.emptyTitle}>还没有物品记录</Text>
            <Text style={styles.emptySubtitle}>点击下方 + 按钮添加你的第一个物品</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.itemsList}
            showsVerticalScrollIndicator={false}
          />
        )}
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
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  searchBar: {
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
    paddingBottom: 120,
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
    gap: 4,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemLocation: {
    fontSize: 13,
    color: '#636E72',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tag: {
    borderRadius: 9999,
    paddingHorizontal: 10,
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
    paddingBottom: 100,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 8,
  },
});
