// E2E：空间功能（房间→家具→隔层→物品挂载→路径→级联删除）
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:9091';
const url = process.env.COZE_SUPABASE_URL;
const serviceKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.COZE_SUPABASE_ANON_KEY;

let passed = 0;
function assert(cond, msg) {
  if (!cond) { console.error(`❌ FAIL: ${msg}`); process.exit(1); }
  passed++; console.log(`✅ ${msg}`);
}

// 创建测试用户并登录
const admin = createClient(url, serviceKey);
const email = `space_${Date.now()}@test.com`;
const password = 'Test123456!';
const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createErr) { console.error('创建用户失败', createErr); process.exit(1); }
const anon = createClient(url, anonKey);
const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({ email, password });
if (loginErr) { console.error('登录失败', loginErr); process.exit(1); }
const token = loginData.session.access_token;
const H = { 'Content-Type': 'application/json', 'x-session': token };

async function api(method, path, body, headers = H) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// 1. 无 token 401
{
  const r = await api('GET', '/api/v1/locations/tree', null, {});
  assert(r.status === 401, `无 token 返回 401（实际 ${r.status}）`);
}

// 2. 家具模板列表
let templates;
{
  const r = await api('GET', '/api/v1/locations/templates');
  assert(r.status === 200 && Array.isArray(r.data) && r.data.length >= 8, `模板列表返回 ${r.data?.length} 个`);
  templates = r.data;
  assert(templates.some((t) => t.key === 'wardrobe' && t.layers.length === 4), '衣柜模板含 4 个隔层');
}

// 3. 创建房间
let roomId;
{
  const r = await api('POST', '/api/v1/locations/rooms', { name: '主卧' });
  assert(r.status === 201 && r.data.type === 'room', '创建房间「主卧」');
  roomId = r.data.id;
}

// 4. 按模板创建家具（自动生成隔层）
let furnitureId, layerIds = [];
{
  const r = await api('POST', '/api/v1/locations/furniture', { room_id: roomId, template: 'wardrobe' });
  assert(r.status === 201 && r.data.name === '衣柜' && r.data.children.length === 4, '创建衣柜并自动生成 4 个隔层');
  furnitureId = r.data.id;
  layerIds = r.data.children.map((c) => c.id);
  assert(r.data.children[0].name === '挂衣区' && r.data.children[0].grid_pos === 0, '隔层按 grid_pos 排序');
}

// 5. 手动加隔层
{
  const r = await api('POST', `/api/v1/locations/${furnitureId}/layers`, { name: '行李箱上' });
  assert(r.status === 201 && r.data.grid_pos === 4, `手动加隔层 grid_pos=4（实际 ${r.data.grid_pos}）`);
}

// 6. 创建物品挂到隔层
let itemId;
{
  const r = await api('POST', '/api/v1/items', { name: '护照', location_id: layerIds[1], photo_key: null });
  assert(r.status === 201 && r.data.location_id === layerIds[1], '物品挂载到「顶层搁板」');
  itemId = r.data.id;
}

// 7. GET /items 返回路径
{
  const r = await api('GET', '/api/v1/items');
  const item = r.data.find((it) => it.id === itemId);
  assert(item && item.location_path === '主卧 / 衣柜 / 顶层搁板', `物品路径正确（实际 "${item?.location_path}"）`);
}

// 8. 树结构与计数
{
  const r = await api('GET', '/api/v1/locations/tree');
  const room = r.data.find((n) => n.id === roomId);
  assert(room && room.total_count === 1, `房间 total_count=1（实际 ${room?.total_count}）`);
  const wardrobe = room.children.find((n) => n.id === furnitureId);
  assert(wardrobe && wardrobe.children.length === 5, '衣柜含 5 个隔层（4 模板 + 1 手动）');
  const layer = wardrobe.children.find((n) => n.id === layerIds[1]);
  assert(layer && layer.item_count === 1, '顶层搁板 item_count=1');
}

// 9. 节点物品列表（含子孙）
{
  const r = await api('GET', `/api/v1/locations/${furnitureId}/items`);
  assert(r.status === 200 && r.data.length === 1 && r.data[0].name === '护照', '家具下物品列表返回护照');
  assert(r.data[0].location_path === '主卧 / 衣柜 / 顶层搁板', '物品列表含路径');
}

// 10. 非法 location_id 静默忽略
{
  const r = await api('POST', '/api/v1/items', { name: '测试非法', location_id: 999999, photo_key: null });
  assert(r.status === 201 && r.data.location_id === null, '非法 location_id 被忽略');
}

// 11. PUT 改挂与摘除
{
  const r1 = await api('PUT', `/api/v1/items/${itemId}`, { location_id: layerIds[0] });
  assert(r1.status === 200 && r1.data.location_id === layerIds[0], '改挂到「挂衣区」');
  const r2 = await api('PUT', `/api/v1/items/${itemId}`, { location_id: null });
  assert(r2.status === 200 && r2.data.location_id === null, '摘除空间挂载');
  const r3 = await api('PUT', `/api/v1/items/${itemId}`, { location_id: layerIds[0] });
  assert(r3.status === 200, '重新挂载');
}

// 12. 重命名节点 → 路径联动
{
  const r = await api('PUT', `/api/v1/locations/${roomId}`, { name: '主卧室' });
  assert(r.status === 200 && r.data.name === '主卧室', '房间重命名');
  const r2 = await api('GET', '/api/v1/items');
  const item = r2.data.find((it) => it.id === itemId);
  assert(item.location_path === '主卧室 / 衣柜 / 挂衣区', `路径联动更新（实际 "${item.location_path}"）`);
}

// 13. 删除家具：隔层级联删除，物品 location_id 自动脱离（物品不删）
{
  const r = await api('DELETE', `/api/v1/locations/${furnitureId}`);
  assert(r.status === 200, '删除衣柜');
  const tree = await api('GET', '/api/v1/locations/tree');
  const room = tree.data.find((n) => n.id === roomId);
  assert(room && room.children.length === 0, '衣柜及隔层已从树中移除');
  const items = await api('GET', '/api/v1/items');
  const item = items.data.find((it) => it.id === itemId);
  assert(item && item.location_id === null && item.location_path === null, '物品保留但已脱离空间');
}

console.log(`\n🎉 全部 ${passed} 项断言通过`);
process.exit(0);
