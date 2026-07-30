import { authFetch } from '@/utils/api';
import { LocationPicker, type LocationSelection } from '@/components/LocationPicker';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  BackHandler,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { FontAwesome6 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { createFormDataFile } from '@/utils';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
const LAST_CATEGORY_KEY = '@stashspot_last_category_id';
const CATEGORIES_CACHE_KEY = '@stashspot_categories_cache_v1';
const LOCATIONS_CACHE_KEY = '@stashspot_freq_locations_cache_v1';

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
  /** 预设空间挂载（如从某个隔层"拍照放入"进入），用户可清除或改选 */
  presetSpace?: LocationSelection | null;
  onClose: () => void;
  onSaved: () => void;
  /** 连拍"再来一件"：由父组件重新调相机，拍完后以新 photoUri 重新打开本弹窗 */
  onRetake?: () => void;
}

type CaptureMode = 'single' | 'multi';

interface MultiItemRow {
  name: string;
  category_id: number | null;
  category_name: string;
  checked: boolean;
}

// 连拍 combo 文案：给连续录入即时称号反馈
function comboTitle(n: number): string {
  if (n <= 1) return '存好了！';
  if (n === 2) return '二连击！';
  if (n === 3) return '三连击！';
  if (n === 4) return '四连击！';
  if (n < 10) return `手感火热 x${n}`;
  return `收纳大师 x${n}`;
}

export function QuickSaveModal({ visible, photoUri, presetSpace, onClose, onSaved, onRetake }: QuickSaveModalProps) {
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
  // 连拍与反馈
  const [rapidFire, setRapidFire] = useState(false);
  const [comboCount, setComboCount] = useState(0);
  const [savedInfo, setSavedInfo] = useState<{ title: string; desc: string } | null>(null);
  const [successScale] = useState(() => new Animated.Value(0));
  // 一拍多录
  const [mode, setMode] = useState<CaptureMode>('single');
  const [multiItems, setMultiItems] = useState<MultiItemRow[]>([]);
  const [multiStatus, setMultiStatus] = useState<'idle' | 'recognizing' | 'done' | 'failed'>('idle');
  const multiStartedFor = useRef<string | null>(null);
  // 「再来一件」防连点标记：新照片进入时（useEffect 重置）才会清零
  const retakeFiredRef = useRef(false);
  // 跟踪"当前照片"：连拍时旧照片的识别/上传响应晚到，必须丢弃，防止污染新照片数据
  const photoUriRef = useRef(photoUri);
  photoUriRef.current = photoUri;

  // ── 覆盖层自绘弹窗（不用 RN Modal）────────────────────────────
  // 为什么不用 <Modal>：iOS 上 Modal 的 present 由原生层管理，当 Modal 内容高度突变
  // （保存成功切成功页）或下方页面布局剧变（onSaved 刷新列表）时，原生会把 Modal
  // 重新 present，导致整个子树被重建（state/ref 全丢、useEffect 重跑、动画重播），
  // 表现为"弹窗反复弹出好几下"。自绘覆盖层是纯 React 视图，无原生 present 过程，彻底免疫。
  const [render, setRender] = useState(visible);
  const [slideAnim] = useState(() => new Animated.Value(700));
  const [fadeAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(700);
      fadeAnim.setValue(0);
      setRender(true);
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 700, duration: 220, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setRender(false));
    }
  }, [visible, slideAnim, fadeAnim]);

  // Android 返回键关闭（原 Modal 的 onRequestClose 能力）
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Modal 打开时：重置状态 + 后台 AI 识别（含上传）+ 拉取分类和常用位置
  // 连拍模式（rapidFire）：保留上一件的位置/空间，用户只需按快门
  useEffect(() => {
    if (!visible || !photoUri) return;

    const keepCtx = rapidFire;
    if (!keepCtx) {
      setLocation('');
      setSpaceSel(presetSpace ?? null);
      setComboCount(0);
      setSelectedCategory(null);
    }
    setPickerVisible(false);
    setName('');
    setTags([]);
    setNewTag('');
    setPhotoKey(null);
    setAiStatus('idle');
    setSavedInfo(null);
    setMode('single');
    setMultiItems([]);
    setMultiStatus('idle');
    retakeFiredRef.current = false;

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
      // 连拍竞态防护：响应回来时用户已拍下一张，丢弃过期数据
      if (photoUriRef.current !== uri) return;

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
      if (photoUriRef.current !== uri) return; // 已换新照片，旧响应直接丢弃
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
      if (photoUriRef.current !== uri) return; // 已换新照片，丢弃过期上传结果
      setPhotoKey(data.key);
    } catch (e) {
      console.error('Upload failed:', e);
      Toast.show({ type: 'error', text1: '照片上传失败', text2: '请关闭后重试' });
    }
  };

  // 应用分类数据：自动选中上次使用的分类；仅在当前无选中时兜底，
  // 避免覆盖 AI 识别结果（接口快慢无序）或连拍沿用的分类
  const applyCategories = async (list: Category[]) => {
    setCategories(list);
    const lastId = await AsyncStorage.getItem(LAST_CATEGORY_KEY);
    const lastIdNum = lastId ? Number(lastId) : null;
    const validLast = list.find((c) => c.id === lastIdNum);
    setSelectedCategory((prev) => {
      if (prev !== null) return prev;
      if (validLast) return validLast.id;
      return list.length > 0 ? list[0].id : null;
    });
  };

  const fetchCategories = async () => {
    // 缓存优先：弹窗打开时秒出上次数据，网络返回后静默刷新
    if (categories.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(CATEGORIES_CACHE_KEY);
        if (cached) {
          const list = JSON.parse(cached) as Category[];
          if (Array.isArray(list) && list.length > 0) await applyCategories(list);
        }
      } catch { /* 缓存读取失败忽略 */ }
    }
    try {
      /**
       * 服务端文件：server/src/routes/categories.ts
       * 接口：GET /api/v1/categories
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      const list = (Array.isArray(data) ? data : []) as Category[];
      await applyCategories(list);
      AsyncStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(list)).catch(() => {
        // 缓存写入失败忽略，下次启动会重新拉取
      });
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    }
  };

  const fetchFrequentLocations = async () => {
    // 缓存优先：常用位置秒出，网络返回后静默刷新
    if (frequentLocations.length === 0) {
      try {
        const cached = await AsyncStorage.getItem(LOCATIONS_CACHE_KEY);
        if (cached) {
          const list = JSON.parse(cached) as FrequentLocation[];
          if (Array.isArray(list) && list.length > 0) setFrequentLocations(list);
        }
      } catch { /* 缓存读取失败忽略 */ }
    }
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：GET /api/v1/items/locations
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/locations`);
      const data = await res.json();
      const list = (Array.isArray(data) ? data : []) as FrequentLocation[];
      setFrequentLocations(list);
      AsyncStorage.setItem(LOCATIONS_CACHE_KEY, JSON.stringify(list)).catch(() => {
        // 缓存写入失败忽略，下次启动会重新拉取
      });
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

      // 进球反馈：震动 + 弹跳动画 + combo 文案；不关闭弹窗，进入连拍成功页
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Web 端无震动能力，忽略
      }
      const nextCombo = comboCount + 1;
      setComboCount(nextCombo);
      setRapidFire(true);
      successScale.setValue(0);
      Animated.spring(successScale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
      const place = spaceSel?.path || location.trim();
      setSavedInfo({
        title: comboTitle(nextCombo),
        desc: `${name.trim() || '物品'} → ${place}`,
      });
      onSaved();
    } catch (e) {
      console.error('Save failed:', e);
      Toast.show({ type: 'error', text1: '保存失败', text2: '请重试' });
    } finally {
      setSaving(false);
    }
  };

  // 一拍多录：识别同一张全景照中的多个物品
  const recognizeMulti = async () => {
    if (!photoUri) return;
    const uri = photoUri; // 捕获当前照片，响应回来时校验是否已换
    setMultiStatus('recognizing');
    try {
      const file = await createFormDataFile(uri, `multi_${Date.now()}.jpg`, 'image/jpeg');
      const formData = new FormData();
      formData.append('photo', file as any);

      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items/recognize-multi
       * Body 参数：photo: File (FormData)
       * 返回：{ photo_key: string, items: [{ name: string, category_id: number | null, category_name: string }] }
       */
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items/recognize-multi`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('multi recognize failed');
      const data = await res.json();
      if (photoUriRef.current !== uri) return; // 已换新照片，丢弃过期清单
      if (data.photo_key) setPhotoKey(data.photo_key);
      setMultiItems(
        (data.items || []).map((it: { name: string; category_id: number | null; category_name: string }) => ({
          ...it,
          checked: true,
        }))
      );
      setMultiStatus('done');
    } catch (e) {
      if (photoUriRef.current !== uri) return; // 已换新照片，旧响应直接丢弃
      console.error('Multi recognize failed:', e);
      setMultiStatus('failed');
    }
  };

  const switchToMulti = () => {
    setMode('multi');
    if (multiStartedFor.current !== photoUri) {
      multiStartedFor.current = photoUri;
      recognizeMulti();
    }
  };

  const toggleMultiItem = (idx: number) => {
    setMultiItems((prev) => prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)));
  };

  const removeMultiItem = (idx: number) => {
    setMultiItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // 批量保存勾选的物品（共用同一张全景照与同一位置）
  const handleSaveMulti = async () => {
    const chosen = multiItems.filter((it) => it.checked);
    if (chosen.length === 0) {
      Toast.show({ type: 'info', text1: '至少勾选一件' });
      return;
    }
    if (!location.trim() && !spaceSel) {
      Toast.show({ type: 'info', text1: '选个位置', text2: '这批物品统一放到这个位置' });
      return;
    }
    if (!photoKey) {
      Toast.show({ type: 'info', text1: '照片还在上传中', text2: '稍等一秒再点' });
      return;
    }

    setSaving(true);
    let okCount = 0;
    try {
      /**
       * 服务端文件：server/src/routes/items.ts
       * 接口：POST /api/v1/items（逐件循环创建）
       * Body 参数：name: string, category_id: number | null, location: string, location_id: number | null, tags: string, photo_key: string, note: string
       */
      await Promise.all(
        chosen.map(async (it) => {
          const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: it.name,
              category_id: it.category_id,
              location: location.trim(),
              location_id: spaceSel?.location_id ?? null,
              tags: '',
              photo_key: photoKey,
              note: '',
            }),
          });
          if (res.ok) okCount += 1;
        })
      );
      if (okCount === 0) throw new Error('all failed');

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // Web 端忽略
      }
      setRapidFire(true);
      successScale.setValue(0);
      Animated.spring(successScale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
      const place = spaceSel?.path || location.trim();
      setSavedInfo({
        title: `一次存入 ${okCount} 件！`,
        desc: `已放入「${place}」${okCount < chosen.length ? `（${chosen.length - okCount} 件失败）` : ''}`,
      });
      onSaved();
    } catch (e) {
      console.error('Multi save failed:', e);
      Toast.show({ type: 'error', text1: '保存失败', text2: '请重试' });
    } finally {
      setSaving(false);
    }
  };

  // 连拍：再来一件（父组件重新调相机，拍完后以新 photoUri 重开本弹窗）
  const handleRetake = () => {
    // 防连点：一次 retake 流程未结束时忽略后续点击，避免多个相机调用排队、弹窗反复弹出
    if (retakeFiredRef.current) return;
    retakeFiredRef.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Web 端忽略
    }
    if (onRetake) onRetake();
  };

  // 结束连拍，关闭弹窗
  const handleFinish = () => {
    setRapidFire(false);
    setComboCount(0);
    onClose();
  };

  const saveDisabled = saving || aiStatus === 'recognizing' || !photoKey;
  const multiCheckedCount = multiItems.filter((it) => it.checked).length;
  const multiSaveDisabled = saving || multiStatus === 'recognizing' || !photoKey || multiCheckedCount === 0;

  if (!render) return null;
  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView
        style={styles.kavWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          {/* 顶部：照片 + 标题 */}
          <View style={styles.headerRow}>
            <View>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.thumbnail} contentFit="cover" transition={120} recyclingKey={photoUri} />
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

          {/* 保存成功页（连拍反馈）：覆盖内容区与保存按钮 */}
          {savedInfo ? (
            <View style={styles.successWrap}>
              <Animated.View style={{ transform: [{ scale: successScale }] }}>
                <View style={styles.successCircle}>
                  <FontAwesome6 name="check" size={34} color="#FFFFFF" />
                </View>
              </Animated.View>
              <Text style={styles.successTitle}>{savedInfo.title}</Text>
              <Text style={styles.successDesc} numberOfLines={2}>{savedInfo.desc}</Text>
              {comboCount >= 2 && (
                <View style={styles.comboBadge}>
                  <FontAwesome6 name="fire" size={12} color="#E17055" />
                  <Text style={styles.comboBadgeText}>连续录入 {comboCount} 件</Text>
                </View>
              )}
              {onRetake && (
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake} activeOpacity={0.85}>
                  <FontAwesome6 name="camera" size={16} color="#FFFFFF" />
                  <Text style={styles.retakeBtnText}>再来一件，放同一位置</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.finishBtn} onPress={handleFinish} activeOpacity={0.7}>
                <Text style={styles.finishBtnText}>完成</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <>
          {/* 模式切换：单件 / 一片区域（多物品） */}
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[styles.modeChip, mode === 'single' && styles.modeChipActive]}
              onPress={() => setMode('single')}
              activeOpacity={0.8}
            >
              <FontAwesome6 name="cube" size={12} color={mode === 'single' ? '#FFFFFF' : '#636E72'} />
              <Text style={[styles.modeChipText, mode === 'single' && styles.modeChipTextActive]}>单件</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeChip, mode === 'multi' && styles.modeChipActive]}
              onPress={switchToMulti}
              activeOpacity={0.8}
            >
              <FontAwesome6 name="layer-group" size={12} color={mode === 'multi' ? '#FFFFFF' : '#636E72'} />
              <Text style={[styles.modeChipText, mode === 'multi' && styles.modeChipTextActive]}>一片区域</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 一拍多录：物品清单（位置区与单件模式共用，在下方） */}
            {mode === 'multi' && (
              <View style={styles.multiWrap}>
                {multiStatus === 'recognizing' && (
                  <View style={styles.multiStatusRow}>
                    <ActivityIndicator size="small" color="#6C63FF" />
                    <Text style={styles.multiStatusText}>AI 正在清点这片区域…</Text>
                  </View>
                )}
                {multiStatus === 'failed' && (
                  <View style={styles.multiStatusRow}>
                    <Text style={styles.multiStatusText}>识别失败，</Text>
                    <TouchableOpacity onPress={recognizeMulti}><Text style={styles.multiRetryText}>点我重试</Text></TouchableOpacity>
                  </View>
                )}
                {multiStatus === 'done' && multiItems.length === 0 && (
                  <View style={styles.multiStatusRow}>
                    <Text style={styles.multiStatusText}>没认出物品，换张角度更正、光线更好的试试</Text>
                  </View>
                )}
                {multiStatus === 'done' && multiItems.length > 0 && (
                  <>
                    <Text style={styles.multiHint}>认出 {multiItems.length} 件，勾选要录入的：</Text>
                    {multiItems.map((it, idx) => (
                      <View key={`${it.name}_${idx}`} style={styles.multiRow}>
                        <TouchableOpacity onPress={() => toggleMultiItem(idx)} hitSlop={8}>
                          <View style={[styles.multiCheck, it.checked && styles.multiCheckActive]}>
                            {it.checked && <FontAwesome6 name="check" size={11} color="#FFF" />}
                          </View>
                        </TouchableOpacity>
                        <Text style={[styles.multiName, !it.checked && { color: '#B2BEC3' }]} numberOfLines={1}>{it.name}</Text>
                        {it.category_name ? (
                          <View style={styles.multiCatChip}>
                            <Text style={styles.multiCatChipText} numberOfLines={1}>{it.category_name}</Text>
                          </View>
                        ) : null}
                        <TouchableOpacity onPress={() => removeMultiItem(idx)} hitSlop={8}>
                          <FontAwesome6 name="xmark" size={13} color="#C0C0C8" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </>
                )}
              </View>
            )}
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
                autoFocus={false}
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

            {mode === 'single' && (
            <>
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
            </>
            )}
          </ScrollView>

          {/* 保存按钮：单件存 1 件 / 多录批量存入 */}
          <TouchableOpacity
            style={[styles.saveBtn, (mode === 'multi' ? multiSaveDisabled : saveDisabled) && styles.saveBtnDisabled]}
            onPress={mode === 'multi' ? handleSaveMulti : handleSave}
            disabled={mode === 'multi' ? multiSaveDisabled : saveDisabled}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <FontAwesome6 name="check" size={16} color="#FFF" />
                <Text style={styles.saveBtnText}>
                {mode === 'multi' ? `全部存入（${multiCheckedCount}）` : '存好了'}
              </Text>
              </>
            )}
          </TouchableOpacity>
          </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
      <LocationPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(sel) => setSpaceSel(sel)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 990,
    elevation: 24,
  },
  kavWrap: {
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
  /* ===== 保存成功页（连拍进球反馈） ===== */
  successWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    paddingBottom: 40,
    gap: 12,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#00B894',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00B894',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2D3436',
  },
  successDesc: {
    fontSize: 14,
    color: '#636E72',
    textAlign: 'center',
    lineHeight: 20,
  },
  comboBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF3EE',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 4,
  },
  comboBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E17055',
  },
  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    paddingVertical: 15,
    alignSelf: 'stretch',
    marginTop: 20,
    shadowColor: '#6C63FF',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  retakeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  finishBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    alignSelf: 'stretch',
  },
  finishBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  /* ===== 模式切换 ===== */
  modeSwitch: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0F0F5',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  modeChipActive: {
    backgroundColor: '#6C63FF',
  },
  modeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
  },
  modeChipTextActive: {
    color: '#FFFFFF',
  },
  /* ===== 一拍多录清单 ===== */
  multiWrap: {
    marginBottom: 12,
  },
  multiStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  multiStatusText: {
    fontSize: 14,
    color: '#636E72',
  },
  multiRetryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6C63FF',
  },
  multiHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#636E72',
    marginBottom: 10,
  },
  multiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8F8FA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  multiCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#C0C0C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiCheckActive: {
    backgroundColor: '#6C63FF',
    borderColor: '#6C63FF',
  },
  multiName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  multiCatChip: {
    backgroundColor: '#EDEBFF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 90,
  },
  multiCatChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6C63FF',
  },
});
