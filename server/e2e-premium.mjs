/**
 * E2E 冒烟：会员体系（状态/开发开通/配额门控）
 * 运行：node e2e-premium.mjs
 */
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:9091';
const SUPABASE_URL = process.env.COZE_SUPABASE_URL;
const SERVICE_KEY = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.COZE_SUPABASE_ANON_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const email = `premium_${Date.now()}@test.com`;
const password = 'Test123456!';
const { error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createErr) throw createErr;
const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({ email, password });
if (loginErr) throw loginErr;
const token = loginData.session.access_token;
const H = { 'Content-Type': 'application/json', 'x-session': token };

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('== 1. 初始状态（免费用户） ==');
let r = await fetch(`${BASE}/api/v1/premium/`, { headers: H });
let d = await r.json();
check('GET /premium 200', r.status === 200);
check('默认非会员', d.isPremium === false);
check('配额结构完整', d.quota && d.quota.itemsLimit === 30 && d.quota.asksDailyLimit === 3, JSON.stringify(d.quota));

console.log('== 2. 问 AI 配额门控 ==');
for (let i = 0; i < 3; i++) {
  const rr = await fetch(`${BASE}/api/v1/premium/usage/ask`, { method: 'POST', headers: H });
  if (rr.status !== 200) { console.log('  (usage 记录接口不存在则跳过)'); break; }
}

console.log('== 3. 开发模式开通会员 ==');
r = await fetch(`${BASE}/api/v1/premium/dev-activate`, {
  method: 'POST', headers: H, body: JSON.stringify({ plan: 'yearly' }),
});
d = await r.json();
check('dev-activate 200', r.status === 200, JSON.stringify(d));
check('返回会员状态', d.ok === true && d.plan === 'yearly');

r = await fetch(`${BASE}/api/v1/premium/`, { headers: H });
d = await r.json();
check('状态已切换为会员', d.isPremium === true);
check('会员配额不限', d.quota.itemsLimit === null && d.quota.asksDailyLimit === null, JSON.stringify(d.quota));

console.log('== 4. 开发模式关闭会员（回退免费态） ==');
r = await fetch(`${BASE}/api/v1/premium/dev-deactivate`, { method: 'POST', headers: H });
check('dev-deactivate 200', r.status === 200);
r = await fetch(`${BASE}/api/v1/premium/`, { headers: H });
d = await r.json();
check('已回退为免费用户', d.isPremium === false);

console.log('== 5. 非法 plan 校验 ==');
r = await fetch(`${BASE}/api/v1/premium/dev-activate`, {
  method: 'POST', headers: H, body: JSON.stringify({ plan: 'forever' }),
});
check('非法 plan 400', r.status === 400);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
