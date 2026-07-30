import { Router } from "express";
import multer from "multer";
import { S3Storage, LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth, getVisibleOwnerIds, getFamilyMemberMap } from "../middleware/auth.js";
import {
  isPremium,
  getItemCount,
  getAskCountToday,
  logAskUsage,
  FREE_ITEM_LIMIT,
  FREE_ASK_DAILY_LIMIT,
} from "../utils/premium.js";
import { resolveCategoryId, type CategoryBrief } from "../utils/auto-category.js";
import { buildPathMap, type LocationRow } from "../utils/location-tree.js";

const router = Router();
const client = getSupabaseClient();

// 所有物品接口均需登录
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: "",
  secretKey: "",
  bucketName: process.env.COZE_BUCKET_NAME,
  region: "cn-beijing",
});

// 从 LLM 输出中提取 JSON 对象（容忍 markdown 代码块包裹）
function extractJson(text: string): Record<string, unknown> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("LLM 输出中未找到 JSON");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

// 为物品列表补充空间位置路径（location_id → "主卧 / 衣柜 / 顶层"）
async function attachLocationPaths<T extends { location_id?: number | null }>(
  userId: string,
  items: T[]
): Promise<(T & { location_path: string | null })[]> {
  if (!items.some((it) => it.location_id)) {
    return items.map((it) => ({ ...it, location_path: null }));
  }
  const visibleIds = await getVisibleOwnerIds(userId);
  const { data: rows } = await client
    .from("locations")
    .select("id, owner_id, parent_id, type, name, template, grid_pos, sort")
    .in("owner_id", visibleIds);
  const pathMap = buildPathMap((rows || []) as LocationRow[]);
  return items.map((it) => ({
    ...it,
    location_path: it.location_id ? pathMap.get(it.location_id) || null : null,
  }));
}

// GET /api/v1/items - 获取物品列表
// Query: { category_id?: number, search?: string }
router.get("/", async (req, res) => {
  const { category_id, search } = req.query;
  const visibleIds = await getVisibleOwnerIds(req.userId!);

  let query = client
    .from("items")
    .select("id, name, category_id, location, location_id, tags, photo_key, note, owner_id, created_at, updated_at, borrowed_to, borrowed_at, expiry_date, categories(id, name, icon, color)")
    .in("owner_id", visibleIds)
    .order("created_at", { ascending: false });

  if (category_id) {
    query = query.eq("category_id", Number(category_id));
  }

  if (search && typeof search === "string") {
    query = query.or(
      `name.ilike.%${search}%,location.ilike.%${search}%,tags.ilike.%${search}%`
    );
  }

  const { data, error } = await query.limit(100);
  if (error) throw new Error(`查询物品失败: ${error.message}`);
  // 家庭场景：补充归属人信息，前端展示"谁记的"（昵称优先，回退邮箱/手机号）
  const memberMap = await getFamilyMemberMap(req.userId!);
  const withOwners = (data || []).map((item) => {
    const brief = memberMap[(item as { owner_id?: string }).owner_id || ""];
    return {
      ...item,
      owner_email: brief?.email || null,
      owner_name: brief?.name || null,
    };
  });
  const items = await attachLocationPaths(req.userId!, withOwners);
  res.json(items);
});

// GET /api/v1/items/locations - 获取常用位置列表（按使用频次排序）
// 静态路由必须定义在 /:id 动态路由之前
router.get("/locations", async (req, res) => {
  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { data, error } = await client
    .from("items")
    .select("location")
    .in("owner_id", visibleIds)
    .neq("location", "");
  if (error) throw new Error(`查询位置失败: ${error.message}`);

  // 统计各位置使用频次
  const freq: Record<string, number> = {};
  for (const row of data || []) {
    const loc = (row.location || "").trim();
    if (loc) freq[loc] = (freq[loc] || 0) + 1;
  }

  const locations = Object.entries(freq)
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  res.json(locations);
});

// GET /api/v1/items/:id - 获取单个物品详情
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { data, error } = await client
    .from("items")
    .select("id, name, category_id, location, location_id, tags, photo_key, note, created_at, updated_at, borrowed_to, borrowed_at, expiry_date, categories(id, name, icon, color)")
    .eq("id", id)
    .in("owner_id", visibleIds)
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      res.status(404).json({ error: "物品不存在" });
      return;
    }
    throw new Error(`查询物品失败: ${error.message}`);
  }
  if (!data) {
    res.status(404).json({ error: "物品不存在" });
    return;
  }
  const [itemWithPath] = await attachLocationPaths(req.userId!, [data]);
  res.json(itemWithPath);
});

// POST /api/v1/items/organize/analyze - AI 整理分析（全量扫描，返回整理建议）
// 响应: { merge_categories, recategorize, duplicates, stale, stats }
router.post("/organize/analyze", async (req, res) => {
  try {
    const visibleIds = await getVisibleOwnerIds(req.userId!);
    const { data: cats } = await client
      .from("categories")
      .select("id, name")
      .in("owner_id", visibleIds)
      .order("id");
    // 上限 500 件防止超 LLM 上下文
    const { data: items } = await client
      .from("items")
      .select("id, name, category_id, location, created_at")
      .in("owner_id", visibleIds)
      .order("id", { ascending: false })
      .limit(500);

    if (!items || items.length === 0) {
      res.json({
        merge_categories: [], recategorize: [], duplicates: [], stale: [],
        stats: { items: 0, categories: (cats || []).length },
      });
      return;
    }

    const catName = new Map<number, string>((cats || []).map((c) => [c.id as number, c.name as string]));
    const now = Date.now();
    const itemLines = items.map((it) => {
      const days = Math.floor((now - new Date(it.created_at as string).getTime()) / 86400000);
      return `${it.id}|${it.name}|${catName.get(it.category_id as number) || "未知"}|${it.location || "无位置"}|记录${days}天`;
    });

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const llm = new LLMClient(new Config(), customHeaders);
    const response = await llm.invoke(
      [
        {
          role: "system",
          content: `你是家庭物品整理顾问。分析用户的物品清单，给出结构化整理建议。
清单格式（每行）：物品ID|名称|分类|位置|记录天数
现有分类：${(cats || []).map((c) => `${c.id}:${c.name}`).join("，")}
物品清单：
${itemLines.join("\n")}

分析并只输出 JSON：
{
  "merge_categories": [{"from_id": 分类ID, "from_name": "", "to_id": 分类ID, "to_name": "", "reason": "一句话原因"}],
  "recategorize": [{"item_id": 物品ID, "item_name": "", "to_category_id": 分类ID, "to_category": "", "reason": "一句话原因"}],
  "duplicates": [{"item_ids": [物品ID数组], "name": "物品名", "reason": "一句话原因"}],
  "stale": [{"item_id": 物品ID, "item_name": "", "reason": "一句话原因"}]
}
规则：
- merge_categories：仅当两个分类语义明显重叠（如"数码配件"与"电子产品"），小类并入大类；没有就给空数组
- recategorize：物品明显放错分类时给出，仅限高置信度，最多 20 条；to_category_id 必须是现有分类ID
- duplicates：同名且位置相同/相近的疑似重复记录；没有就给空数组
- stale：记录超过 180 天且通常属于低价值/易淘汰的物品（如旧数据线、过时票据、闲置小配件），最多 10 条
- 所有 ID 必须来自上方清单，禁止编造；建议要克制，宁缺毋滥
- 只输出 JSON，禁止任何其他文字`,
        },
        { role: "user", content: `共 ${items.length} 件物品、${(cats || []).length} 个分类，请给出整理建议。` },
      ],
      { model: "doubao-seed-1-8-251228", temperature: 0.2 }
    );

    // 解析 + 严格清洗（防 LLM 幻觉 ID）
    const catIds = new Set((cats || []).map((c) => c.id as number));
    const itemMap = new Map<number, { name: string; category_id: number }>(
      items.map((it) => [it.id as number, { name: it.name as string, category_id: it.category_id as number }])
    );
    let mergeOut: unknown[] = [];
    let recatOut: unknown[] = [];
    let dupOut: unknown[] = [];
    let staleOut: unknown[] = [];
    try {
      const parsed = extractJson(String(response.content || ""));
      if (Array.isArray(parsed.merge_categories)) {
        mergeOut = parsed.merge_categories
          .filter((m) => {
            const mm = m as Record<string, unknown>;
            return catIds.has(Number(mm.from_id)) && catIds.has(Number(mm.to_id)) && Number(mm.from_id) !== Number(mm.to_id);
          })
          .slice(0, 10);
      }
      if (Array.isArray(parsed.recategorize)) {
        recatOut = parsed.recategorize
          .filter((r) => {
            const rr = r as Record<string, unknown>;
            const item = itemMap.get(Number(rr.item_id));
            return item && catIds.has(Number(rr.to_category_id)) && item.category_id !== Number(rr.to_category_id);
          })
          .slice(0, 20);
      }
      if (Array.isArray(parsed.duplicates)) {
        dupOut = parsed.duplicates
          .map((d) => d as Record<string, unknown>)
          .filter((d) => Array.isArray(d.item_ids) && (d.item_ids as unknown[]).length >= 2)
          .map((d) => ({
            ...d,
            item_ids: (d.item_ids as unknown[]).map(Number).filter((id) => itemMap.has(id)),
          }))
          .filter((d) => (d.item_ids as number[]).length >= 2)
          .slice(0, 10);
      }
      if (Array.isArray(parsed.stale)) {
        staleOut = parsed.stale
          .filter((s) => itemMap.has(Number((s as Record<string, unknown>).item_id)))
          .slice(0, 10);
      }
    } catch (parseError) {
      console.error("整理建议解析失败:", parseError);
    }

    res.json({
      merge_categories: mergeOut,
      recategorize: recatOut,
      duplicates: dupOut,
      stale: staleOut,
      stats: { items: items.length, categories: (cats || []).length },
    });
  } catch (error) {
    console.error("整理分析失败:", error);
    res.status(500).json({ error: "整理分析失败，请稍后重试" });
  }
});

// POST /api/v1/items/organize/apply - 执行整理动作
// Body: { actions: Array<{ type: "merge_category", from_id: number, to_id: number } | { type: "recategorize", item_id: number, to_category_id: number } | { type: "delete_items", item_ids: number[] }> }
router.post("/organize/apply", async (req, res) => {
  const { actions } = req.body as { actions?: Array<Record<string, unknown>> };
  if (!Array.isArray(actions) || actions.length === 0) {
    res.status(400).json({ error: "请选择要执行的整理动作" });
    return;
  }
  if (actions.length > 200) {
    res.status(400).json({ error: "一次最多执行 200 条整理动作" });
    return;
  }

  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const results = { merged: 0, recategorized: 0, deleted: 0, failed: 0 };

  // 预取可见分类用于校验
  const { data: cats } = await client.from("categories").select("id").in("owner_id", visibleIds);
  const catIds = new Set((cats || []).map((c) => c.id as number));

  for (const action of actions) {
    try {
      if (action.type === "merge_category") {
        const fromId = Number(action.from_id);
        const toId = Number(action.to_id);
        if (!catIds.has(fromId) || !catIds.has(toId) || fromId === toId) { results.failed++; continue; }
        const { error: moveErr } = await client
          .from("items")
          .update({ category_id: toId })
          .eq("category_id", fromId)
          .in("owner_id", visibleIds);
        if (moveErr) throw moveErr;
        const { error: delErr } = await client
          .from("categories")
          .delete()
          .eq("id", fromId)
          .in("owner_id", visibleIds);
        if (delErr) throw delErr;
        results.merged++;
      } else if (action.type === "recategorize") {
        const itemId = Number(action.item_id);
        const toCatId = Number(action.to_category_id);
        if (!catIds.has(toCatId)) { results.failed++; continue; }
        const { error } = await client
          .from("items")
          .update({ category_id: toCatId })
          .eq("id", itemId)
          .in("owner_id", visibleIds);
        if (error) throw error;
        results.recategorized++;
      } else if (action.type === "delete_items") {
        const ids = (Array.isArray(action.item_ids) ? action.item_ids : []).map(Number).filter((v) => Number.isFinite(v));
        if (ids.length === 0) { results.failed++; continue; }
        const { error } = await client
          .from("items")
          .delete()
          .in("id", ids)
          .in("owner_id", visibleIds);
        if (error) throw error;
        results.deleted += ids.length;
      } else {
        results.failed++;
      }
    } catch (actionError) {
      console.error("整理动作执行失败:", action.type, actionError);
      results.failed++;
    }
  }

  res.json({ ok: true, results });
});

// POST /api/v1/items/batch - 批量操作
// Body: { action: "recategorize" | "move" | "delete", item_ids: number[], category_id?: number, location?: string }
router.post("/batch", async (req, res) => {
  const { action, item_ids, category_id, location } = req.body as {
    action?: string;
    item_ids?: unknown[];
    category_id?: number;
    location?: string;
  };
  const ids = (Array.isArray(item_ids) ? item_ids : []).map(Number).filter((v) => Number.isFinite(v));
  if (ids.length === 0) {
    res.status(400).json({ error: "请选择要操作的物品" });
    return;
  }
  if (ids.length > 200) {
    res.status(400).json({ error: "一次最多操作 200 件物品" });
    return;
  }

  const visibleIds = await getVisibleOwnerIds(req.userId!);

  if (action === "recategorize") {
    const toCatId = Number(category_id);
    const { data: cat } = await client
      .from("categories")
      .select("id")
      .eq("id", toCatId)
      .in("owner_id", visibleIds)
      .maybeSingle();
    if (!cat) {
      res.status(400).json({ error: "目标分类不存在" });
      return;
    }
    const { error } = await client.from("items").update({ category_id: toCatId }).in("id", ids).in("owner_id", visibleIds);
    if (error) {
      res.status(500).json({ error: "批量改分类失败" });
      return;
    }
    res.json({ ok: true, affected: ids.length });
    return;
  }

  if (action === "move") {
    if (typeof location !== "string" || !location.trim()) {
      res.status(400).json({ error: "请输入目标位置" });
      return;
    }
    const { error } = await client
      .from("items")
      .update({ location: location.trim().slice(0, 50) })
      .in("id", ids)
      .in("owner_id", visibleIds);
    if (error) {
      res.status(500).json({ error: "批量移动失败" });
      return;
    }
    res.json({ ok: true, affected: ids.length });
    return;
  }

  if (action === "delete") {
    const { error } = await client.from("items").delete().in("id", ids).in("owner_id", visibleIds);
    if (error) {
      res.status(500).json({ error: "批量删除失败" });
      return;
    }
    res.json({ ok: true, affected: ids.length });
    return;
  }

  res.status(400).json({ error: "不支持的操作类型" });
});

// POST /api/v1/items/recognize - AI 识别物品照片
// FormData: photo (image)
// 一次完成：照片上传 S3 + 多模态 LLM 识别，返回 { photo_key, name, tags, category_id }
// 静态路由定义在 POST / 之前，且识别失败时降级返回默认字段（photo_key 始终有效）
router.post("/recognize", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请上传物品照片" });
      return;
    }

    // 1. 照片上传 S3（识别与物品记录共用同一张图，前端保存时直接复用 photo_key）
    const { buffer, originalname, mimetype } = req.file;
    const ext = originalname.split(".").pop() || "jpg";
    const fileName = `items/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const photoKey = await storage.uploadFile({
      fileContent: buffer,
      fileName,
      contentType: mimetype,
    });

    // 2. 查询现有分类（仅自己+家庭成员的，让 LLM 从中选择，保证分类匹配用户自己的分类体系）
    const visibleIds = await getVisibleOwnerIds(req.userId!);
    const { data: catsRaw } = await client
      .from("categories")
      .select("id, name")
      .in("owner_id", visibleIds)
      .order("id");
    const cats: CategoryBrief[] = (catsRaw || []) as CategoryBrief[];
    const categoryNames = cats.map((c) => c.name);

    // 3. 调用多模态 LLM 识别（失败降级：photo_key 已上传，识别字段用默认值，分类兜底「其他」）
    let name = "未命名物品";
    let tags: string[] = [];
    let categoryId: number | null = null;
    let categoryName = "";
    let categoryCreated = false;

    try {
      const customHeaders = HeaderUtils.extractForwardHeaders(
        req.headers as unknown as Record<string, string>
      );
      const llm = new LLMClient(new Config(), customHeaders);
      const dataUri = `data:${mimetype || "image/jpeg"};base64,${buffer.toString("base64")}`;

      const prompt = [
        "你是一个物品识别助手，用户拍了一张物品照片，想快速记录「这个物品存放在哪里」。",
        "请识别照片中的主体物品，只返回一个 JSON 对象，不要输出任何其他文字：",
        '{"name": "物品名称", "tags": ["标签1", "标签2"], "category": "分类名"}',
        "要求：",
        '- name：物品本身的名称，简洁具体，2-8 个字（如"瑞士军刀""护照""电钻"），不要包含位置描述',
        "- tags：2-4 个描述物品特征或用途的标签，每个 2-6 个字",
        `- category：优先从以下现有分类中原样选择一个：${categoryNames.join("、") || "（暂无分类）"}；如果都不合适，可以给一个简洁的新大类名（2-4个字，如"电子产品""衣物""证件"），系统会自动创建该分类`,
        '- 如果照片模糊或无法辨认物品，name 返回"未识别物品"，tags 返回空数组，category 返回"其他"',
      ].join("\n");

      const response = await llm.invoke(
        [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUri, detail: "low" } },
            ],
          },
        ],
        { model: "doubao-seed-1-8-251228", temperature: 0.3 }
      );

      const parsed = extractJson(response.content);

      if (typeof parsed.name === "string" && parsed.name.trim()) {
        name = parsed.name.trim().slice(0, 30);
      }
      if (Array.isArray(parsed.tags)) {
        tags = parsed.tags
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .slice(0, 4)
          .map((t) => t.trim().slice(0, 10));
      }
      // 精确/模糊匹配现有分类；匹配不上则按 AI 建议自动创建新分类
      const resolved = await resolveCategoryId(
        req.userId!,
        cats,
        typeof parsed.category === "string" ? parsed.category : ""
      );
      categoryId = resolved.id;
      categoryName = resolved.name;
      categoryCreated = resolved.created;
    } catch (llmError) {
      console.error("LLM 识别失败，使用降级结果:", llmError);
    }

    // LLM 失败或未给出分类时的最终兜底：归到「其他」（不存在则自动创建）
    if (categoryId === null) {
      try {
        const fallback = await resolveCategoryId(req.userId!, cats, "其他");
        categoryId = fallback.id;
        categoryName = fallback.name;
      } catch (fallbackError) {
        console.error("兜底分类创建失败:", fallbackError);
      }
    }

    res.json({
      photo_key: photoKey,
      name,
      tags,
      category_id: categoryId,
      category_name: categoryName,
      category_created: categoryCreated,
    });
  } catch (error) {
    console.error("POST /items/recognize error:", error);
    res.status(500).json({ error: "识别失败，请重试" });
  }
});

// POST /api/v1/items/recognize-multi - AI 一拍多录：识别照片中的多个物品
// FormData: photo (image)
// 返回 { photo_key, items: [{ name, category_id, category_name }] }；识别失败降级 items 为空数组
router.post("/recognize-multi", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "请上传照片" });
      return;
    }

    // 1. 照片上传 S3（多件物品共用同一张全景照）
    const { buffer, originalname, mimetype } = req.file;
    const ext = originalname.split(".").pop() || "jpg";
    const fileName = `items/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const photoKey = await storage.uploadFile({
      fileContent: buffer,
      fileName,
      contentType: mimetype,
    });

    const visibleIds = await getVisibleOwnerIds(req.userId!);
    const { data: catsRaw } = await client
      .from("categories")
      .select("id, name")
      .in("owner_id", visibleIds)
      .order("id");
    const cats: CategoryBrief[] = (catsRaw || []) as CategoryBrief[];

    interface MultiItem {
      name: string;
      category_id: number | null;
      category_name: string;
    }
    let multiItems: MultiItem[] = [];

    try {
      const customHeaders = HeaderUtils.extractForwardHeaders(
        req.headers as unknown as Record<string, string>
      );
      const llm = new LLMClient(new Config(), customHeaders);
      const dataUri = `data:${mimetype || "image/jpeg"};base64,${buffer.toString("base64")}`;

      const prompt = [
        "你是一个物品识别助手。用户拍了一张区域照片（如打开的抽屉、柜子隔层、桌面），想批量记录里面的物品。",
        "请识别照片中所有清晰可见、值得记录的独立物品，只返回一个 JSON 对象，不要输出任何其他文字：",
        '{"items": [{"name": "物品名称", "category": "分类名"}, ...]}',
        "要求：",
        "- 只数能明确辨认的独立物品，忽略包装袋、纸张、杂物碎屑等无记录价值的东西",
        "- 物品数量上限 12 件；如果画面太乱只能看清几件，就返回几件，不要硬凑",
        '- name：简洁具体，2-8 个字（如"充电线""护照""口红"），不要包含位置描述',
        `- category：优先从以下现有分类中原样选择一个：${cats.map((c) => c.name).join("、") || "（暂无分类）"}；都不合适可给简洁的新大类名（2-4个字），系统会自动创建`,
        '- 如果完全无法辨认任何物品，items 返回空数组',
      ].join("\n");

      const response = await llm.invoke(
        [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUri, detail: "high" } },
            ],
          },
        ],
        { model: "doubao-seed-1-8-251228", temperature: 0.3 }
      );

      const parsed = extractJson(response.content);
      if (Array.isArray(parsed.items)) {
        // 逐件解析分类（同名去重 + 自动建类），限制 12 件
        const seen = new Set<string>();
        for (const raw of parsed.items.slice(0, 12)) {
          if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
          const itemName = raw.name.trim().slice(0, 30);
          if (seen.has(itemName)) continue;
          seen.add(itemName);
          try {
            const resolved = await resolveCategoryId(
              req.userId!,
              cats,
              typeof raw.category === "string" ? raw.category : ""
            );
            multiItems.push({ name: itemName, category_id: resolved.id, category_name: resolved.name });
          } catch {
            multiItems.push({ name: itemName, category_id: null, category_name: "" });
          }
        }
      }
    } catch (llmError) {
      console.error("多物品识别失败，降级为空清单:", llmError);
    }

    res.json({ photo_key: photoKey, items: multiItems });
  } catch (error) {
    console.error("POST /items/recognize-multi error:", error);
    res.status(500).json({ error: "识别失败，请重试" });
  }
});

// POST /api/v1/items/ask - AI 自然语言查找（SSE 流式输出）
// Body: { question: string }
router.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "请提供问题" });
    return;
  }

  // 会员门控：免费用户每日限问 FREE_ASK_DAILY_LIMIT 次；会员不限
  // 注意：SSE 场景下 403 JSON 无法被 react-native-sse 读取 body（只会触发 error 事件），
  // 因此建立 SSE 连接后以错误事件下发，前端统一在 message 处理中展示文案
  const premiumForAsk = await isPremium(req.userId!);
  const askLimited = !premiumForAsk && (await getAskCountToday(req.userId!)) >= FREE_ASK_DAILY_LIMIT;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (askLimited) {
    res.write(
      `data: ${JSON.stringify({
        error: `免费版每天可问 AI ${FREE_ASK_DAILY_LIMIT} 次，升级会员无限提问`,
        code: "ASK_LIMIT",
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  if (!premiumForAsk) {
    await logAskUsage(req.userId!);
  }

  try {
    const { data: rows, error } = await client
      .from("items")
      .select("id, name, location, tags, note, borrowed_to, expiry_date, created_at, categories(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`查询物品失败: ${error.message}`);

    const inventory = (rows || []).map((r) => {
      const row = r as Record<string, unknown> & { categories?: { name?: string } | null };
      return {
        名称: row.name,
        位置: row.location || "未填写",
        分类: row.categories?.name || "未分类",
        标签: row.tags || "无",
        备注: row.note || "无",
        借给: row.borrowed_to || null,
        过期日: row.expiry_date || null,
      };
    });

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const llm = new LLMClient(new Config(), customHeaders);
    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = `你是家庭物品查找助手。今天是${today}。用户用自然语言问你东西放在哪里，请根据下方物品清单 JSON 回答。
物品清单（JSON）：
${JSON.stringify(inventory)}

回答规则：
- 用户可能用俗称、类别词或用途提问（如"证件"泛指护照/身份证/签证，"充电的"指充电器/数据线），请主动做同义词和类别联想推理，不要只做字面匹配；有合理推断就回答并简短说明（如"护照属于证件"）
- 只根据清单回答；做了上述联想后仍没有相关物品的，明确告诉用户"没有找到记录"，并建议先拍照记录
- 回答简短、口语化，直接给出物品名和存放位置（位置未填写就如实说明）
- 如果物品已借出（借给字段不为空），必须提醒"已借给 XX"
- 如果匹配物品的过期日临近（30 天内）或已过今天，顺带提醒一句
- 多个匹配时全部列出；用户问"某位置有什么"时列出该位置所有物品
- 全程不超过 120 字，不要用 markdown 格式`;

    const stream = llm.stream(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question.trim().slice(0, 200) },
      ],
      { model: "doubao-seed-1-8-251228", temperature: 0.3 }
    );

    for await (const chunk of stream) {
      if (chunk.content) {
        res.write(`data: ${JSON.stringify({ delta: chunk.content.toString() })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    console.error("POST /items/ask error:", e);
    res.write(`data: ${JSON.stringify({ error: "问答失败，请稍后重试" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// POST /api/v1/items/smart-search - AI 语义搜索（同义词/类别推理）
// Body: { query: string }
// 返回：与 GET / 结构一致的物品数组（按相关度排序）
router.post("/smart-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || !query.trim()) {
      res.status(400).json({ error: "请提供搜索词" });
      return;
    }

    const { data: rows, error } = await client
      .from("items")
      .select("id, name, location, tags, note, categories(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`查询物品失败: ${error.message}`);
    if (!rows || rows.length === 0) {
      res.json([]);
      return;
    }

    const inventory = rows.map((r) => {
      const row = r as Record<string, unknown> & { categories?: { name?: string } | null };
      return {
        id: row.id,
        名称: row.name,
        位置: row.location || "",
        分类: row.categories?.name || "",
        标签: row.tags || "",
        备注: row.note || "",
      };
    });

    const customHeaders = HeaderUtils.extractForwardHeaders(req.headers as Record<string, string>);
    const llm = new LLMClient(new Config(), customHeaders);
    const response = await llm.invoke(
      [
        {
          role: "system",
          content: `你是物品搜索引擎。用户的搜索词与物品名称往往不是字面一致，请做同义词、俗称、类别归属、用途联想推理。例如："证件"可匹配护照/身份证/签证/驾驶证；"手机"可匹配 iPhone；"药"可匹配感冒药/创可贴；"充电"可匹配充电器/数据线/充电宝。宁多勿漏，明显无关的才排除。
物品清单（JSON）：
${JSON.stringify(inventory)}

只输出 JSON：{"ids": [匹配物品的 id，按相关度从高到低，最多 10 个]}；确实没有匹配时输出 {"ids": []}。禁止输出任何其他文字。`,
        },
        { role: "user", content: query.trim().slice(0, 100) },
      ],
      { model: "doubao-seed-1-8-251228", temperature: 0.1 }
    );

    let ids: number[] = [];
    try {
      const parsed = extractJson(String(response.content || ""));
      if (Array.isArray(parsed.ids)) {
        ids = parsed.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
      }
    } catch {
      ids = [];
    }
    if (ids.length === 0) {
      res.json([]);
      return;
    }

    // 按命中 id 查询完整物品数据（结构与 GET / 一致），并按相关度顺序返回
    const { data: items, error: itemsError } = await client
      .from("items")
      .select("id, name, category_id, location, tags, photo_key, note, created_at, updated_at, borrowed_to, borrowed_at, expiry_date, categories(id, name, icon, color)")
      .in("id", ids.slice(0, 10));
    if (itemsError) throw new Error(`查询物品详情失败: ${itemsError.message}`);

    const order = new Map(ids.map((id, idx) => [id, idx]));
    const sorted = (items || []).sort(
      (a, b) => (order.get((a as { id: number }).id) ?? 999) - (order.get((b as { id: number }).id) ?? 999)
    );
    res.json(sorted);
  } catch (e) {
    console.error("POST /items/smart-search error:", e);
    res.status(500).json({ error: "智能搜索失败，请重试" });
  }
});

// POST /api/v1/items - 创建物品
// Body: { name?: string, category_id?: number, location?: string, tags?: string, photo_key: string, note?: string, expiry_date?: string }
// category_id 为空或不属于当前用户可见范围时，自动兜底到「其他」分类（不存在则创建）
router.post("/", async (req, res) => {
  const { name, category_id, location, location_id, tags, photo_key, note, expiry_date } = req.body;

  // 会员门控：免费用户物品上限 FREE_ITEM_LIMIT 件（本人创建的物品）；会员不限
  // 单件与一拍多录的批量保存都走此接口，此处门控一处即可全覆盖
  const premiumForCreate = await isPremium(req.userId!);
  if (!premiumForCreate) {
    const used = await getItemCount(req.userId!);
    if (used >= FREE_ITEM_LIMIT) {
      res.status(403).json({
        error: `免费版最多记录 ${FREE_ITEM_LIMIT} 件物品，升级会员不限数量`,
        code: "ITEM_LIMIT",
        limit: FREE_ITEM_LIMIT,
        used,
      });
      return;
    }
  }

  // location_id 校验：必须是当前用户可见的空间节点；非法值静默忽略（不阻断保存）
  let finalLocationId: number | null = null;
  if (location_id !== undefined && location_id !== null) {
    const lid = Number(location_id);
    if (Number.isInteger(lid) && lid > 0) {
      const visibleIdsForLoc = await getVisibleOwnerIds(req.userId!);
      const { data: locNode } = await client
        .from("locations")
        .select("id")
        .in("owner_id", visibleIdsForLoc)
        .eq("id", lid)
        .limit(1)
        .maybeSingle();
      if (locNode) finalLocationId = lid;
    }
  }

  let finalCategoryId = Number(category_id) || null;
  if (finalCategoryId !== null) {
    const visibleIds = await getVisibleOwnerIds(req.userId!);
    const { data: owned } = await client
      .from("categories")
      .select("id")
      .in("owner_id", visibleIds)
      .eq("id", finalCategoryId)
      .limit(1)
      .maybeSingle();
    if (!owned) finalCategoryId = null;
  }
  if (finalCategoryId === null) {
    const { data: catsRaw } = await client
      .from("categories")
      .select("id, name")
      .eq("owner_id", req.userId!)
      .order("id");
    const fallback = await resolveCategoryId(req.userId!, (catsRaw || []) as CategoryBrief[], "其他");
    finalCategoryId = fallback.id;
  }

  const payload: Record<string, unknown> = {
    name: name || "未命名物品",
    category_id: finalCategoryId,
    location: location || "",
    location_id: finalLocationId,
    tags: tags || "",
    photo_key: photo_key || null,
    note: note || "",
    owner_id: req.userId!,
  };
  if (expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(expiry_date)) {
    payload.expiry_date = expiry_date;
  }

  const { data, error } = await client
    .from("items")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`创建物品失败: ${error.message}`);
  res.status(201).json(data);
});

// PUT /api/v1/items/:id - 更新物品
// Body: { name?: string, category_id?: number, location?: string, tags?: string, photo_key?: string, note?: string, borrowed_to?: string | null, expiry_date?: string | null }
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};

  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.category_id !== undefined) updates.category_id = Number(req.body.category_id);
  if (req.body.location !== undefined) updates.location = req.body.location;
  // location_id：传 null 摘除空间挂载；传 id 时校验可见范围，非法值忽略
  if (req.body.location_id !== undefined) {
    if (req.body.location_id === null) {
      updates.location_id = null;
    } else {
      const lid = Number(req.body.location_id);
      if (Number.isInteger(lid) && lid > 0) {
        const visibleIdsForLoc = await getVisibleOwnerIds(req.userId!);
        const { data: locNode } = await client
          .from("locations")
          .select("id")
          .in("owner_id", visibleIdsForLoc)
          .eq("id", lid)
          .limit(1)
          .maybeSingle();
        if (locNode) updates.location_id = lid;
      }
    }
  }
  if (req.body.tags !== undefined) updates.tags = req.body.tags;
  if (req.body.photo_key !== undefined) updates.photo_key = req.body.photo_key;
  if (req.body.note !== undefined) updates.note = req.body.note;
  if (req.body.expiry_date !== undefined) {
    updates.expiry_date =
      req.body.expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.expiry_date)
        ? req.body.expiry_date
        : null;
  }
  // borrowed_to 传 null 表示归还（同时清空借出时间）
  if (req.body.borrowed_to !== undefined) {
    if (req.body.borrowed_to === null || req.body.borrowed_to === "") {
      updates.borrowed_to = null;
      updates.borrowed_at = null;
    } else {
      updates.borrowed_to = String(req.body.borrowed_to).slice(0, 100);
      updates.borrowed_at = new Date().toISOString();
    }
  }
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 1) {
    res.status(400).json({ error: "没有要更新的字段" });
    return;
  }

  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { data, error } = await client
    .from("items")
    .update(updates)
    .eq("id", id)
    .in("owner_id", visibleIds)
    .select()
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      res.status(404).json({ error: "物品不存在或无权限修改" });
      return;
    }
    throw new Error(`更新物品失败: ${error.message}`);
  }
  res.json(data);
});

// DELETE /api/v1/items/:id - 删除物品
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { error } = await client.from("items").delete().eq("id", id).in("owner_id", visibleIds);
  if (error) throw new Error(`删除物品失败: ${error.message}`);
  res.json({ success: true });
});

export default router;
