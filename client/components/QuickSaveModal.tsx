import { authFetch } from '@/utils/api';
import { LocationPicker, type LocationSelection } from '@/components/LocationPicker';
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

type AiStatus = 'idle' | 'recognizing' | 'done' | 'failed';

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
  const [spaceSel, setSpaceSel] = useState<LocationSelection | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');
  const [saving, setSaving] = useState(false);
  const recognizeStartedFor = useRef<string | null>(null);

  // Modal 打开时：重置状态 + 后台 AI 识别（含上传）+ 拉取分类和常用位置
  useEffect(() => {
    if (!visible || !photoUri) return;

    setLocation('');
    setSpaceSel(null);
    setPickerVisible(false);
    setName('');
    setTags([]);
    setNewTag('');
    setPhotoKey(null);
    setAiStatus('idle');

    // 后台并行：照片上传 + AI 识别（用户选位置的同时 AI 已填好名称/标签/分类）
    if (recognizeStartedFor.current !== photoUri) {
      recognizeStartedFor.current = photoUri;
      recognizePhoto(photoUri);
    }

    fetchCategories();
    fetchFrequentLocations();
  }, [visible, photoUri]);

  // AI 识别：一次请求完成 照片上传 S3 + 多模态识别，返回 photo_key 供保存时直接复用
  const recognizePhoto = async (uri: string) => {
    setAiStatus('recognizing');
    try {
      const file = await createFormDataFile(uri, `item_${Date.now()}.jpg`, 'image/jpeg');
      const formData = new FormData();
      formData.append('photo', file as any);

      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items/recognize
       * Body 参数：photo: File (FormData)
       * 返回：{ photo_key: string, name: string, tags: string[], category_id: number | null }
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/recognize`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('recognize failed');
      const data = await res.json();

      setPhotoKey(data.photo_key);
      // 用户已在输入则不覆盖（识别耗时 1-3 秒，尊重用户输入）
      if (data.name && data.name !== '未命名物品' && data.name !== '未识别物品') {
        setName((prev) => (prev.trim() ? prev : data.name));
      }
      if (Array.isArray(data.tags)) {
        setTags((prev) => (prev.length > 0 ? prev : data.tags));
      }
      if (data.category_id) {
        setSelectedCategory(data.category_id);
      }
      // AI 自动创建了新分类时刷新分类列表，保证选择器能展示该选项
      if (data.category_created) {
        fetchCategories();
      }
      setAiStatus('done');
      if (data.category_name) {
        Toast.show({
          type: 'success',
          text1: `已自动归类到「${data.category_name}」`,
          text2: data.category_created ? '已为你创建新分类' : undefined,
        });
      }
    } catch (e) {
      console.error('Recognize failed, fallback to plain upload:', e);
      // 降级：识别接口不可用时走纯上传，不影响保存流程
      setAiStatus('failed');
      fallbackUpload(uri);
    }
  };

  // 降级上传（识别接口失败时保证照片仍能保存）
  const fallbackUpload = async (uri: string) => {
    try {
      const file = await createFormDataFile(uri, `item_${Date.now()}.jpg`, 'image/jpeg');
      const formData = new FormData();
      formData.append('file', file as any);

      /**
       * 服务端文件：server/src/routes/upload.ts
       * 接口：POST /api/v1/upload/photo
       * Body 参数：file: File (FormData)
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/upload/photo`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setPhotoKey(data.key);
    } catch (e) {
      console.error('Upload failed:', e);
      Toast.show({ type: 'error', text1: '照片上传失败', text2: '请关闭后重试' });
    }
  };

  const fetchCategories = async () => {
    try {
      /**
       * 服务端文件：server/src/routes/categories.ts
       * 接口：GET /api/v1/categories
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(data);

      // 自动选中上次使用的分类（AI 识别完成后会覆盖为更准确的分类）
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
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/locations`);
      const data = await res.json();
      setFrequentLocations(data);
    } catch (e) {
      console.error('Failed to fetch locations:', e);
    }
  };

  const handleLocationChipPress = (loc: string) => {
    setLocation(loc === location ? '' : loc);
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleAddTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (!tags.includes(t) && tags.length < 6) {
      setTags((prev) => [...prev, t]);
    }
    setNewTag('');
  };

  const handleSave = async () => {
    if (!location.trim() && !spaceSel) {
      Toast.show({ type: 'info', text1: '选个位置', text2: '点一下常用位置、输入新位置，或挂到空间隔层' });
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
       * Body 参数：name: string, category_id: number, location: string, location_id: number | null, tags: string, photo_key: string, note: string
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category_id: selectedCategory,
          location: location.trim(),
          location_id: spaceSel?.location_id ?? null,
          tags: tags.join(','),
          photo_key: photoKey,
          note: '',
        }),
      });

      if (!res.ok) throw new Error('保存失败');

      // 记住本次分类，下次自动选中
      if (selectedCategory) {
        await AsyncStorage.setItem(LAST_CATEGORY_KEY, String(selectedCategory));
      }

      Toast.show({ type: 'success', text1: '存好了', text2: spaceSel?.path || location.trim() });
      onSaved();
      onClose();
    } catch (e) {
      console.error('Save failed:', e);
      Toast.show({ type: 'error', text1: '保存失败', text2: '请重试' });
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = saving || aiStatus === 'recognizing' || !photoKey;

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
            <View>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.thumbnail} />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                  <FontAwesome6 name="image" size={20} color="#B2BEC3" />
                </View>
              )}
              {aiStatus === 'recognizing' && (
                <View style={styles.thumbnailOverlay}>
                  <ActivityIndicator size="small" color="#FFF" />
                </View>
              )}
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>记到哪了？</Text>
              <View style={styles.uploadStatus}>
                {aiStatus === 'recognizing' ? (
                  <>
                    <ActivityIndicator size={10} color="#6C63FF" />
                    <Text style={styles.uploadStatusText}>AI 识别中…</Text>
                  </>
                ) : aiStatus === 'done' ? (
                  <>
                    <FontAwesome6 name="wand-magic-sparkles" size={10} color="#00B894" />
                    <Text style={[styles.uploadStatusText, { color: '#00B894' }]}>
                      AI 已识别，可修改
                    </Text>
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

          <ScrollView
            style={styles.bodyScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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

            {/* 空间位置（可选）：挂到房间/家具/隔层 */}
            <TouchableOpacity style={styles.inputRow} onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
              <FontAwesome6 name="boxes-stacked" size={15} color={spaceSel ? '#6C63FF' : '#B2BEC3'} />
              <Text style={[styles.input, !spaceSel && { color: '#B2BEC3' }]} numberOfLines={1}>
                {spaceSel ? spaceSel.path : '挂到空间隔层（可选）'}
              </Text>
              {spaceSel ? (
                <TouchableOpacity onPress={() => setSpaceSel(null)} hitSlop={8}>
                  <FontAwesome6 name="xmark" size={14} color="#B2BEC3" />
                </TouchableOpacity>
              ) : (
                <FontAwesome6 name="chevron-right" size={12} color="#C0C0C8" />
              )}
            </TouchableOpacity>

            {/* 名称输入（选填，AI 自动填） */}
            <View style={styles.inputRow}>
              <FontAwesome6
                name={aiStatus === 'done' ? 'wand-magic-sparkles' : 'tag'}
                size={14}
                color={aiStatus === 'done' ? '#6C63FF' : '#B2BEC3'}
              />
              <TextInput
                style={styles.input}
                placeholder={
                  aiStatus === 'recognizing' ? 'AI 正在识别物品…' : '物品名称（选填）'
                }
                placeholderTextColor="#B2BEC3"
                value={name}
                onChangeText={setName}
              />
            </View>

            {/* 分类选择（AI 自动选中） */}
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

            {/* 标签（AI 生成，可增删） */}
            {(tags.length > 0 || aiStatus === 'done') && (
              <View style={styles.tagsSection}>
                <View style={styles.tagsRow}>
                  {tags.map((tag) => (
                    <View key={tag} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{tag}</Text>
                      <TouchableOpacity onPress={() => handleRemoveTag(tag)} hitSlop={6}>
                        <FontAwesome6 name="xmark" size={9} color="#6C63FF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TextInput
                    style={styles.tagInput}
                    placeholder="+ 标签"
                    placeholderTextColor="#B2BEC3"
                    value={newTag}
                    onChangeText={setNewTag}
                    onSubmitEditing={handleAddTag}
                    onBlur={handleAddTag}
                    returnKeyType="done"
                  />
                </View>
              </View>
            )}
          </ScrollView>

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
      <LocationPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(sel) => setSpaceSel(sel)}
      />
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
    maxHeight: '88%',
    shadowColor: '#2D3436',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
  thumbnailOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: 'rgba(45,52,54,0.45)',
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
  bodyScroll: {
    flexGrow: 0,
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
  tagsSection: {
    marginTop: 6,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(108,99,255,0.1)',
    borderRadius: 9999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  tagChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6C63FF',
  },
  tagInput: {
    minWidth: 64,
    fontSize: 12,
    color: '#2D3436',
    paddingVertical: 6,
    paddingHorizontal: 4,
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
