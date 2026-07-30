import { authFetch } from '@/utils/api';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Modal,
  Alert,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

const ICON_OPTIONS = [
  'tag', 'box', 'shirt', 'smartphone', 'laptop', 'file-text',
  'coffee', 'wrench', 'gift', 'book', 'key', 'umbrella',
  'headphones', 'camera', 'gamepad', 'heart', 'star', 'gem',
];

const COLOR_OPTIONS = [
  '#6C63FF', '#FF6584', '#FDCB6E', '#00B894', '#E17055',
  '#636E72', '#0984E3', '#A29BFE', '#FD79A8', '#55EFC4',
];

interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
}

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('tag');
  const [selectedColor, setSelectedColor] = useState('#6C63FF');

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`);
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch categories:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchCategories();
    }, [fetchCategories])
  );

  const handleAdd = () => {
    setEditingCategory(null);
    setName('');
    setSelectedIcon('tag');
    setSelectedColor('#6C63FF');
    setModalVisible(true);
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setName(category.name);
    setSelectedIcon(category.icon);
    setSelectedColor(category.color);
    setModalVisible(true);
  };

  const handleDelete = (category: Category) => {
    Alert.alert(
      '确认删除',
      `确定要删除分类「${category.name}」吗？该分类下的物品不会受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              /**
               * 服务端文件：server/src/routes/categories.ts
               * 接口：DELETE /api/v1/categories/:id
               * Path 参数：id: number
               */
              await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories/${category.id}`, {
                method: 'DELETE',
              });
              fetchCategories();
            } catch (e) {
              Alert.alert('删除失败', '请重试');
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('提示', '请输入分类名称');
      return;
    }

    try {
      if (editingCategory) {
        /**
         * 服务端文件：server/src/routes/categories.ts
         * 接口：PUT /api/v1/categories/:id
         * Path 参数：id: number
         * Body 参数：name: string, icon: string, color: string
         */
        await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories/${editingCategory.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), icon: selectedIcon, color: selectedColor }),
        });
      } else {
        /**
         * 服务端文件：server/src/routes/categories.ts
         * 接口：POST /api/v1/categories
         * Body 参数：name: string, icon: string, color: string
         */
        await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), icon: selectedIcon, color: selectedColor }),
        });
      }
      setModalVisible(false);
      fetchCategories();
    } catch (e) {
      Alert.alert('保存失败', '请重试');
    }
  };

  const renderCategory = ({ item }: { item: Category }) => (
    <View style={styles.categoryCard}>
      <View style={[styles.categoryIcon, { backgroundColor: `${item.color}18` }]}>
        <FontAwesome6 name={item.icon as any} size={22} color={item.color} />
      </View>
      <View style={styles.categoryInfo}>
        <Text style={styles.categoryName}>{item.name}</Text>
      </View>
      <View style={styles.categoryActions}>
        <TouchableOpacity onPress={() => handleEdit(item)} style={styles.actionBtn}>
          <FontAwesome6 name="pen" size={14} color="#6C63FF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item)} style={styles.actionBtn}>
          <FontAwesome6 name="trash" size={14} color="#FF6B6B" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Screen backgroundColor="#F0F0F3">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>分类管理</Text>
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
            <FontAwesome6 name="plus" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Category List */}
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCategory}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Edit/Add Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {editingCategory ? '编辑分类' : '新建分类'}
                  </Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <FontAwesome6 name="xmark" size={20} color="#636E72" />
                  </TouchableOpacity>
                </View>

                {/* Name Input */}
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>分类名称</Text>
                  <View style={styles.modalInputContainer}>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="例如：电子产品、衣物..."
                      placeholderTextColor="#B2BEC3"
                      value={name}
                      onChangeText={setName}
                    />
                  </View>
                </View>

                {/* Icon Selection */}
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>图标</Text>
                  <View style={styles.iconGrid}>
                    {ICON_OPTIONS.map((icon) => (
                      <TouchableOpacity
                        key={icon}
                        style={[
                          styles.iconOption,
                          selectedIcon === icon && { backgroundColor: `${selectedColor}20`, borderColor: selectedColor },
                        ]}
                        onPress={() => setSelectedIcon(icon)}
                      >
                        <FontAwesome6
                          name={icon as any}
                          size={18}
                          color={selectedIcon === icon ? selectedColor : '#636E72'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Color Selection */}
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>颜色</Text>
                  <View style={styles.colorGrid}>
                    {COLOR_OPTIONS.map((color) => (
                      <TouchableOpacity
                        key={color}
                        style={[
                          styles.colorOption,
                          { backgroundColor: color },
                          selectedColor === color && styles.colorSelected,
                        ]}
                        onPress={() => setSelectedColor(color)}
                      />
                    ))}
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.cancelBtnText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                    <Text style={styles.saveBtnText}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2D3436',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6C63FF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  list: {
    paddingBottom: 120,
  },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F3',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#D1D9E6',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryInfo: {
    flex: 1,
    marginLeft: 14,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
  },
  categoryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#F0F0F3',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2D3436',
  },
  modalField: {
    marginBottom: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 8,
  },
  modalInputContainer: {
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 14 : 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  modalInput: {
    fontSize: 15,
    color: '#2D3436',
    padding: 0,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E8E8EB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: '#2D3436',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#E8E8EB',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#636E72',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 9999,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
});
