import { Router } from "express";
import multer from "multer";
import { S3Storage, LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth, getVisibleOwnerIds, getFamilyEmailMap } from "../middleware/auth.js";

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

// GET /api/v1/items - 获取物品列表
// Query: { category_id?: number, search?: string }
router.get("/", async (req, res) => {
  const { category_id, search } = req.query;
  const visibleIds = await getVisibleOwnerIds(req.userId!);

  let query = client
    .from("items")
    .select("id, name, category_id, location, tags, photo_key, note, owner_id, created_at, updated_at, borrowed_to, borrowed_at, expiry_date, categories(id, name, icon, color)")
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
  // 家庭场景：补充归属人邮箱，前端展示"谁记的"
  const emailMap = await getFamilyEmailMap(req.userId!);
  const items = (data || []).map((item) => ({
    ...item,
    owner_email: emailMap[(item as { owner_id?: string }).owner_id || ""] || null,
  }));
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
    .select("id, name, category_id, location, tags, photo_key, note, created_at, updated_at, borrowed_to, borrowed_at, expiry_date, categories(id, name, icon, color)")
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
  res.json(data);
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

    // 2. 查询现有分类（让 LLM 从中选择，保证分类匹配用户自己的分类体系）
    const { data: cats } = await client.from("categories").select("id, name").order("id");
    const categoryNames = (cats || []).map((c) => c.name);

    // 3. 调用多模态 LLM 识别（失败降级：photo_key 已上传，识别字段用默认值）
    let name = "未命名物品";
    let tags: string[] = [];
    let categoryId: number | null = cats && cats.length > 0 ? cats[0].id : null;

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
        `- category：必须从以下分类中原样选择一个：${categoryNames.join("、") || "其他"}`,
        '- 如果照片模糊或无法辨认物品，name 返回"未识别物品"，tags 返回空数组，category 返回列表中的第一个分类',
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
      const matched =
        (cats || []).find((c) => c.name === parsed.category) ??
        (cats || []).find((c) => typeof parsed.category === "string" && parsed.category.includes(c.name)) ??
        (cats || []).find((c) => c.name === "其他") ??
        (cats || [])[0];
      if (matched) categoryId = matched.id;
    } catch (llmError) {
      console.error("LLM 识别失败，使用降级结果:", llmError);
    }

    res.json({ photo_key: photoKey, name, tags, category_id: categoryId });
  } catch (error) {
    console.error("POST /items/recognize error:", error);
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

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

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
// Body: { name?: string, category_id: number, location?: string, tags?: string, photo_key: string, note?: string, expiry_date?: string }
router.post("/", async (req, res) => {
  const { name, category_id, location, tags, photo_key, note, expiry_date } = req.body;

  if (!category_id) {
    res.status(400).json({ error: "分类为必填项" });
    return;
  }

  const payload: Record<string, unknown> = {
    name: name || "未命名物品",
    category_id: Number(category_id),
    location: location || "",
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
