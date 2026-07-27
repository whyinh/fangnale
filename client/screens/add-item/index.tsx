import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { createFormDataFile } from '@/utils';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export default function AddItemScreen() {
  const router = useSafeRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);

  React.useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(data);
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('权限不足', '需要相册权限才能选择照片');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      await uploadPhoto(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
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
      setPhotoUri(result.assets[0].uri);
      await uploadPhoto(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (uri: string) => {
    setUploading(true);
    try {
      const file = await createFormDataFile(uri, `item_${Date.now()}.jpg`, 'image/jpeg');
      const formData = new FormData();
      formData.append('file', file as any);

      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setPhotoKey(data.key);
    } catch (e) {
      console.error('Upload failed:', e);
      Alert.alert('上传失败', '照片上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('提示', '请输入物品名称');
      return;
    }
    if (!selectedCategory) {
      Alert.alert('提示', '请选择分类');
      return;
    }
    if (!photoKey) {
      Alert.alert('提示', '请先拍照或选择照片');
      return;
    }

    setSaving(true);
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items
       * Body 参数：name: string, category_id: number, location: string, tags: string, photo_key: string, note: string, expiry_date?: string（YYYY-MM-DD）
       */
      const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category_id: selectedCategory,
          location: location.trim(),
          tags: tags.trim(),
          photo_key: photoKey,
          note: note.trim(),
          ...(expiryDate ? { expiry_date: expiryDate } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '保存失败');
      }

      router.back();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen backgroundColor="#F0F0F3">
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <FontAwesome6 name="arrow-left" size={20} color="#2D3436" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>添加物品</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Photo Area */}
        <View style={styles.photoSection}>
          {photoUri ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: photoUri }} style={styles.photo} />
              {uploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#FFF" />
                  <Text style={styles.uploadText}>上传中...</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.retakeBtn}
                onPress={handlePickImage}
              >
                <FontAwesome6 name="camera" size={14} color="#FFF" />
                <Text style={styles.retakeText}>更换</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <TouchableOpacity style={styles.photoOption} onPress={handleTakePhoto}>
                <View style={styles.photoIconContainer}>
                  <FontAwesome6 name="camera" size={28} color="#6C63FF" />
                </View>
                <Text style={styles.photoOptionText}>拍照</Text>
              </TouchableOpacity>
              <View style={styles.photoDivider} />
              <TouchableOpacity style={styles.photoOption} onPress={handlePickImage}>
                <View style={styles.photoIconContainer}>
                  <FontAwesome6 name="images" size={28} color="#FF6584" />
                </View>
                <Text style={styles.photoOptionText}>从相册选择</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Name Input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>物品名称 *</Text>
          <View style={styles.inputContainer}>
            <FontAwesome6 name="tag" size={14} color="#B2BEC3" />
            <TextInput
              style={styles.input}
              placeholder="例如：护照、充电器、冬季外套..."
              placeholderTextColor="#B2BEC3"
              value={name}
              onChangeText={setName}
            />
          </View>
        </View>

        {/* Category Selection */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>分类 *</Text>
          {loadingCategories ? (
            <ActivityIndicator color="#6C63FF" />
          ) : (
            <View style={styles.categoryGrid}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryOption,
                    selectedCategory === cat.id && { backgroundColor: cat.color, borderColor: cat.color },
                  ]}
                  onPress={() => setSelectedCategory(cat.id)}
                >
                  <FontAwesome6
                    name={cat.icon as any}
                    size={18}
                    color={selectedCategory === cat.id ? '#FFF' : cat.color}
                  />
                  <Text
                    style={[
                      styles.categoryOptionText,
                      selectedCategory === cat.id && { color: '#FFF' },
                    ]}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Location Input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>存放位置</Text>
          <View style={styles.inputContainer}>
            <FontAwesome6 name="map-pin" size={14} color="#B2BEC3" />
            <TextInput
              style={styles.input}
              placeholder="例如：书房第二个抽屉、衣柜顶层..."
              placeholderTextColor="#B2BEC3"
              value={location}
              onChangeText={setLocation}
            />
          </View>
        </View>

        {/* Tags Input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>标签</Text>
          <View style={styles.inputContainer}>
            <FontAwesome6 name="hashtag" size={14} color="#B2BEC3" />
            <TextInput
              style={styles.input}
              placeholder="用逗号分隔，例如：重要,常用,易碎"
              placeholderTextColor="#B2BEC3"
              value={tags}
              onChangeText={setTags}
            />
          </View>
        </View>

        {/* Note Input */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>备注</Text>
          <View style={[styles.inputContainer, styles.textAreaContainer]}>
            <TextInput
              style={styles.textArea}
              placeholder="添加备注信息..."
              placeholderTextColor="#B2BEC3"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </View>

        {/* 过期日期（选填） */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>到期日（选填，药品/食品/证件适用）</Text>
          <View style={styles.expiryQuickRow}>
            {[
              { label: '7天后', days: 7 },
              { label: '30天后', days: 30 },
              { label: '半年后', days: 182 },
              { label: '一年后', days: 365 },
            ].map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={styles.expiryQuickChip}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + opt.days);
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  setExpiryDate(`${y}-${m}-${day}`);
                }}
              >
                <Text style={styles.expiryQuickChipText}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.inputContainer}>
            <FontAwesome6 name="hourglass-half" size={14} color="#B2BEC3" />
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD，如 2026-12-31"
              placeholderTextColor="#B2BEC3"
              value={expiryDate}
              onChangeText={setExpiryDate}
              maxLength={10}
            />
            {expiryDate ? (
              <TouchableOpacity onPress={() => setExpiryDate('')}>
                <FontAwesome6 name="xmark" size={14} color="#B2BEC3" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, (saving || uploading) && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving || uploading}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.saveButtonText}>保存物品</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  expiryQuickRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  expiryQuickChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
  },
  expiryQuickChipText: { fontSize: 13, color: '#636E72', fontWeight: '600' },
  container: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
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
  photoSection: {
    marginBottom: 24,
  },
  photoContainer: {
    position: 'relative',
    borderRadius: 24,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: 24,
    backgroundColor: '#E8E8EB',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadText: {
    color: '#FFF',
    fontSize: 14,
    marginTop: 8,
  },
  retakeBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  retakeText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  photoPlaceholder: {
    flexDirection: 'row',
    backgroundColor: '#F0F0F3',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  photoOption: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  photoIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(108,99,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D3436',
  },
  photoDivider: {
    width: 1,
    backgroundColor: '#E8E8EB',
    marginHorizontal: 16,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 14 : 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    padding: 0,
  },
  textAreaContainer: {
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  textArea: {
    width: '100%',
    fontSize: 15,
    color: '#2D3436',
    padding: 0,
    minHeight: 60,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F3',
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#E8E8EB',
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  categoryOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3436',
  },
  saveButton: {
    backgroundColor: '#6C63FF',
    borderRadius: 9999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
