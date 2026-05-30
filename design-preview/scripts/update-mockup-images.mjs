#!/usr/bin/env node
/**
 * 把 mockup CSS gradient 佔位換成真圖
 *
 * 跑完 gen-mockup-images.mjs 後執行：
 *   node scripts/update-mockup-images.mjs
 *
 * 處理：
 *  - et-char-1/2 → ./images/char-linye.jpg / char-monster.jpg
 *  - et-loc-1/2/3 → loc-alley-wide / loc-alley-end / loc-rune-ground
 *  - et-prop-1/2 → prop-lamp / prop-pistol
 *  - pc-1..5 home cover → cover-wucheng / shiguang / haidi / changan / yinxing
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IMG_DIR = join(ROOT, 'images');

// CSS class → image slug; 自動偵測 .jpg 或 .png
const SLUGS = {
  // ── 07/15 元素縮圖 ─────────────────────
  'et-char-1': 'char-linye',
  'et-char-2': 'char-monster',
  'et-loc-1':  'loc-alley-wide',
  'et-loc-2':  'loc-alley-end',
  'et-loc-3':  'loc-rune-ground',
  'et-prop-1': 'prop-lamp',
  'et-prop-2': 'prop-pistol',
  // ── 02 home 專案 cover ─────────────────
  'pc-1': 'cover-wucheng',
  'pc-2': 'cover-shiguang',
  'pc-3': 'cover-haidi',
  'pc-4': 'cover-changan',
  'pc-5': 'cover-yinxing',
  // ── 08/03 storyboard panel thumbnail (6 鏡 = 1 集分鏡)
  'pt-1': 'loc-alley-wide',   // 鏡 1：巷弄遠景開場
  'pt-2': 'char-linye',        // 鏡 2：林夜 close-up
  'pt-3': 'prop-lamp',         // 鏡 3：油燈特寫
  'pt-4': 'loc-alley-end',     // 鏡 4：巷弄盡頭
  'pt-5': 'char-monster',      // 鏡 5：怪物現身
  'pt-6': 'loc-rune-ground',   // 鏡 6：符文地面
  // ── 15 角色頁 cast list + appearance gallery
  'ct-linye':  'char-linye',
  'ct-guai':   'char-monster',
  // 5 個 appearance 都用 char-linye demo（不同造型版本需新生圖）
  'app-card':       'char-linye',
  'app-card alt-1': 'char-linye',
  'app-card alt-2': 'char-linye',
  'app-card alt-3': 'char-linye',
  'app-card alt-4': 'char-linye',
  // ── 16 場景頁 location list
  'ct-loc-1': 'loc-alley-wide',
  'ct-loc-2': 'loc-alley-end',
  'ct-loc-3': 'loc-rune-ground',
};
const REPLACE = {};
for (const [cls, slug] of Object.entries(SLUGS)) {
  if (existsSync(join(IMG_DIR, slug + '.jpg'))) REPLACE[cls] = slug + '.jpg';
  else if (existsSync(join(IMG_DIR, slug + '.png'))) REPLACE[cls] = slug + '.png';
}

function patchCss(css) {
  let changed = 0;
  for (const [cls, file] of Object.entries(REPLACE)) {
    if (!existsSync(join(IMG_DIR, file))) continue;
    // 找 .clsname { background: ... gradient ... } 整段，替換成 background-image + cover
    const re = new RegExp(
      `(\\.${cls}\\s*\\{[^}]*background)(\\s*:\\s*linear-gradient\\([^)]*\\)\\s*;?)([^}]*\\})`,
      'g',
    );
    css = css.replace(re, (m, before, _grad, after) => {
      changed++;
      return `${before}-image: url('./images/${file}'); background-size: cover; background-position: center;${after.includes('background') ? after : after}`;
    });
    // pc-1 .bg variant (project thumbs nested)
    const reNested = new RegExp(
      `(\\.${cls}\\s+\\.bg\\s*\\{[^}]*background)(\\s*:\\s*linear-gradient\\([^)]*\\)\\s*;?)([^}]*\\})`,
      'g',
    );
    css = css.replace(reNested, (m, before, _grad, after) => {
      changed++;
      return `${before}-image: url('./images/${file}'); background-size: cover; background-position: center;${after}`;
    });
  }
  return { css, changed };
}

async function run() {
  const files = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  let totalFiles = 0;
  let totalChanges = 0;
  for (const f of files) {
    const path = join(ROOT, f);
    const orig = await readFile(path, 'utf-8');
    const { css: patched, changed } = patchCss(orig);
    if (changed > 0) {
      await writeFile(path, patched);
      console.log(`  ✓ ${f}  (${changed} 處)`);
      totalFiles++;
      totalChanges += changed;
    }
  }
  console.log(`\n完成 ${totalFiles} 檔 / ${totalChanges} 處 CSS 替換`);
  console.log(`圖片來源：${IMG_DIR}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
