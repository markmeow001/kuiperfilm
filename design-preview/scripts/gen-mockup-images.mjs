#!/usr/bin/env node
/**
 * 用 AtlasCloud (Gemini 3 Pro Image / nano-banana-pro) 產 mockup 用的佔位圖
 *
 * 用法：
 *   ATLASCLOUD_API_KEY=sk_xxx node scripts/gen-mockup-images.mjs
 *
 * 產 7-10 張：林夜 / 怪物 / 巷弄 wide / 巷弄盡頭 / 符文地面 / 油燈 / 手槍
 *           + 5 張專案 cover（霧城獵人 / 時光寄信人 等）
 *
 * 全部存到 design-preview/images/{slug}.jpg
 * 完成後自動印出 sed 命令，user 跑一次替換 mockup CSS。
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'images');
const ENV_PATH = '/Users/joshhung/KuiperAI/.env';

// 1. 環境變數優先
let API_KEY = process.env.ATLASCLOUD_API_KEY;

// 2. 否則讀 ~/KuiperAI/.env
if (!API_KEY && existsSync(ENV_PATH)) {
  const envContent = await readFile(ENV_PATH, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^\s*ATLASCLOUD_API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m) { API_KEY = m[1]; break; }
  }
}

if (!API_KEY) {
  console.error('❌ 找不到 ATLASCLOUD_API_KEY');
  console.error('  方式 1：跑前面加環境變數');
  console.error('    ATLASCLOUD_API_KEY=sk_xxx node scripts/gen-mockup-images.mjs');
  console.error('  方式 2：寫進 .env');
  console.error('    echo "ATLASCLOUD_API_KEY=sk_xxx" >> /Users/joshhung/KuiperAI/.env');
  process.exit(1);
}

const BASE = 'https://api.atlascloud.ai/api/v1';
const MODEL = 'google/nano-banana-pro/text-to-image';

/**
 * 12 張：7 個劇集元素（霧城獵人）+ 5 張 home 專案 cover
 * 統一寫實電影風格，深色基調，配合 KuiperAI cinematic 設計
 */
const SUBJECTS = [
  // ─── 霧城獵人 元素 ───
  {
    slug: 'char-linye',
    aspect: '1:1',
    prompt: 'Cinematic close-up portrait of a young Chinese male hunter in his late 20s, weathered face, sharp determined eyes, short black hair, wearing dark leather long coat with worn texture, holding a vintage oil lamp glowing warm orange, atmospheric mist swirling around, dimly lit alley background, dark moody noir lighting, photorealistic, 35mm film grain, shallow depth of field, intense mood',
  },
  {
    slug: 'char-monster',
    aspect: '1:1',
    prompt: 'Cinematic horror creature emerging from black mist, humanoid silhouette made of swirling dark fog and shadow, glowing red eyes piercing through the smoke, ethereal and menacing, dark fantasy art style, low-key lighting, atmospheric particles, photorealistic dark fantasy concept art, deep blacks with subtle violet highlights',
  },
  {
    slug: 'loc-alley-wide',
    aspect: '16:9',
    prompt: 'Wide cinematic shot of an empty dark Chinese village alley at night, narrow stone path between weathered brick walls, thick atmospheric mist rolling along the ground, single flickering oil lantern in distance, wet cobblestone reflecting amber light, deep shadows, ancient Chinese architecture, moody horror noir aesthetic, photorealistic, foggy night atmosphere, cinematic film still',
  },
  {
    slug: 'loc-alley-end',
    aspect: '16:9',
    prompt: 'Dead-end of a misty Chinese village alley at night, dark stone wall with carved ancient symbols barely visible, thick swirling black mist gathering at the center, atmospheric horror lighting, oil lamp glow from the side, deep noir shadows, cinematic widescreen shot, photorealistic dark fantasy mood, suspenseful atmosphere',
  },
  {
    slug: 'loc-rune-ground',
    aspect: '16:9',
    prompt: 'Top-down cinematic shot of ancient mystical runes carved into a wet stone floor, runes glowing with faint amber light, mist swirling above, scattered dust particles, atmospheric eerie lighting, dark fantasy aesthetic, photorealistic textured stone with cracks, dramatic chiaroscuro lighting',
  },
  {
    slug: 'prop-lamp',
    aspect: '1:1',
    prompt: 'Vintage Chinese brass oil lamp with intricate carved details, warm orange flame inside glass chamber, sitting on weathered wooden surface, soft atmospheric mist around it, dark background with selective lighting, photorealistic product shot, cinematic still life, warm amber glow, dark fantasy aesthetic',
  },
  {
    slug: 'prop-pistol',
    aspect: '1:1',
    prompt: 'Antique-style metallic revolver pistol with ornate engravings, dark blued steel finish, resting on weathered dark leather, dramatic side lighting creating reflections on metal surface, subtle mist atmosphere, dark moody background, photorealistic product shot, cinematic still life with shallow depth of field',
  },
  // ─── Home 專案 cover 5 張 ───
  {
    slug: 'cover-wucheng',
    aspect: '16:9',
    prompt: 'Cinematic poster art for a Chinese dark fantasy thriller series titled mist city hunter, lone hunter silhouette holding glowing oil lamp walking into thick fog, ancient Chinese village alley in background with dim warm lights, moody noir atmosphere, golden hour rim lighting through mist, photorealistic cinematic film poster style, dramatic composition, deep blacks with warm amber highlights',
  },
  {
    slug: 'cover-shiguang',
    aspect: '16:9',
    prompt: 'Cinematic poster for a Chinese drama titled time letter sender, vintage old Chinese village in autumn, an elderly grandmother reading a yellowed letter by candlelight in her home, warm soft golden afternoon light through paper window, nostalgic tender mood, photorealistic cinematic film still, warm color grading, melancholic atmosphere',
  },
  {
    slug: 'cover-haidi',
    aspect: '16:9',
    prompt: 'Cinematic poster for a Chinese sci-fi drama titled deep sea visitor, mysterious bioluminescent ocean creature glowing with soft blue light in deep dark waters, silhouette of a small Chinese fishing boat above, dramatic underwater lighting, ethereal and otherworldly atmosphere, photorealistic cinematic style, deep blues with bioluminescent highlights',
  },
  {
    slug: 'cover-changan',
    aspect: '16:9',
    prompt: 'Cinematic poster for a Chinese historical period drama titled changan night, ancient Tang dynasty Changan city street at night, lanterns hanging along the avenue, a noble figure in flowing tang dynasty robes walking through, moonlit ancient Chinese architecture, atmospheric and majestic mood, photorealistic cinematic film still, warm tonal lighting',
  },
  {
    slug: 'cover-yinxing',
    aspect: '16:9',
    prompt: 'Cinematic poster for a Chinese contemporary thriller titled silent rider, modern motorcycle rider in dark helmet on neon-lit Shanghai street at night, rain falling, reflections of city lights on wet asphalt, cyberpunk noir aesthetic, dramatic lighting, photorealistic cinematic film still, deep blacks with violet and amber neon highlights',
  },
];

async function submit(subject) {
  const body = {
    model: MODEL,
    prompt: subject.prompt,
    aspect_ratio: subject.aspect,
    resolution: '2k',
    output_format: 'jpeg',
  };
  const res = await fetch(`${BASE}/model/generateImage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`提交失敗 (${res.status}): ${t}`);
  }
  const data = await res.json();
  if (data.code !== undefined && data.code !== 200) {
    throw new Error(`API 錯誤 (code ${data.code}): ${data.message ?? ''}`);
  }
  const id = data?.data?.id ?? data?.id;
  if (!id) throw new Error('無 prediction id');
  return id;
}

async function pollOnce(id) {
  const res = await fetch(`${BASE}/model/prediction/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`poll fail ${res.status}`);
  const data = await res.json();
  const inner = data?.data ?? data;
  const status = inner?.status?.toLowerCase() ?? '';
  if (['completed', 'succeeded', 'success', 'finished'].includes(status)) {
    const url =
      inner?.output?.[0] ??
      inner?.output_url ??
      inner?.outputUrl ??
      inner?.result_url ??
      inner?.resultUrl ??
      inner?.image_url ??
      inner?.imageUrl ??
      (Array.isArray(inner?.images) ? inner.images[0] : undefined) ??
      inner?.url;
    if (!url) throw new Error(`完成但無 URL，response: ${JSON.stringify(inner).slice(0, 400)}`);
    return { done: true, url };
  }
  if (['failed', 'error', 'cancelled'].includes(status)) {
    throw new Error(`generation failed: ${JSON.stringify(inner).slice(0, 400)}`);
  }
  return { done: false };
}

async function poll(id, timeoutSec = 180) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const r = await pollOnce(id);
    if (r.done) return r.url;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('poll timeout');
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download fail ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`▶ 開始產 ${SUBJECTS.length} 張圖 → ${OUT_DIR}\n`);

  const results = [];
  for (const subj of SUBJECTS) {
    const t0 = Date.now();
    try {
      process.stdout.write(`  [${subj.slug}] 提交...`);
      const id = await submit(subj);
      process.stdout.write(` poll(${id.slice(0, 8)})...`);
      const url = await poll(id);
      process.stdout.write(` download...`);
      const out = join(OUT_DIR, `${subj.slug}.jpg`);
      await download(url, out);
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(` ✓ (${sec}s)`);
      results.push({ slug: subj.slug, ok: true, path: out });
    } catch (e) {
      console.log(` ✗ ${e.message}`);
      results.push({ slug: subj.slug, ok: false, error: e.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n完成 ${ok}/${results.length}`);

  if (ok > 0) {
    console.log('\n下一步：跑 update-mockup-images.mjs 把 CSS gradient 換成真圖');
    console.log('  node scripts/update-mockup-images.mjs');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
