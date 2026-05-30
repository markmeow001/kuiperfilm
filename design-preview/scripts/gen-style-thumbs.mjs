#!/usr/bin/env node
/**
 * 用 AtlasCloud (Gemini 3 Pro Image) 跑 30 visual + 8 lighting = 38 風格縮圖
 * 取代原本 Kling Image O1 路徑（5/16 沒點數 blocker，從沒跑成功）
 *
 * 從 src/lib/style-library/thumbnail-prompts.ts 撈 prompt（單一真相源）
 * 全部存到 design-preview/images/styles/{id}.jpg
 *
 * 用法：
 *   node scripts/gen-style-thumbs.mjs              # 跑全部 38 張
 *   node scripts/gen-style-thumbs.mjs --only=cinematic_realism,golden_hour
 *
 * 跳過已存在的（除非加 --force）
 * 成本：~38 × $0.03 = ~$1.15
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'images', 'styles');
const ENV_PATH = '/Users/joshhung/KuiperAI/.env';
const PROMPTS_TS = '/Users/joshhung/KuiperAI/src/lib/style-library/thumbnail-prompts.ts';

let API_KEY = process.env.ATLASCLOUD_API_KEY;
if (!API_KEY && existsSync(ENV_PATH)) {
  for (const line of (await readFile(ENV_PATH, 'utf-8')).split('\n')) {
    const m = line.match(/^\s*ATLASCLOUD_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m) { API_KEY = m[1]; break; }
  }
}
if (!API_KEY) { console.error('no key'); process.exit(1); }

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.find(a => a.startsWith('--only='));
const onlySet = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

// 解析 thumbnail-prompts.ts（粗略 TS parse — 兩個 Record，順序 STYLE 然後 LIGHTING）
const tsContent = await readFile(PROMPTS_TS, 'utf-8');

function extractRecord(name) {
  const re = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = tsContent.match(re);
  if (!m) return {};
  const body = m[1];
  const out = {};
  // 抓 key: 'value' 或 key: "value" 或 'key': '...' 或 "key": "..."
  const rowRe = /\s*['"]?([a-zA-Z_][a-zA-Z0-9_]*|'[^']+'|"[^"]+")['"]?\s*:\s*\n?\s*['"]([^'"]+(?:\\.[^'"]*)*)['"][,\s]/g;
  let r;
  while ((r = rowRe.exec(body)) !== null) {
    const k = r[1].replace(/^['"]|['"]$/g, '');
    out[k] = r[2];
  }
  return out;
}

const stylePrompts = extractRecord('STYLE_THUMBNAIL_PROMPTS');
const lightingPrompts = extractRecord('LIGHTING_THUMBNAIL_PROMPTS');

const NEG = (tsContent.match(/STYLE_THUMBNAIL_NEGATIVE\s*=\s*['"]([^'"]+)['"]/)?.[1]) ?? '';

const all = [
  ...Object.entries(stylePrompts).map(([id, prompt]) => ({ id, prompt, kind: 'style' })),
  ...Object.entries(lightingPrompts).map(([id, prompt]) => ({ id, prompt, kind: 'lighting' })),
];

console.log(`📊 抓到 ${Object.keys(stylePrompts).length} visual + ${Object.keys(lightingPrompts).length} lighting = ${all.length} 個`);

const targets = onlySet ? all.filter(t => onlySet.has(t.id)) : all;
const todo = force ? targets : targets.filter(t => !existsSync(join(OUT_DIR, `${t.id}.jpg`)) && !existsSync(join(OUT_DIR, `${t.id}.png`)));

console.log(`▶ 待產 ${todo.length} 張（總 ${targets.length}，已存在 ${targets.length - todo.length} 跳過）\n`);

const BASE = 'https://api.atlascloud.ai/api/v1';
const MODEL = 'google/nano-banana-pro/text-to-image';

async function submit(prompt) {
  const r = await fetch(`${BASE}/model/generateImage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      prompt: NEG ? `${prompt}. AVOID: ${NEG}` : prompt,
      aspect_ratio: '1:1', resolution: '1k', output_format: 'jpeg',
    }),
  });
  const d = await r.json();
  if (d.code !== undefined && d.code !== 200) throw new Error(`code ${d.code}: ${d.message}`);
  return d?.data?.id ?? d?.id;
}
async function poll(id) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${BASE}/model/prediction/${id}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    const d = await r.json();
    const inner = d?.data ?? d;
    const status = inner?.status?.toLowerCase();
    if (['completed', 'succeeded', 'success'].includes(status)) {
      return inner?.outputs?.[0] ?? inner?.output?.[0];
    }
    if (['failed', 'error'].includes(status)) throw new Error(`failed: ${inner?.error}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('timeout');
}
async function download(url, p) {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
  return buf.length;
}

await mkdir(OUT_DIR, { recursive: true });
let ok = 0, fail = 0;
const startAt = Date.now();
for (const t of todo) {
  const t0 = Date.now();
  try {
    process.stdout.write(`  [${t.kind}/${t.id}]`);
    const id = await submit(t.prompt);
    process.stdout.write(` ${id.slice(0,8)}...`);
    const url = await poll(id);
    const ext = url.match(/\.(\w+)(?:\?|$)/)?.[1] || 'jpg';
    const out = join(OUT_DIR, `${t.id}.${ext}`);
    const size = await download(url, out);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(` ✓ ${(size/1024).toFixed(0)}KB (${sec}s)`);
    ok++;
  } catch (e) {
    console.log(` ✗ ${e.message}`);
    fail++;
  }
}
const total = ((Date.now() - startAt) / 1000).toFixed(0);
console.log(`\n完成 ${ok}/${todo.length} (失敗 ${fail}) — 用時 ${total}s`);
console.log(`輸出：${OUT_DIR}`);
