import { authFetch } from '@/utils/api';
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
  Modal,
  TextInput,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeSearchParams, useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { createFormDataFile } from '@/utils';

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
  borrowed_to: string | null;
  borrowed_at: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
  categories: Category;
}

// 距过期天数（负数表示已过期）
function daysUntilExpiry(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export default function ItemDetailScreen() {
  const { id } = useSafeSearchParams<{ id: number }>();
  const router = useSafeRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRephotoPrompt, setShowRephotoPrompt] = useState(false);
  const [borrowModalVisible, setBorrowModalVisible] = useState(false);
  const [borrowName, setBorrowName] = useState('');
  const [borrowSaving, setBorrowSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`);
      const data = await res.json();
      setItem(data);

      // Fetch photo URL
      if (data.photo_key) {
        const photoRes = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo-url`, {
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

  // 拍照/补拍：上传后更新物品照片并刷新
  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('权限不足', '请允许使用相机后再拍照');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      /**
       * 服务端文件：server/src/routes/upload.ts
       * 接口：POST /api/v1/upload/photo
       * Body 参数（FormData）：photo: 图片文件
       */
      const formData = new FormData();
      formData.append('photo', (await createFormDataFile(result.assets[0].uri, `item_${Date.now()}.jpg`, 'image/jpeg')) as any);
      const upRes = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo`, { method: 'POST', body: formData });
      if (!upRes.ok) throw new Error('照片上传失败');
      const upData = await upRes.json();

      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：PUT /api/v1/items/:id
       * Path 参数：id: number
       * Body 参数：photo_key: string
       */
      const putRes = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_key: upData.photo_key }),
      });
      if (!putRes.ok) throw new Error('照片更新失败');
      fetchItem();
    } catch (e: any) {
      Alert.alert('错误', e.message || '拍照保存失败，请重试');
    } finally {
      setUploading(false);
    }
  };

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
              await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`, {
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

  const handleBorrow = async () => {
    if (!borrowName.trim()) {
      Alert.alert('提示', '请输入借给了谁');
      return;
    }
    setBorrowSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：PUT /api/v1/items/:id
       * Path 参数：id: number
       * Body 参数：borrowed_to: string, borrowed_at: string（ISO 格式）
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrowed_to: borrowName.trim(),
          borrowed_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('borrow failed');
      setBorrowModalVisible(false);
      setBorrowName('');
      fetchItem();
    } catch (e) {
      Alert.alert('操作失败', '请重试');
    } finally {
      setBorrowSaving(false);
    }
  };

  const handleReturn = () => {
    Alert.alert('确认归还', `「${item?.name}」已从 ${item?.borrowed_to} 处归还？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '已归还',
        onPress: async () => {
          try {
            /**
             * 服务端文件：server/src/routes/items.ts
             * 接口：PUT /api/v1/items/:id
             * Path 参数：id: number
             * Body 参数：borrowed_to: null, borrowed_at: null
             */
            const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ borrowed_to: null, borrowed_at: null }),
            });
            if (!res.ok) throw new Error('return failed');
            fetchItem();
          } catch (e) {
            Alert.alert('操作失败', '请重试');
          }
        },
      },
    ]);
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
            <TouchableOpacity style={styles.photoPlaceholder} onPress={handleTakePhoto} disabled={uploading} activeOpacity={0.7}>
              {uploading ? (
                <ActivityIndicator size="large" color="#6C63FF" />
              ) : (
                <>
                  <FontAwesome6 name="camera" size={40} color="#6C63FF" />
                  <Text style={styles.photoPlaceholderTitle}>还未拍照</Text>
                  <Text style={styles.photoPlaceholderSub}>点击拍一张照片，找起来更方便</Text>
                </>
              )}
            </TouchableOpacity>
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
              <TouchableOpacity style={styles.rephotoYesBtn} onPress={() => { handleDismissRephoto(); handleTakePhoto(); }}>
                <Text style={styles.rephotoYesText}>好的，重拍</Text>
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

          {/* 借出状态 */}
          <View style={styles.infoRow}>
            <View style={[styles.infoIconContainer, item.borrowed_to ? styles.borrowIconBg : null]}>
              <FontAwesome6
                name="hand-holding"
                size={16}
                color={item.borrowed_to ? '#E17055' : '#6C63FF'}
              />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>借出状态</Text>
              {item.borrowed_to ? (
                <Text style={[styles.infoValue, styles.borrowedText]}>
                  已借给 {item.borrowed_to}
                  {item.borrowed_at
                    ? `（${new Date(item.borrowed_at).toLocaleDateString('zh-CN')} 借出）`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.infoValue}>在家</Text>
              )}
            </View>
            {item.borrowed_to ? (
              <TouchableOpacity style={styles.returnBtn} onPress={handleReturn}>
                <FontAwesome6 name="rotate-left" size={13} color="#00B894" />
                <Text style={styles.returnBtnText}>标记归还</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.borrowBtn} onPress={() => setBorrowModalVisible(true)}>
                <FontAwesome6 name="share" size={13} color="#6C63FF" />
                <Text style={styles.borrowBtnText}>标记借出</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 过期日期 */}
          {item.expiry_date ? (() => {
            const days = daysUntilExpiry(item.expiry_date);
            const urgent = days !== null && days <= 30;
            return (
              <View style={styles.infoRow}>
                <View style={[styles.infoIconContainer, urgent ? styles.expiryIconBg : null]}>
                  <FontAwesome6
                    name="hourglass-half"
                    size={16}
                    color={urgent ? '#E17055' : '#6C63FF'}
                  />
                </View>
                <View style={styles.infoTextContainer}>
                  <Text style={styles.infoLabel}>到期日</Text>
                  <Text style={[styles.infoValue, urgent ? styles.expiredText : null]}>
                    {item.expiry_date}
                    {days !== null && days < 0 ? `（已过期 ${-days} 天）` : ''}
                    {days !== null && days === 0 ? '（今天到期）' : ''}
                    {days !== null && days > 0 ? `（还有 ${days} 天）` : ''}
                  </Text>
                </View>
              </View>
            );
          })() : null}

          {/* Created date */}
          <View style={styles.dateRow}>
            <Text style={styles.dateText}>
              记录于 {new Date(item.created_at).toLocaleDateString('zh-CN')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 借出弹窗 */}
      <Modal visible={borrowModalVisible} transparent animationType="fade">
        <View style={styles.borrowOverlay}>
          <View style={styles.borrowModal}>
            <Text style={styles.borrowModalTitle}>借给谁了？</Text>
            <TextInput
              style={styles.borrowInput}
              placeholder="如：同事小李、邻居老王"
              placeholderTextColor="#B2BEC3"
              value={borrowName}
              onChangeText={setBorrowName}
              maxLength={20}
              autoFocus
            />
            <View style={styles.borrowModalActions}>
              <TouchableOpacity
                style={styles.borrowCancelBtn}
                onPress={() => {
                  setBorrowModalVisible(false);
                  setBorrowName('');
                }}
              >
                <Text style={styles.borrowCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.borrowConfirmBtn, borrowSaving && styles.borrowConfirmDisabled]}
                onPress={handleBorrow}
                disabled={borrowSaving}
              >
                {borrowSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.borrowConfirmText}>确认借出</Text>
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
  // 借出 / 到期
  borrowIconBg: { backgroundColor: '#E1705518' },
  borrowedText: { color: '#E17055' },
  borrowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#6C63FF14',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  borrowBtnText: { fontSize: 13, color: '#6C63FF', fontWeight: '600' },
  returnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00B89414',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  returnBtnText: { fontSize: 13, color: '#00B894', fontWeight: '600' },
  expiryIconBg: { backgroundColor: '#E1705518' },
  expiredText: { color: '#E17055' },
  // 借出弹窗
  borrowOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  borrowModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
  },
  borrowModalTitle: { fontSize: 18, fontWeight: '700', color: '#2D3436', marginBottom: 16 },
  borrowInput: {
    backgroundColor: '#F0F0F3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#2D3436',
    marginBottom: 20,
  },
  borrowModalActions: { flexDirection: 'row', gap: 12 },
  borrowCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F0F0F3',
    alignItems: 'center',
  },
  borrowCancelText: { fontSize: 15, color: '#636E72', fontWeight: '600' },
  borrowConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
  },
  borrowConfirmDisabled: { opacity: 0.6 },
  borrowConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '700' },
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
    gap: 8,
  },
  photoPlaceholderTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginTop: 4,
  },
  photoPlaceholderSub: {
    fontSize: 13,
    color: '#636E72',
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
