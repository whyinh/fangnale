// 空间树工具：家具模板 + 树/路径构建
// 数据结构：room（房间）→ furniture（家具）→ layer（隔层），items.location_id 挂到任一节点

export interface FurnitureTemplate {
  key: string;
  name: string;
  icon: string; // FontAwesome6 图标名
  layers: string[]; // 创建家具时自动生成的隔层
}

// 预置家具模板：覆盖家庭高频储物家具
export const FURNITURE_TEMPLATES: FurnitureTemplate[] = [
  { key: "wardrobe", name: "衣柜", icon: "door-closed", layers: ["挂衣区", "顶层搁板", "上抽屉", "下抽屉"] },
  { key: "drawer_chest", name: "抽屉柜", icon: "box-archive", layers: ["第一格", "第二格", "第三格", "第四格"] },
  { key: "bookshelf", name: "书架", icon: "book", layers: ["第一层", "第二层", "第三层"] },
  { key: "shelf", name: "置物架", icon: "layer-group", layers: ["顶层", "中层", "底层"] },
  { key: "cabinet", name: "储物柜", icon: "boxes-stacked", layers: ["上层", "下层"] },
  { key: "desk", name: "书桌", icon: "laptop", layers: ["桌面上", "抽屉里"] },
  { key: "bedside", name: "床头柜", icon: "bed", layers: ["台面上", "抽屉里"] },
  { key: "fridge", name: "冰箱", icon: "snowflake", layers: ["冷藏室", "门架", "冷冻室"] },
  { key: "shoe_rack", name: "鞋柜", icon: "shoe-prints", layers: ["上层", "中层", "下层"] },
  { key: "box", name: "收纳箱", icon: "box-open", layers: ["箱内"] },
];

export interface LocationRow {
  id: number;
  owner_id: string;
  parent_id: number | null;
  type: "room" | "furniture" | "layer";
  name: string;
  template: string | null;
  grid_pos: number | null;
  sort: number;
}

export interface LocationNode extends LocationRow {
  item_count: number; // 直接挂在该节点的物品数
  total_count: number; // 含所有子孙节点的物品数
  children: LocationNode[];
}

export function getTemplateIcon(templateKey: string | null): string {
  if (!templateKey) return "box";
  return FURNITURE_TEMPLATES.find((t) => t.key === templateKey)?.icon || "box";
}

// id → 完整路径（如 "主卧 / 衣柜 / 顶层搁板"）
export function buildPathMap(rows: LocationRow[]): Map<number, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cache = new Map<number, string>();
  const pathOf = (id: number, depth = 0): string => {
    if (cache.has(id)) return cache.get(id)!;
    const node = byId.get(id);
    if (!node || depth > 8) return "";
    const parentPath = node.parent_id ? pathOf(node.parent_id, depth + 1) : "";
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    cache.set(id, path);
    return path;
  };
  for (const r of rows) pathOf(r.id);
  return cache;
}

// 构建嵌套树，并统计每个节点的物品数
export function buildLocationTree(rows: LocationRow[], directCounts: Map<number, number>): LocationNode[] {
  const nodeMap = new Map<number, LocationNode>();
  for (const r of rows) {
    nodeMap.set(r.id, {
      ...r,
      item_count: directCounts.get(r.id) || 0,
      total_count: 0,
      children: [],
    });
  }
  const roots: LocationNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_id && nodeMap.has(node.parent_id)) {
      nodeMap.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // 自底向上累计 total_count
  const accumulate = (node: LocationNode): number => {
    let total = node.item_count;
    for (const child of node.children) total += accumulate(child);
    node.total_count = total;
    return total;
  };
  for (const root of roots) accumulate(root);
  // 隔层按 grid_pos 排序，其余按 id 排序
  const sortChildren = (node: LocationNode) => {
    node.children.sort((a, b) => {
      if (a.type === "layer" && b.type === "layer") {
        return (a.grid_pos ?? 0) - (b.grid_pos ?? 0);
      }
      return a.id - b.id;
    });
    node.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);
  return roots;
}

// 收集某节点及其全部子孙的 id（BFS，防环深度限制）
export function collectNodeIds(rootId: number, rows: Pick<LocationRow, "id" | "parent_id">[]): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parent_id) {
      const arr = childrenOf.get(r.parent_id) || [];
      arr.push(r.id);
      childrenOf.set(r.parent_id, arr);
    }
  }
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length > 0 && result.length < 500) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...(childrenOf.get(id) || []));
  }
  return result;
}
