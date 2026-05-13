# Style Library Seed — 給 Claude Code 的執行指南

> 對應主文檔: `style-library-design-v3.md`
> 規模: 29 個視覺風格 + 8 個光影預設
> 變動: 在 v3 文檔的 28 風格基礎上加入「遊戲 CG」（F4），對應你截圖 UI 上既有的「遊戲 CG」按鈕

## 檔案清單

| 檔案 | 用途 | 執行順序 |
|------|------|---------|
| `01-schema.sql` | 4 張表的 DDL（visual_styles / lighting_presets / recommendations / elements）| Step 1 |
| `02-types.ts` | TypeScript 型別定義 | （被其他檔案 import）|
| `03-visual-styles.ts` | 29 個視覺風格 seed 資料 | Step 2 |
| `04-lighting-presets.ts` | 8 個光影預設 seed 資料 | Step 2 |
| `05-prompt-builder.ts` | Prompt 合成核心函數 + VOD/VCLM Request 組裝 | Step 3 |
| `06-thumbnail-prompts.md` | 給 Kling Image / Midjourney 用的範例圖生成 prompt | Step 4 |
| `test.ts` | 範例測試 | （可選）|

## 給 Claude Code 的執行步驟

### Step 1: 建表
```bash
psql -U <user> -d <db> -f 01-schema.sql
# 或 MySQL: 把 JSONB 改成 JSON 後執行
```

### Step 2: 把 seed 資料寫進 DB
寫一個 seed 腳本，從 `03-visual-styles.ts` 和 `04-lighting-presets.ts` 讀資料，INSERT 進對應的表。

範例（用 pg）:
```typescript
import { visualStyles } from './03-visual-styles';
import { lightingPresets } from './04-lighting-presets';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  for (const s of visualStyles) {
    await pool.query(
      `INSERT INTO visual_styles (
        id, name_zh, name_en, category, category_name_zh, thumbnail_url,
        style_anchor, visual_modifiers, negative_prompt,
        reference_artists, best_for_genres, recommended_kling_version,
        tags, display_order, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        name_zh = EXCLUDED.name_zh,
        style_anchor = EXCLUDED.style_anchor,
        visual_modifiers = EXCLUDED.visual_modifiers,
        negative_prompt = EXCLUDED.negative_prompt,
        updated_at = NOW()`,
      [
        s.id, s.nameZh, s.nameEn, s.category, s.categoryNameZh, s.thumbnailUrl,
        s.styleAnchor, s.visualModifiers, s.negativePrompt,
        JSON.stringify(s.referenceArtists), JSON.stringify(s.bestForGenres),
        s.recommendedKlingVersion, JSON.stringify(s.tags),
        s.displayOrder, s.isActive,
      ]
    );
  }

  for (const l of lightingPresets) {
    await pool.query(
      `INSERT INTO lighting_presets (
        id, name_zh, name_en, thumbnail_url,
        lighting_override, additional_negative,
        best_for_moods, tags, display_order, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        lighting_override = EXCLUDED.lighting_override,
        additional_negative = EXCLUDED.additional_negative`,
      [
        l.id, l.nameZh, l.nameEn, l.thumbnailUrl,
        l.lightingOverride, l.additionalNegative,
        JSON.stringify(l.bestForMoods), JSON.stringify(l.tags),
        l.displayOrder, l.isActive,
      ]
    );
  }

  console.log(`Seeded ${visualStyles.length} styles, ${lightingPresets.length} lightings`);
  await pool.end();
}

seed();
```

### Step 3: 整合 Prompt Builder 到 API

把 `05-prompt-builder.ts` 放進你的 API service。核心函數:

- `buildKlingPrompt(opts)` — 單鏡頭
- `buildShortDramaShots(opts)` — 多鏡頭短劇（每個 shot 自動重貼風格詞，防漂移）
- `buildVodAigcRequest(opts)` — 路徑 A（VOD）完整 request
- `buildVclmRequest(opts)` — 路徑 B（VCLM）完整 request

### Step 4: 跑範例圖生成

讀 `06-thumbnail-prompts.md`，把 29 個 prompt 餵給 Kling Image O1 或 Midjourney。

跑完後執行:
```sql
UPDATE visual_styles
SET thumbnail_url = 'https://your-cdn.com/style-thumbs/' || id || '.jpg'
WHERE id IN ('cinematic_realism', 'american_vertical_drama', ...);
```

## 注意事項

### 風格分類對照（圖 vs 你目前 UI）

| 你目前 UI 上的分類 | 對應到 v3 的分類 |
|------------------|----------------|
| 寫實與影視（3 個）| → A. 寫實影視（擴成 5 個）|
| 日系動漫（6 個）| → B. 日系動漫（保持 6 個，但 preset 內容有升級）|
| 國風（3 個）| → E. 國風（保持 3 個）|
| 韓漫（3 個）| → D. 韓系（保持 3 個，但拆出「韓劇浪漫」是影視非漫畫）|
| CG 與 3D（4 個，含遊戲 CG）| → F. CG/3D（保持 4 個）|
| 歐美與奇幻（2 個）| → C. 美漫西方插畫（擴成 5 個）+ G. 復古概念（3 個）|

### 為什麼舊的「賽博朋克 / 蒸汽朋克」從寫實類別搬到復古概念類別

你目前 UI 把它們放在「寫實與影視」下，但這兩個本質是**美學世界觀**，不是寫實。搬到 G. 復古/概念 更乾淨，也讓你有空間在寫實類別加入北美短劇、韓劇電影感、港片質感、紀錄片這些**真正的寫實風格**。

### Prompt Builder 的兩個關鍵設計

1. **每個 shot 都重貼完整風格詞**（在 `buildShortDramaShots` 裡叫 styleBible）
   - 原因: Kling 多鏡頭情況下，後面的鏡頭如果不重貼風格詞會 drift
   - 這是英文短劇研究界公認的「Style Bible」最佳實踐

2. **EnhancePrompt 預設關閉**（在 `buildVodAigcRequest` 裡寫死了 `'Disabled'`）
   - 原因: 騰訊 VOD 預設會幫你「優化」prompt，但這會把精心設計的風格詞改寫掉
   - 這幾乎可以肯定是 style drift 的元兇之一

## 驗證

跑這個就知道有沒有問題:
```bash
npm install --no-save typescript@5
./node_modules/.bin/tsc --target es2020 --module commonjs --esModuleInterop \
  02-types.ts 03-visual-styles.ts 04-lighting-presets.ts 05-prompt-builder.ts \
  test.ts --outDir dist
node dist/test.js
```

預期輸出:
```
=== Stats ===
{
  "total": 29,
  "byCategory": { "A": 5, "B": 6, "C": 5, "D": 3, "E": 3, "F": 4, "G": 3 }
}
...
✅ All tests passed.
```
