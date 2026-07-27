import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeSearchParams, useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
const VIEWED_ITEMS_KEY = '@stashspot_viewed_items';

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
  updated_at: string;
  categories: Category;
}

export default function ItemDetailScreen() {
  const { id } = useSafeSearchParams<{ id: number }>();
  const router = useSafeRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRephotoPrompt, setShowRephotoPrompt] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`);
      const data = await res.json();
      setItem(data);

      // Fetch photo URL
      if (data.photo_key) {
        const photoRes = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: data.photo_key }),
        });
        const photoData = await photoRes.json();
        setPhotoUrl(photoData.url);
      }

      // Check if this item was viewed before - if so, prompt to re-photo
      const viewedStr = await AsyncStorage.getItem(VIEWED_ITEMS_KEY);
      const viewedItems: Record<string, string> = viewedStr ? JSON.parse(viewedStr) : {};
      const itemIdStr = String(data.id);

      if (viewedItems[itemIdStr]) {
        // Item was viewed before, show re-photo prompt
        setShowRephotoPrompt(true);
      }

      // Mark as viewed now
      viewedItems[itemIdStr] = new Date().toISOString();
      await AsyncStorage.setItem(VIEWED_ITEMS_KEY, JSON.stringify(viewedItems));
    } catch (e) {
      console.error('Failed to fetch item:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchItem();
    }, [fetchItem])
  );

  const handleDelete = () => {
    Alert.alert(
      '确认删除',
      `确定要删除「${item?.name}」吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              /**
               * 服务端文件：server/src/routes/items.ts
               * 接口：DELETE /api/v1/items/:id
               * Path 参数：id: number
               */
              await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`, {
                method: 'DELETE',
              });
              router.back();
            } catch (e) {
              Alert.alert('删除失败', '请重试');
            }
          },
        },
      ]
    );
  };

  const handleDismissRephoto = () => {
    setShowRephotoPrompt(false);
  };

  if (loading) {
    return (
      <Screen backgroundColor="#F0F0F3">
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#6C63FF" />
        </View>
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen backgroundColor="#F0F0F3">
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyTitle}>物品不存在</Text>
        </View>
      </Screen>
    );
  }

  const tagList = item.tags ? item.tags.split(',').filter(t => t.trim()) : [];

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} backgroundColor="#F0F0F3">
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <FontAwesome6 name="arrow-left" size={20} color="#2D3436" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>物品详情</Text>
          <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
            <FontAwesome6 name="trash" size={18} color="#FF6B6B" />
          </TouchableOpacity>
        </View>

        {/* Photo */}
        <View style={styles.photoContainer}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <FontAwesome6 name="image" size={48} color="#B2BEC3" />
            </View>
          )}
        </View>

        {/* Rephoto Prompt */}
        {showRephotoPrompt && (
          <View style={styles.rephotoPrompt}>
            <View style={styles.rephotoPromptContent}>
              <FontAwesome6 name="camera" size={20} color="#FF6584" />
              <Text style={styles.rephotoPromptText}>
                你之前查看过这个物品，它的位置是否有变动？需要重新拍照吗？
              </Text>
            </View>
            <View style={styles.rephotoPromptActions}>
              <TouchableOpacity style={styles.rephotoNoBtn} onPress={handleDismissRephoto}>
                <Text style={styles.rephotoNoText}>不用了</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rephotoYesBtn} onPress={handleDismissRephoto}>
                <Text style={styles.rephotoYesText}>好的</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Info Card */}
        <View style={styles.infoCard}>
          <Text style={styles.itemName}>{item.name}</Text>

          {/* Category */}
          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, { backgroundColor: `${item.categories?.color || '#6C63FF'}18` }]}>
              <FontAwesome6 name={item.categories?.icon as any || 'tag'} size={16} color={item.categories?.color || '#6C63FF'} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>分类</Text>
              <Text style={styles.infoValue}>{item.categories?.name || '未分类'}</Text>
            </View>
          </View>

          {/* Location */}
          {item.location ? (
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <FontAwesome6 name="map-pin" size={16} color="#6C63FF" />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoLabel}>存放位置</Text>
                <Text style={styles.infoValue}>{item.location}</Text>
              </View>
            </View>
          ) : null}

          {/* Tags */}
          {tagList.length > 0 ? (
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <FontAwesome6 name="hashtag" size={16} color="#6C63FF" />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoLabel}>标签</Text>
                <View style={styles.tagsContainer}>
                  {tagList.map((tag, idx) => (
                    <View key={idx} style={[styles.tag, { backgroundColor: `${item.categories?.color || '#6C63FF'}18` }]}>
                      <Text style={[styles.tagText, { color: item.categories?.color || '#6C63FF' }]}>{tag.trim()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : null}

          {/* Note */}
          {item.note ? (
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <FontAwesome6 name="note-sticky" size={16} color="#6C63FF" />
              </View>
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoLabel}>备注</Text>
                <Text style={styles.infoValue}>{item.note}</Text>
              </View>
            </View>
          ) : null}

          {/* Created date */}
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>
              记录于 {new Date(item.created_at).toLocaleDateString('zh-CN')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 60,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D3436',
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,107,107,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoContainer: {
    marginBottom: 20,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  photo: {
    width: '100%',
    height: 260,
    backgroundColor: '#E8E8EB',
  },
  photoPlaceholder: {
    width: '100%',
    height: 260,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rephotoPrompt: {
    backgroundColor: '#F0F0F3',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#FF6584',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,101,132,0.2)',
  },
  rephotoPromptContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  rephotoPromptText: {
    flex: 1,
    fontSize: 14,
    color: '#2D3436',
    lineHeight: 20,
  },
  rephotoPromptActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  rephotoNoBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: '#E8E8EB',
  },
  rephotoNoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
  },
  rephotoYesBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: '#FF6584',
  },
  rephotoYesText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
  },
  infoCard: {
    backgroundColor: '#F0F0F3',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  itemName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#2D3436',
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  infoIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(108,99,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoTextContainer: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#636E72',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  tag: {
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateRow: {
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E8E8EB',
  },
  dateText: {
    fontSize: 12,
    color: '#B2BEC3',
  },
  emptyTitle: {
    fontSize: 16,
    color: '#636E72',
  },
});
