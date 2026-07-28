import { Router } from "express";
import { getSupabaseClient } from "../storage/database/supabase-client.js";
import { requireAuth, getVisibleOwnerIds } from "../middleware/auth.js";
import {
  FURNITURE_TEMPLATES,
  buildLocationTree,
  buildPathMap,
  collectNodeIds,
  type LocationRow,
} from "../utils/location-tree.js";

const router = Router();
const client = getSupabaseClient();

// 所有空间接口均需登录
router.use(requireAuth);

const LOCATION_COLS = "id, owner_id, parent_id, type, name, template, grid_pos, sort";

// 查询当前用户（含家庭成员）可见的全部空间节点
async function getVisibleRows(userId: string): Promise<LocationRow[]> {
  const visibleIds = await getVisibleOwnerIds(userId);
  const { data, error } = await client
    .from("locations")
    .select(LOCATION_COLS)
    .in("owner_id", visibleIds)
    .order("id");
  if (error) throw new Error(`查询空间失败: ${error.message}`);
  return (data || []) as LocationRow[];
}

// GET /api/v1/locations/templates - 家具模板列表（前端"添加家具"用）
router.get("/templates", (_req, res) => {
  res.json(FURNITURE_TEMPLATES);
});

// GET /api/v1/locations/tree - 整棵空间树（房间→家具→隔层），节点带物品计数
router.get("/tree", async (req, res) => {
  const rows = await getVisibleRows(req.userId!);
  const visibleIds = await getVisibleOwnerIds(req.userId!);

  const { data: itemRows, error } = await client
    .from("items")
    .select("id, location_id")
    .in("owner_id", visibleIds)
    .not("location_id", "is", null);
  if (error) throw new Error(`统计空间物品失败: ${error.message}`);

  const directCounts = new Map<number, number>();
  for (const it of itemRows || []) {
    const lid = (it as { location_id: number }).location_id;
    directCounts.set(lid, (directCounts.get(lid) || 0) + 1);
  }

  res.json(buildLocationTree(rows, directCounts));
});

// GET /api/v1/locations/:id/items - 某节点（含子孙）下的物品列表，附位置路径
router.get("/:id/items", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "无效的空间 id" });
    return;
  }
  const rows = await getVisibleRows(req.userId!);
  if (!rows.some((r) => r.id === id)) {
    res.status(404).json({ error: "空间不存在或无权限查看" });
    return;
  }
  const nodeIds = collectNodeIds(id, rows);
  const pathMap = buildPathMap(rows);

  const { data: items, error } = await client
    .from("items")
    .select(
      "id, name, category_id, location, location_id, tags, photo_key, note, owner_id, created_at, borrowed_to, expiry_date, categories(id, name, icon, color)"
    )
    .in("location_id", nodeIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`查询空间物品失败: ${error.message}`);

  res.json(
    (items || []).map((it) => ({
      ...it,
      location_path: pathMap.get((it as { location_id: number }).location_id) || "",
    }))
  );
});

// POST /api/v1/locations/rooms - 创建房间
// Body: { name: string }
router.post("/rooms", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "房间名称不能为空" });
    return;
  }
  // 防滥用：房间数量上限 30
  const { count } = await client
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", req.userId!)
    .eq("type", "room");
  if ((count || 0) >= 30) {
    res.status(400).json({ error: "房间数量已达上限（30 个）" });
    return;
  }
  const { data, error } = await client
    .from("locations")
    .insert({ owner_id: req.userId!, parent_id: null, type: "room", name: name.trim().slice(0, 20) })
    .select(LOCATION_COLS)
    .single();
  if (error) throw new Error(`创建房间失败: ${error.message}`);
  res.status(201).json(data);
});

// POST /api/v1/locations/furniture - 创建家具（按模板自动生成隔层）
// Body: { room_id: number, template: string, name?: string }
router.post("/furniture", async (req, res) => {
  const { room_id, template, name } = req.body as {
    room_id?: number;
    template?: string;
    name?: string;
  };
  const tpl = FURNITURE_TEMPLATES.find((t) => t.key === template);
  if (!tpl) {
    res.status(400).json({ error: "未知的家具模板" });
    return;
  }
  const roomId = Number(room_id);
  const rows = await getVisibleRows(req.userId!);
  const room = rows.find((r) => r.id === roomId && r.type === "room");
  if (!room) {
    res.status(404).json({ error: "房间不存在或无权限操作" });
    return;
  }
  // 防滥用：单个房间家具上限 30
  if (rows.filter((r) => r.parent_id === roomId && r.type === "furniture").length >= 30) {
    res.status(400).json({ error: "该房间家具数量已达上限（30 个）" });
    return;
  }

  const furnitureName = (name && String(name).trim().slice(0, 20)) || tpl.name;
  const { data: furniture, error } = await client
    .from("locations")
    .insert({
      owner_id: req.userId!,
      parent_id: roomId,
      type: "furniture",
      name: furnitureName,
      template: tpl.key,
    })
    .select(LOCATION_COLS)
    .single();
  if (error) throw new Error(`创建家具失败: ${error.message}`);

  // 按模板批量生成隔层
  const layerPayloads = tpl.layers.map((layerName, idx) => ({
    owner_id: req.userId!,
    parent_id: furniture.id,
    type: "layer",
    name: layerName,
    grid_pos: idx,
  }));
  const { data: layers, error: layerError } = await client
    .from("locations")
    .insert(layerPayloads)
    .select(LOCATION_COLS);
  if (layerError) throw new Error(`生成隔层失败: ${layerError.message}`);

  res.status(201).json({ ...furniture, children: layers || [] });
});

// POST /api/v1/locations/:id/layers - 给家具手动添加隔层
// Body: { name: string }
router.post("/:id/layers", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "隔层名称不能为空" });
    return;
  }
  const rows = await getVisibleRows(req.userId!);
  const furniture = rows.find((r) => r.id === id && r.type === "furniture");
  if (!furniture) {
    res.status(404).json({ error: "家具不存在或无权限操作" });
    return;
  }
  const siblings = rows.filter((r) => r.parent_id === id && r.type === "layer");
  if (siblings.length >= 12) {
    res.status(400).json({ error: "隔层数量已达上限（12 个），建议拆成两件家具" });
    return;
  }
  const nextPos = Math.max(-1, ...siblings.map((s) => s.grid_pos ?? -1)) + 1;
  const { data, error } = await client
    .from("locations")
    .insert({
      owner_id: req.userId!,
      parent_id: id,
      type: "layer",
      name: name.trim().slice(0, 20),
      grid_pos: nextPos,
    })
    .select(LOCATION_COLS)
    .single();
  if (error) throw new Error(`添加隔层失败: ${error.message}`);
  res.status(201).json(data);
});

// PUT /api/v1/locations/:id - 重命名节点
// Body: { name: string }
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "名称不能为空" });
    return;
  }
  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { data, error } = await client
    .from("locations")
    .update({ name: name.trim().slice(0, 20) })
    .eq("id", id)
    .in("owner_id", visibleIds)
    .select(LOCATION_COLS)
    .single();
  if (error) {
    if (error.code === "PGRST116") {
      res.status(404).json({ error: "空间不存在或无权限修改" });
      return;
    }
    throw new Error(`重命名失败: ${error.message}`);
  }
  res.json(data);
});

// DELETE /api/v1/locations/:id - 删除节点（子节点级联删除，挂在上面的物品自动脱离空间，不会被删）
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const visibleIds = await getVisibleOwnerIds(req.userId!);
  const { error } = await client
    .from("locations")
    .delete()
    .eq("id", id)
    .in("owner_id", visibleIds);
  if (error) throw new Error(`删除空间失败: ${error.message}`);
  res.json({ success: true });
});

export default router;
