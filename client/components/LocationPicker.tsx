import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import { authFetch } from '@/utils/api';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

export interface LocationNode {
  id: number;
  type: 'room' | 'furniture' | 'layer';
  name: string;
  template: string | null;
  item_count: number;
  total_count: number;
  children: LocationNode[];
}

export interface LocationSelection {
  location_id: number;
  path: string;
}

interface LocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (sel: LocationSelection) => void;
}

// 节点图标：房间 / 家具（按模板）/ 隔层
function nodeIcon(node: LocationNode): string {
  if (node.type === 'room') return 'door-open';
  if (node.type === 'layer') return 'grip-lines';
  const map: Record<string, string> = {
    wardrobe: 'door-closed',
    drawer_chest: 'box-archive',
    bookshelf: 'book',
    shelf: 'layer-group',
    cabinet: 'boxes-stacked',
    desk: 'laptop',
    bedside: 'bed',
    fridge: 'snowflake',
    shoe_rack: 'shoe-prints',
    box: 'box-open',
  };
  return (node.template && map[node.template]) || 'box';
}

/**
 * 空间位置级联选择器（底部 sheet，三步：房间 → 家具 → 隔层）
 * 支持中途确定（"就放到家具，不细分隔层"）
 */
export function LocationPicker({ visible, onClose, onSelect }: LocationPickerProps) {
  const [tree, setTree] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [stack, setStack] = useState<LocationNode[]>([]);

  useEffect(() => {
    if (!visible) return;
    setStack([]);
    const load = async () => {
      setLoading(true);
      try {
        /**
         * 服务端文件：server/src/routes/locations.ts
         * 接口：GET /api/v1/locations/tree
         * 无参数
         */
        const res = await authFetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/locations/tree`);
        if (res.ok) setTree(await res.json());
      } catch {
        // 静默失败，展示空态
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [visible]);

  const currentList = stack.length === 0 ? tree : stack[stack.length - 1].children;
  const currentPath = stack.map((n) => n.name).join(' / ');
  const topNode = stack[stack.length - 1];

  const handlePick = (node: LocationNode) => {
    if (node.children.length > 0) {
      setStack([...stack, node]);
    } else {
      const path = currentPath ? `${currentPath} / ${node.name}` : node.name;
      onSelect({ location_id: node.id, path });
      onClose();
    }
  };

  const confirmCurrent = () => {
    if (!topNode) return;
    onSelect({ location_id: topNode.id, path: currentPath });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>选择空间位置</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <FontAwesome6 name="xmark" size={18} color="#636E72" />
            </TouchableOpacity>
          </View>

          {/* 面包屑（可点击回退） */}
          {stack.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.crumbScroll}>
              <TouchableOpacity onPress={() => setStack([])}>
                <Text style={styles.crumbLink}>全部房间</Text>
              </TouchableOpacity>
              {stack.map((node, idx) => (
                <View key={node.id} style={styles.crumbItem}>
                  <Text style={styles.crumbSep}> / </Text>
                  <TouchableOpacity onPress={() => setStack(stack.slice(0, idx + 1))}>
                    <Text style={idx === stack.length - 1 ? styles.crumbCurrent : styles.crumbLink}>
                      {node.name}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#6C63FF" />
            </View>
          ) : currentList.length === 0 ? (
            <View style={styles.emptyBox}>
              <FontAwesome6 name="box-open" size={32} color="#C0C0C8" />
              <Text style={styles.emptyText}>
                {stack.length === 0 ? '还没有空间\n先到「空间」标签页创建房间和家具吧' : '这里还没有子层级'}
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {currentList.map((node) => (
                <TouchableOpacity
                  key={node.id}
                  style={styles.row}
                  onPress={() => handlePick(node)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowIcon}>
                    <FontAwesome6 name={nodeIcon(node) as never} size={15} color="#6C63FF" />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{node.name}</Text>
                    <Text style={styles.rowSub}>
                      {node.children.length > 0
                        ? `${node.children.length} 个${node.type === 'room' ? '家具' : '隔层'} · ${node.total_count} 件物品`
                        : `${node.item_count} 件物品`}
                    </Text>
                  </View>
                  <FontAwesome6
                    name={node.children.length > 0 ? 'chevron-right' : 'check'}
                    size={13}
                    color={node.children.length > 0 ? '#C0C0C8' : '#6C63FF'}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* 中途确定：就选当前层级（房间/家具） */}
          {topNode && (
            <TouchableOpacity style={styles.confirmBtn} onPress={confirmCurrent} activeOpacity={0.85}>
              <Text style={styles.confirmText}>就放在「{topNode.name}」</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E6',
    alignSelf: 'center',
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2D3436',
  },
  crumbScroll: {
    flexGrow: 0,
    marginBottom: 10,
  },
  crumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crumbSep: {
    color: '#C0C0C8',
    fontSize: 13,
  },
  crumbLink: {
    fontSize: 13,
    color: '#6C63FF',
    fontWeight: '500',
  },
  crumbCurrent: {
    fontSize: 13,
    color: '#2D3436',
    fontWeight: '600',
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9EA0A5',
    textAlign: 'center',
    lineHeight: 21,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F4',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D3436',
  },
  rowSub: {
    fontSize: 12,
    color: '#9EA0A5',
    marginTop: 2,
  },
  confirmBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
