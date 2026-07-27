import { Router } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";

const router = Router();
const client = getSupabaseClient();

// GET /api/v1/items - 获取物品列表
// Query: { category_id?: number, search?: string }
router.get("/", async (req, res) => {
  const { category_id, search } = req.query;

  let query = client
    .from("items")
    .select("id, name, category_id, location, tags, photo_key, note, created_at, updated_at, categories(id, name, icon, color)")
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
  res.json(data);
});

// GET /api/v1/items/:id - 获取单个物品详情
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data, error } = await client
    .from("items")
    .select("id, name, category_id, location, tags, photo_key, note, created_at, updated_at, categories(id, name, icon, color)")
    .eq("id", id)
    .single();
  if (error) throw new Error(`查询物品失败: ${error.message}`);
  if (!data) {
    res.status(404).json({ error: "物品不存在" });
    return;
  }
  res.json(data);
});

// POST /api/v1/items - 创建物品
// Body: { name: string, category_id: number, location?: string, tags?: string, photo_key: string, note?: string }
router.post("/", async (req, res) => {
  const { name, category_id, location, tags, photo_key, note } = req.body;

  if (!name || !category_id || !photo_key) {
    res.status(400).json({ error: "名称、分类和照片为必填项" });
    return;
  }

  const payload = {
    name,
    category_id: Number(category_id),
    location: location || "",
    tags: tags || "",
    photo_key,
    note: note || "",
  };

  const { data, error } = await client
    .from("items")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`创建物品失败: ${error.message}`);
  res.status(201).json(data);
});

// PUT /api/v1/items/:id - 更新物品
// Body: { name?: string, category_id?: number, location?: string, tags?: string, photo_key?: string, note?: string }
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, unknown> = {};

  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.category_id !== undefined) updates.category_id = Number(req.body.category_id);
  if (req.body.location !== undefined) updates.location = req.body.location;
  if (req.body.tags !== undefined) updates.tags = req.body.tags;
  if (req.body.photo_key !== undefined) updates.photo_key = req.body.photo_key;
  if (req.body.note !== undefined) updates.note = req.body.note;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 1) {
    res.status(400).json({ error: "没有要更新的字段" });
    return;
  }

  const { data, error } = await client
    .from("items")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`更新物品失败: ${error.message}`);
  res.json(data);
});

// DELETE /api/v1/items/:id - 删除物品
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await client.from("items").delete().eq("id", id);
  if (error) throw new Error(`删除物品失败: ${error.message}`);
  res.json({ success: true });
});

export default router;
