// V2 E2E：模板 cols + tree cols + /:id/path 祖先链
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:9091';
const admin = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_ANON_KEY);

const email = `spacev2_${Date.now()}@test.com`;
await admin.auth.admin.createUser({ email, password: 'Test123456!', email_confirm: true });
const { data: login } = await anon.auth.signInWithPassword({ email, password: 'Test123456!' });
const H = { 'Content-Type': 'application/json', 'x-session': login.session.access_token };

let passed = 0, failed = 0;
const check = (name, cond) => { if (cond) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };

// 1. 模板含 cols
const tpls = await (await fetch(`${BASE}/api/v1/locations/templates`, { headers: H })).json();
check('模板含 cols 字段', tpls.every(t => typeof t.cols === 'number'));
check('衣柜 cols=2', tpls.find(t => t.key === 'wardrobe')?.cols === 2);
check('抽屉柜 cols=1', tpls.find(t => t.key === 'drawer_chest')?.cols === 1);

// 2. 建房间+家具，tree 的家具节点带 cols
const room = await (await fetch(`${BASE}/api/v1/locations/rooms`, { method: 'POST', headers: H, body: JSON.stringify({ name: '客厅' }) })).json();
const furn = await (await fetch(`${BASE}/api/v1/locations/furniture`, { method: 'POST', headers: H, body: JSON.stringify({ room_id: room.id, template: 'wardrobe' }) })).json();
const tree = await (await fetch(`${BASE}/api/v1/locations/tree`, { headers: H })).json();
const treeFurn = tree[0]?.children?.[0];
check('tree 家具节点 cols=2', treeFurn?.cols === 2);
check('tree 家具含 4 隔层', treeFurn?.children?.length === 4);

// 3. 祖先链：隔层 → [房间, 家具, 隔层]
const layerId = treeFurn.children[1].id;
const chain = await (await fetch(`${BASE}/api/v1/locations/${layerId}/path`, { headers: H })).json();
check('祖先链长度 3', chain.length === 3);
check('链[0]=房间', chain[0]?.type === 'room' && chain[0]?.name === '客厅');
check('链[1]=家具', chain[1]?.type === 'furniture' && chain[1]?.id === furn.id);
check('链[2]=隔层自身', chain[2]?.type === 'layer' && chain[2]?.id === layerId);

// 4. 房间级节点的链 = 自身
const roomChain = await (await fetch(`${BASE}/api/v1/locations/${room.id}/path`, { headers: H })).json();
check('房间链长度 1', roomChain.length === 1 && roomChain[0]?.type === 'room');

// 5. 不存在的节点 404
const notFound = await fetch(`${BASE}/api/v1/locations/999999/path`, { headers: H });
check('不存在节点 404', notFound.status === 404);

// 6. 无 token 401
const noAuth = await fetch(`${BASE}/api/v1/locations/${layerId}/path`);
check('无 token 401', noAuth.status === 401);

console.log(`\nV2 结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
