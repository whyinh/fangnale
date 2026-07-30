/**
 * E2E 冒烟：语音链路（ASR 识别 + LLM 拆解 + TTS 合成）
 * 前置：后端已启动（.env 含 VOLC_SPEECH_API_KEY / FFMPEG_PATH）
 * 运行：node e2e-speech.mjs
 * 说明：用火山 TTS 生成中文语音 → ffmpeg 转 m4a 模拟客户端录音 → 走真实 HTTP 接口
 */
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';

const BASE = 'http://localhost:9091';
const FFMPEG = process.env.FFMPEG_PATH || '/tmp/ffmpeg';
const SPEECH_KEY = process.env.VOLC_SPEECH_API_KEY;

const admin = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ---------- 准备：测试用户 ----------
const email = `speech_${Date.now()}@test.com`;
const { error: createErr } = await admin.auth.admin.createUser({ email, password: 'Test123456!', email_confirm: true });
if (createErr) throw createErr;
const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({ email, password: 'Test123456!' });
if (loginErr) throw loginErr;
const H = { 'x-session': loginData.session.access_token };

// ---------- 准备：生成测试音频（TTS → m4a） ----------
console.log('== 0. 生成测试音频 ==');
const ttsResp = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': SPEECH_KEY, 'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': crypto.randomUUID() },
  body: JSON.stringify({ user: { uid: 'e2e' }, req_params: { text: '我把医保卡放在卧室床头柜的抽屉里了', speaker: 'zh_female_vv_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000 } } }),
});
const rawTts = await ttsResp.text();
const mp3Chunks = [];
for (const line of rawTts.split('\n')) { const t = line.trim(); if (!t) continue; try { const j = JSON.parse(t); if (j.data) mp3Chunks.push(Buffer.from(j.data, 'base64')); } catch {} }
check('火山 TTS 生成 mp3', mp3Chunks.length > 0);

const m4a = await new Promise((resolve, reject) => {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
  const out = [], err = [];
  p.stdout.on('data', c => out.push(c)); p.stderr.on('data', c => err.push(c));
  p.on('close', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().slice(0, 200))));
  p.stdin.write(Buffer.concat(mp3Chunks)); p.stdin.end();
});
check('ffmpeg 转 m4a（模拟客户端）', m4a.length > 1000, `${m4a.length}B`);

// ---------- 1. 语音速记（ASR + LLM 拆解） ----------
console.log('== 1. POST /speech/voice-note ==');
let fd = new FormData();
fd.append('audio', new Blob([m4a], { type: 'audio/m4a' }), 'voice_test.m4a');
let r = await fetch(`${BASE}/api/v1/speech/voice-note`, { method: 'POST', headers: H, body: fd });
let d = await r.json();
check('voice-note 200', r.status === 200, JSON.stringify(d).slice(0, 150));
check('转写含关键词', (d.transcript || '').includes('医保卡'), d.transcript);
check('拆解出物品名', typeof d.name === 'string' && d.name.length >= 2, d.name);
check('拆解出位置', typeof d.location === 'string' && d.location.includes('床头柜'), d.location);

// ---------- 2. 语音转文字 ----------
console.log('== 2. POST /speech/transcribe ==');
fd = new FormData();
fd.append('audio', new Blob([m4a], { type: 'audio/m4a' }), 'voice_test.m4a');
r = await fetch(`${BASE}/api/v1/speech/transcribe`, { method: 'POST', headers: H, body: fd });
d = await r.json();
check('transcribe 200', r.status === 200, JSON.stringify(d).slice(0, 150));
check('转写含关键词', (d.transcript || '').includes('医保卡'), d.transcript);

// ---------- 3. 语音合成接口 ----------
console.log('== 3. POST /speech/tts ==');
r = await fetch(`${BASE}/api/v1/speech/tts`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '医保卡在卧室床头柜的抽屉里' }),
});
d = await r.json();
check('tts 200', r.status === 200, JSON.stringify(d).slice(0, 150));
check('返回 audio_url', typeof d.audio_url === 'string' && d.audio_url.startsWith('http'));
if (d.audio_url) {
  const audioResp = await fetch(d.audio_url);
  const audioBuf = await audioResp.arrayBuffer();
  check('audio_url 可下载', audioResp.status === 200 && audioBuf.byteLength > 1000, `${audioResp.status} ${audioBuf.byteLength}B`);
}

// ---------- 4. 错误处理 ----------
console.log('== 4. 错误处理 ==');
r = await fetch(`${BASE}/api/v1/speech/voice-note`, { method: 'POST', headers: H, body: new FormData() });
check('缺音频返回 400', r.status === 400);
r = await fetch(`${BASE}/api/v1/speech/tts`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
check('缺文本返回 400', r.status === 400);
r = await fetch(`${BASE}/api/v1/speech/transcribe`, { method: 'POST', body: new FormData() });
check('未登录返回 401', r.status === 401);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
