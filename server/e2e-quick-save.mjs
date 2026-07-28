// E2E：一拍多录链路（recognize-multi 多物品识别 → 逐件批量入库 → 列表校验）
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
const email = `multi_${Date.now()}@test.com`;
const password = 'Test123456!';
const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createErr) { console.error('创建用户失败', createErr); process.exit(1); }
const anon = createClient(url, anonKey);
const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({ email, password });
if (loginErr) { console.error('登录失败', loginErr); process.exit(1); }
const token = loginData.session.access_token;
const H = { 'Content-Type': 'application/json', 'x-session': token };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// 1. 拉取一张多物品场景图（桌面照）
console.log('… 下载测试图片');
const imgRes = await fetch('https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?w=900&q=80');
assert(imgRes.ok, `测试图片可下载（HTTP ${imgRes.status}）`);
const imgBuf = Buffer.from(await imgRes.arrayBuffer());
assert(imgBuf.length > 10000, `图片字节数 ${imgBuf.length} 合理`);

// 2. recognize-multi：FormData 上传，识别多件物品
console.log('… 调用 recognize-multi（LLM 识别中，约 10-30 秒）');
const fd = new FormData();
fd.append('photo', new Blob([imgBuf], { type: 'image/jpeg' }), 'desk.jpg');
const rRes = await fetch(`${BASE}/api/v1/items/recognize-multi`, {
  method: 'POST',
  headers: { 'x-session': token },
  body: fd,
});
const rData = await rRes.json().catch(() => null);
assert(rRes.status === 200, `recognize-multi 返回 200（实际 ${rRes.status}）`);
assert(rData && typeof rData.photo_key === 'string' && rData.photo_key.length > 0, '返回 photo_key（多录共用同一张照片）');
assert(Array.isArray(rData.items), 'items 为数组（降级时也必须是空数组）');
assert(rData.items.length >= 2 && rData.items.length <= 12, `识别出 ${rData.items.length} 件物品（2~12 之间）`);
assert(rData.items.every((it) => typeof it.name === 'string' && it.name.trim().length > 0), '每件物品 name 非空');
assert(
  rData.items.every((it) => it.category_id === null || typeof it.category_id === 'number'),
  'category_id 为 null 或数字（逐件自动匹配/建类）'
);
console.log('   识别结果:', rData.items.map((it) => `${it.name}${it.category_name ? `(${it.category_name})` : ''}`).join('、'));

// 3. 无文件时应 400
{
  const emptyFd = new FormData();
  const res = await fetch(`${BASE}/api/v1/items/recognize-multi`, {
    method: 'POST',
    headers: { 'x-session': token },
    body: emptyFd,
  });
  assert(res.status === 400, `缺少 photo 字段返回 400（实际 ${res.status}）`);
}

// 4. 无 token 401
{
  const res = await fetch(`${BASE}/api/v1/items/recognize-multi`, { method: 'POST', body: fd });
  assert(res.status === 401, `无 token 返回 401（实际 ${res.status}）`);
}

// 5. 模拟前端「全部存入」：逐件 POST /items，共用同一 photo_key
const toSave = rData.items.slice(0, Math.min(3, rData.items.length));
const createdIds = [];
for (const it of toSave) {
  const r = await api('POST', '/api/v1/items', {
    name: it.name,
    photo_key: rData.photo_key,
    category_id: it.category_id ?? undefined,
  });
  assert(r.status === 201 && r.data.id, `批量入库「${it.name}」成功`);
  createdIds.push(r.data.id);
}

// 6. 列表校验：物品存在且共用同一 photo_key
{
  const r = await api('GET', '/api/v1/items');
  assert(r.status === 200 && Array.isArray(r.data), '物品列表可获取');
  for (const id of createdIds) {
    const found = r.data.find((x) => x.id === id);
    assert(found, `列表包含新入库物品 #${id}`);
    assert(found.photo_key === rData.photo_key, `物品 #${id} 与多录共用同一 photo_key`);
  }
}

// 7. 清理：删除测试物品
for (const id of createdIds) {
  const r = await api('DELETE', `/api/v1/items/${id}`);
  assert(r.status === 200 || r.status === 204, `清理物品 #${id}`);
}

console.log(`\n一拍多录链路 E2E 结果: ${passed} passed, 0 failed`);
