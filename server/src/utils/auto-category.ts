import { getSupabaseClient } from "../storage/database/supabase-client.js";

export interface CategoryBrief {
  id: number;
  name: string;
}

interface CategoryStyle {
  icon: string;
  color: string;
}

/** 新用户默认分类（首次进入自动初始化，覆盖家庭收纳常见大类） */
export const DEFAULT_CATEGORIES: Array<{ name: string } & CategoryStyle> = [
  { name: "证件文件", icon: "id-card", color: "#4A90D9" },
  { name: "电子产品", icon: "plug", color: "#6C63FF" },
  { name: "衣物服饰", icon: "shirt", color: "#E91E63" },
  { name: "厨房用品", icon: "utensils", color: "#FF9800" },
  { name: "药品健康", icon: "pills", color: "#4CAF50" },
  { name: "食品饮料", icon: "apple-whole", color: "#F44336" },
  { name: "工具五金", icon: "toolbox", color: "#795548" },
  { name: "书籍文具", icon: "book", color: "#3F51B5" },
  { name: "洗护日用", icon: "pump-soap", color: "#00BCD4" },
  { name: "其他", icon: "boxes", color: "#9E9E9E" },
];

/** 分类名关键词 → 图标/配色（AI 建议的新分类按此自动配样式，匹配不到用默认 tag） */
const CATEGORY_STYLE_MAP: Array<{ keywords: string[] } & CategoryStyle> = [
  { keywords: ["证件", "文件", "档案", "票据", "卡片"], icon: "id-card", color: "#4A90D9" },
  { keywords: ["电子", "数码", "电器", "家电", "充电"], icon: "plug", color: "#6C63FF" },
  { keywords: ["衣", "服", "鞋", "帽", "服饰", "配饰", "包"], icon: "shirt", color: "#E91E63" },
  { keywords: ["厨房", "餐具", "厨具", "锅"], icon: "utensils", color: "#FF9800" },
  { keywords: ["药", "健康", "医疗", "保健"], icon: "pills", color: "#4CAF50" },
  { keywords: ["食品", "饮料", "零食", "食材", "吃"], icon: "apple-whole", color: "#F44336" },
  { keywords: ["工具", "五金", "维修"], icon: "toolbox", color: "#795548" },
  { keywords: ["书", "文具", "学习", "办公"], icon: "book", color: "#3F51B5" },
  { keywords: ["洗护", "日用", "清洁", "洗漱"], icon: "pump-soap", color: "#00BCD4" },
  { keywords: ["儿童", "玩具", "母婴", "婴儿"], icon: "baby", color: "#FF7043" },
  { keywords: ["宠物"], icon: "paw", color: "#8BC34A" },
  { keywords: ["运动", "户外", "健身"], icon: "football", color: "#009688" },
  { keywords: ["美妆", "护肤", "化妆"], icon: "spray-can-sparkles", color: "#AB47BC" },
  { keywords: ["收纳"], icon: "box-open", color: "#8D6E63" },
];

function styleFor(name: string): CategoryStyle {
  for (const entry of CATEGORY_STYLE_MAP) {
    if (entry.keywords.some((k) => name.includes(k) || k.includes(name))) {
      return { icon: entry.icon, color: entry.color };
    }
  }
  return { icon: "tag", color: "#6C63FF" };
}

/** 用户无任何分类时，自动初始化默认分类（幂等：只在 0 分类时写入） */
export async function ensureDefaultCategories(ownerId: string): Promise<void> {
  const client = getSupabaseClient();
  const { count, error } = await client
    .from("categories")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId);
  if (error) {
    console.error("count categories error:", error);
    return;
  }
  if ((count ?? 0) > 0) return;

  const rows = DEFAULT_CATEGORIES.map((c) => ({ ...c, owner_id: ownerId }));
  const { error: insertError } = await client.from("categories").insert(rows);
  if (insertError) console.error("init default categories error:", insertError);
}

export interface ResolvedCategory {
  id: number;
  name: string;
  /** 是否为本次自动创建的分类 */
  created: boolean;
}

/**
 * 按名字解析分类：精确匹配 → 模糊（互相包含）匹配 → 自动创建新分类。
 * AI 识别/语音录入共用，保证物品始终有归属分类，用户无需手动建类。
 */
export async function resolveCategoryId(
  ownerId: string,
  cats: CategoryBrief[],
  suggestedName: string
): Promise<ResolvedCategory> {
  const name = suggestedName.trim().slice(0, 10);

  if (name) {
    const exact = cats.find((c) => c.name === name);
    if (exact) return { id: exact.id, name: exact.name, created: false };

    const fuzzy = cats.find((c) => name.includes(c.name) || c.name.includes(name));
    if (fuzzy) return { id: fuzzy.id, name: fuzzy.name, created: false };
  }

  // 无匹配（或 AI 未给出名字）→ 自动创建；空名字统一归到「其他」
  const finalName = name || "其他";

  // 并发/重复保护：创建前再查一次同名（含刚被其他请求创建的情况）
  const client = getSupabaseClient();
  const { data: dup } = await client
    .from("categories")
    .select("id, name")
    .eq("owner_id", ownerId)
    .eq("name", finalName)
    .limit(1)
    .maybeSingle();
  if (dup) return { id: dup.id as number, name: dup.name as string, created: false };

  const style = styleFor(finalName);
  const { data: inserted, error } = await client
    .from("categories")
    .insert({ name: finalName, icon: style.icon, color: style.color, owner_id: ownerId })
    .select("id, name")
    .single();

  if (error || !inserted) {
    // 创建失败兜底：返回现有第一个分类，实在没有则抛错由调用方降级
    console.error("auto create category error:", error);
    if (cats.length > 0) return { id: cats[0].id, name: cats[0].name, created: false };
    throw new Error(`自动创建分类失败: ${error?.message || "unknown"}`);
  }
  return { id: inserted.id as number, name: inserted.name as string, created: true };
}
