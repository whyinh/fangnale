import { Router } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";

const router = Router();
const client = getSupabaseClient();

// GET /api/v1/categories - 获取所有分类
router.get("/", async (_req, res) => {
  const { data, error } = await client
    .from("categories")
    .select("id, name, icon, color, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`查询分类失败: ${error.message}`);
  res.json(data);
});

// POST /api/v1/categories - 创建分类
// Body: { name: string, icon?: string, color?: string }
router.post("/", async (req, res) => {
  const { name, icon, color } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "分类名称不能为空" });
    return;
  }
  const payload: Record<string, string> = { name };
  if (icon) payload.icon = icon;
  if (color) payload.color = color;

  const { data, error } = await client
    .from("categories")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`创建分类失败: ${error.message}`);
  res.status(201).json(data);
});

// PUT /api/v1/categories/:id - 更新分类
// Body: { name?: string, icon?: string, color?: string }
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates: Record<string, string> = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.icon) updates.icon = req.body.icon;
  if (req.body.color) updates.color = req.body.color;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "没有要更新的字段" });
    return;
  }

  const { data, error } = await client
    .from("categories")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`更新分类失败: ${error.message}`);
  res.json(data);
});

// DELETE /api/v1/categories/:id - 删除分类
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { error } = await client.from("categories").delete().eq("id", id);
  if (error) throw new Error(`删除分类失败: ${error.message}`);
  res.json({ success: true });
});

export default router;
