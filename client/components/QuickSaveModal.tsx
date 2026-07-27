import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { createFormDataFile } from '@/utils';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
const LAST_CATEGORY_KEY = '@stashspot_last_category_id';

interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

interface FrequentLocation {
  location: string;
  count: number;
}

interface QuickSaveModalProps {
  visible: boolean;
  photoUri: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function QuickSaveModal({ visible, photoUri, onClose, onSaved }: QuickSaveModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [frequentLocations, setFrequentLocations] = useState<FrequentLocation[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const uploadStartedFor = useRef<string | null>(null);

  // Modal 打开时：重置状态 + 后台上传照片 + 拉取分类和常用位置
  useEffect(() => {
    if (!visible || !photoUri) return;

    setLocation('');
    setName('');
    setPhotoKey(null);

    // 后台并行上传照片（用户填信息的同时照片已传好）
    if (uploadStartedFor.current !== photoUri) {
      uploadStartedFor.current = photoUri;
      uploadPhoto(photoUri);
    }

    fetchCategories();
    fetchFrequentLocations();
  }, [visible, photoUri]);

  const uploadPhoto = async (uri: string) => {
    setUploading(true);
    try {
      const file = await createFormDataFile(uri, `item_${Date.now()}.jpg`, 'image/jpeg');
      const formData = new FormData();
      formData.append('file', file as any);

      /**
       * 服务端文件：server/src/routes/upload.ts
       * 接口：POST /api/v1/upload/photo
       * Body 参数：file: File (FormData)
       */
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setPhotoKey(data.key);
    } catch (e) {
      console.error('Upload failed:', e);
      Toast.show({ type: 'error', text1: '照片上传失败', text2: '请关闭后重试' });
    } finally {
      setUploading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      /**
       * 服务端文件：server/src/routes/categories.ts
       * 接口：GET /api/v1/categories
       */
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(data);

      // 自动选中上次使用的分类
      const lastId = await AsyncStorage.getItem(LAST_CATEGORY_KEY);
      const lastIdNum = lastId ? Number(lastId) : null;
      const validLast = data.find((c: Category) => c.id === lastIdNum);
      if (validLast) {
        setSelectedCategory(validLast.id);
      } else if (data.length > 0) {
        setSelectedCategory(data[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  };

  const fetchFrequentLocations = async () => {
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：GET /api/v1/items/locations
       */
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/locations`);
      const data = await res.json();
      setFrequentLocations(data);
    } catch (e) {
      console.error('Failed to fetch locations:', e);
    }
  };

  const handleLocationChipPress = (loc: string) => {
    setLocation(loc === location ? '' : loc);
  };

  const handleSave = async () => {
    if (!location.trim()) {
      Toast.show({ type: 'info', text1: '选个位置', text2: '点一下常用位置，或输入新位置' });
      return;
    }
    if (!selectedCategory) {
      Toast.show({ type: 'info', text1: '选个分类' });
      return;
    }
    if (!photoKey) {
      Toast.show({ type: 'info', text1: '照片还在上传中', text2: '稍等一秒再点' });
      return;
    }

    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items
       * Body 参数：name: string, category_id: number, location: string, tags: string, photo_key: string, note: string
       */
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category_id: selectedCategory,
          location: location.trim(),
          tags: '',
          photo_key: photoKey,
          note: '',
        }),
      });

      if (!res.ok) throw new Error('保存失败');

      // 记住本次分类，下次自动选中
      await AsyncStorage.setItem(LAST_CATEGORY_KEY, String(selectedCategory));

      Toast.show({ type: 'success', text1: '存好了', text2: `${location.trim()}` });
      onSaved();
      onClose();
    } catch (e) {
      console.error('Save failed:', e);
      Toast.show({ type: 'error', text1: '保存失败', text2: '请重试' });
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = saving || uploading || !photoKey;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          {/* 顶部：照片 + 标题 */}
          <View style={styles.headerRow}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                <FontAwesome6 name="image" size={20} color="#B2BEC3" />
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.title}>记到哪了？</Text>
              <View style={styles.uploadStatus}>
                {uploading ? (
                  <>
                    <ActivityIndicator size={10} color="#6C63FF" />
                    <Text style={styles.uploadStatusText}>照片上传中…</Text>
                  </>
                ) : photoKey ? (
                  <>
                    <FontAwesome6 name="circle-check" size={10} color="#00B894" />
                    <Text style={[styles.uploadStatusText, { color: '#00B894' }]}>照片就绪</Text>
                  </>
                ) : null}
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <FontAwesome6 name="xmark" size={16} color="#636E72" />
            </TouchableOpacity>
          </View>

          {/* 位置快捷选择 */}
          {frequentLocations.length > 0 && (
            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.locChips}
                keyboardShouldPersistTaps="handled"
              >
                {frequentLocations.map((item) => {
                  const active = location === item.location;
                  return (
                    <TouchableOpacity
                      key={item.location}
                      style={[styles.locChip, active && styles.locChipActive]}
                      onPress={() => handleLocationChipPress(item.location)}
                    >
                      <FontAwesome6
                        name="map-pin"
                        size={11}
                        color={active ? '#FFF' : '#6C63FF'}
                      />
                      <Text style={[styles.locChipText, active && styles.locChipTextActive]}>
                        {item.location}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* 位置输入 */}
          <View style={styles.inputRow}>
            <FontAwesome6 name="map-pin" size={15} color="#6C63FF" />
            <TextInput
              style={styles.input}
              placeholder="放在哪了？如：书房抽屉"
              placeholderTextColor="#B2BEC3"
              value={location}
              onChangeText={setLocation}
              autoFocus={Platform.OS !== 'web'}
            />
          </View>

          {/* 名称输入（选填） */}
          <View style={styles.inputRow}>
            <FontAwesome6 name="tag" size={14} color="#B2BEC3" />
            <TextInput
              style={styles.input}
              placeholder="物品名称（选填，照片能看清就行）"
              placeholderTextColor="#B2BEC3"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* 分类选择 */}
          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catChips}
              keyboardShouldPersistTaps="handled"
            >
              {categories.map((cat) => {
                const active = selectedCategory === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.catChip, active && { backgroundColor: cat.color }]}
                    onPress={() => setSelectedCategory(cat.id)}
                  >
                    <FontAwesome6
                      name={cat.icon as any}
                      size={12}
                      color={active ? '#FFF' : cat.color}
                    />
                    <Text style={[styles.catChipText, active && { color: '#FFF' }]}>{cat.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* 保存按钮 */}
          <TouchableOpacity
            style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saveDisabled}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <FontAwesome6 name="check" size={16} color="#FFF" />
                <Text style={styles.saveBtnText}>存好了</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(45,52,54,0.4)',
  },
  sheet: {
    backgroundColor: '#F0F0F3',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    shadowColor: '#2D3436',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
  },
  thumbnailPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#2D3436',
  },
  uploadStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  uploadStatusText: {
    fontSize: 11,
    color: '#6C63FF',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locChips: {
    gap: 8,
    paddingBottom: 12,
  },
  locChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(108,99,255,0.1)',
    borderRadius: 9999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  locChipActive: {
    backgroundColor: '#6C63FF',
  },
  locChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
  },
  locChipTextActive: {
    color: '#FFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 13 : 11,
    marginBottom: 10,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    padding: 0,
  },
  catChips: {
    gap: 8,
    paddingVertical: 6,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E8E8EB',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#636E72',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 18,
    paddingVertical: 16,
    marginTop: 14,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveBtnDisabled: {
    backgroundColor: '#B2BEC3',
    shadowOpacity: 0,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
