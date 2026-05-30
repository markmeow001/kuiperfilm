#!/usr/bin/env node
/**
 * 用已產好的 prediction ID 直接下載（避免重 generate 燒點）
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'images');
const ENV_PATH = '/Users/joshhung/KuiperAI/.env';

let API_KEY = process.env.ATLASCLOUD_API_KEY;
if (!API_KEY && existsSync(ENV_PATH)) {
  const c = await readFile(ENV_PATH, 'utf-8');
  for (const line of c.split('\n')) {
    const m = line.match(/^\s*ATLASCLOUD_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m) { API_KEY = m[1]; break; }
  }
}

// 從前次 log 抓到的 12 個 prediction ID
const PREDICTIONS = [
  { slug: 'char-linye',       id: '945fdd190b904de591c41a0774f19820' },
  { slug: 'char-monster',     id: 'e8b5fddd0d2748a9a0032cf1792d1b96' },
  { slug: 'loc-alley-wide',   id: '6a4a487415a247d49952daa7f873f1e1' },
  { slug: 'loc-alley-end',    id: '7005bd902fa045239a756dee59011774' },
  { slug: 'loc-rune-ground',  id: 'acaed0094670410096732f0d5aad135d' },
  { slug: 'prop-lamp',        id: '492ae13e20ee4416bd94bea39ea0f08b' },
  { slug: 'prop-pistol',      id: 'eee18b34483549db8c66dc2a5b179a3b' },
  { slug: 'cover-wucheng',    id: '132fdb5b58b24e16b65c32dc089ee40b' },
  { slug: 'cover-shiguang',   id: 'e7300bde39c54370b5d63955358d6bfb' },
  { slug: 'cover-haidi',      id: '63a8ffb395e84a1eadacc925672d5bb4' },
  { slug: 'cover-changan',    id: '0fde7831bd6d4b21b6b111a567d72cd9' },
  { slug: 'cover-yinxing',    id: 'db47e1ead585403aa75508285a6ad846' },
];

const BASE = 'https://api.atlascloud.ai/api/v1';

async function getOutput(id) {
  const res = await fetch(`${BASE}/model/prediction/${id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = await res.json();
  const inner = data?.data ?? data;
  const url = inner?.outputs?.[0] ?? inner?.output?.[0];
  if (!url) throw new Error(`no output: ${JSON.stringify(inner).slice(0, 200)}`);
  return url;
}

async function downloadAs(url, outPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return buf.length;
}

await mkdir(OUT_DIR, { recursive: true });
let ok = 0;
for (const p of PREDICTIONS) {
  try {
    process.stdout.write(`  [${p.slug}]`);
    const url = await getOutput(p.id);
    const ext = url.match(/\.(\w+)(?:\?|$)/)?.[1] || 'jpg';
    const out = join(OUT_DIR, `${p.slug}.${ext}`);
    const size = await downloadAs(url, out);
    console.log(` ✓ (${(size / 1024).toFixed(0)} KB)`);
    ok++;
  } catch (e) {
    console.log(` ✗ ${e.message}`);
  }
}
console.log(`\n完成 ${ok}/${PREDICTIONS.length}`);
