# Kling 3.0 / 騰訊 VOD AIGC — Anime 平台 Style 綁定研究文檔

> **目的**：解決 AI 動漫平台「各種 style 沒有綁定」的問題。
> **整合對象**：騰訊雲 VOD AIGC（`vod.tencentcloudapi.com`，API version `2018-07-17`）→ Kling 3.0
> **接口**：`CreateAigcVideoTask`
> **文檔來源**：https://cloud.tencent.com/document/product/266/126239（2026-05-11 更新版）
> **研究日期**：2026-05-12

---

## TL;DR — 三個立即可執行的修正

1. **`EnhancePrompt` 改為 `"Disabled"`** — 騰訊預設可能會幫你「優化」prompt，這會把精心設計的 anime 風格詞淡化掉，是 style 漂移最常見的元兇。
2. **改用 `SubjectInfos`（主體綁定）+ `FileInfos` with `Usage: "Reference"`（多參考圖）的雙保險** — 純 prompt 描述的 style 不會穩定，必須用視覺錨點綁定。
3. **每個 style preset 配一份獨立的 `NegativePrompt`** — 覆蓋掉預設的 `"blur, distort, and low quality"`，主動排除「會把 anime 拉向其他風格」的關鍵詞（例如 `3D render`、`photorealistic`）。

---

## 一、核心結論：Kling **沒有** style enum 參數

### 1.1 完整入參列表（從官方文檔逐字確認）

`CreateAigcVideoTask` 接受的所有欄位：

```
SubAppId, ModelName, ModelVersion, FileInfos, SubjectInfos,
LastFrameFileId, LastFrameUrl, Prompt, NegativePrompt,
EnhancePrompt, OutputConfig, InputRegion, SceneType,
Seed, SessionId, SessionContext, TasksPriority, ExtInfo
```

**沒有 `Style` / `StyleType` / `StylePreset` / `Aesthetic` 任何結構化的風格字段。**

這意味著：你不能用 `style: "anime"` 這種方式去鎖風格。風格必須透過下面 4 個維度組合鎖定：

| 鎖定維度 | 字段 | 強度 | 成本 |
|---------|------|------|------|
| 主體綁定（推薦） | `SubjectInfos` | ⭐⭐⭐⭐⭐ | 需預先註冊主體 |
| 參考圖 | `FileInfos` with `Usage: "Reference"` | ⭐⭐⭐⭐ | 需準備圖庫 |
| Prompt 風格詞 | `Prompt` | ⭐⭐ | 零成本 |
| 反向排除 | `NegativePrompt` | ⭐⭐⭐ | 零成本 |

### 1.2 為什麼不能只靠 Prompt

Kling 對純文字 style 描述的一致性不算頂級。多次生成同一個 prompt，風格會在「2.5D 厚塗 / 平面動漫 / 半寫實 / 偏 3D」之間漂移。這就是你現在遇到的「style 沒綁住」的根本原因。

---

## 二、官方文檔的 5 個關鍵發現

### 發現 1：`SubjectInfos` —— Kling 官方「Element Reference」的入口

**文檔原文**：
> `SubjectInfos.N | Array of AigcVideoTaskInputSubjectInfo | 主体输入信息。`

**意義**：這是 Kling 官方的「主體綁定 / Element Reference」功能在騰訊 VOD 包裝層的入口。Kling 官方文檔強調這個是「強制視覺一致性、完全消除 AI morphing」的關鍵能力。

**對 anime 平台的用法**：把每個 style preset 預先註冊成一個或多個「主體」，後續調用時直接帶 `SubjectInfos`，會比每次傳 reference 圖更穩、調用成本更低。

**待辦**：到 API Explorer 看 `AigcVideoTaskInputSubjectInfo` 的具體 schema，文檔頁面沒展開（連結：https://cloud.tencent.cn/document/api/266/31773#AigcVideoTaskInputSubjectInfo）。

---

### 發現 2：`FileInfos` 的 `Usage` 字段區分三種模式

**文檔原文**：
> 首尾帧视频生成：首帧图片只支持一张图片，图片的 **Usage 字段为 FirstFrame**...
> 参考图片生成：可传入单张图片或者多张，**图片的 Usage 字段为 Reference**；参考图片，**可以调整生成视频的宽高比例**。
> 视频编辑、视频参考：Vidu、Kling 可输入视频作为参考...

**對 anime style 的選擇**：
- 走 `Usage: "Reference"` 是首選（單張或多張都可以）
- 多張一起傳會強化 style 鎖定
- **注意**：傳了 Reference 圖會**自動覆蓋 AspectRatio**，你 OutputConfig 設的比例會被圖片實際比例蓋掉，所以參考圖的長寬比要先標準化

**圖片限制**：
- 大小 ≤ 10M（FileInfos）/ ≤ 5M（URL 模式）
- 格式：jpeg / jpg / png / webp

---

### 發現 3：`EnhancePrompt` 是雙刃劍 ⚠️

**文檔原文**：
> `EnhancePrompt | String | 是否自动优化提示词。开启时将自动优化传入的 Prompt，以提升生成质量。取值：Enabled / Disabled`

**對 anime 平台的判斷**：**設為 `Disabled`**。

**原因**：
- 你會精心構造「styleAnchor + 用戶內容 + visualModifiers」三段式 prompt
- 騰訊的 prompt 優化器是**通用**優化，主要為了真實感和清晰度
- 它很可能把你的 anime 風格詞「翻譯」或「淡化」成更通用的描述
- **這幾乎可以肯定是 style 漂移的元兇之一**

**這是一行設定就能拿回控制權的點，務必先檢查當前線上設定。**

---

### 發現 4：`SceneType` 對 Kling 的合法值

**文檔原文**：
> 當 ModelName 為 Kling 時：
> - `motion_control` 表示動作控制
> - `avatar_i2v` 表示數字人
> - `lip_sync` 表示對口型

**意義**：跟 style 無關，但這是 Kling 在 VOD endpoint 的能力地圖。一般 anime 視頻生成不需要設這個欄位。

---

### 發現 5：`ExtInfo` 是後門

**文檔原文**：
> `ExtInfo | String | 保留字段，特殊用途时使用。可用于传入模型特殊参数、分镜 prompt 等`

**意義**：自由文本欄位。如果 Kling 原廠 API（非 VOD 包裝）有更細的參數（例如 `camera_control` 的具體 type、`shot_type` 等），可以從 `ExtInfo` 偷渡進去。

**待辦**：向騰訊售前索取 `ExtInfo` 的 Kling 特殊參數文檔。Nathan 持有內部憑證，應該拿得到。

---

## 三、Model 支援矩陣（從文檔抄錄）

```
ModelName   | ModelVersion 合法值
------------+----------------------------------------------
Kling       | 1.6, 2.0, 2.1, 2.5, 2.6, O1, 3.0, 3.0-Omni
Hailuo      | 02, 2.3, 2.3-fast
Jimeng      | 3.0pro
Vidu        | q2, q2-pro, q2-turbo, q3, q3-pro, q3-turbo
GV          | 3.1, 3.1-fast
OS          | 2.0
Hunyuan     | 1.5
Mingmou     | 1.0
PixVerse    | v5.6, v6, c1
```

**對 anime 平台的建議**：
- 主力用 `Kling` + `3.0` 或 `3.0-Omni`（Omni 支援更強的多模態）
- 備選 `O1`（可灵的旗艦「大一統」模型，多模態能力強）
- 對 anime 特別強的還可以試 `Jimeng 3.0pro`（即夢，字節跳動的，動漫風格內建較強）

---

## 四、Style Preset 系統設計

### 4.1 資料結構

```typescript
interface AnimeStylePreset {
  // === 識別 ===
  id: string;                          // e.g. "ghibli", "shinkai", "90s_cel"
  displayName: string;                 // 給用戶看的，e.g. "宮崎駿風格"
  thumbnailUrl: string;                // 風格縮圖（給 UI 卡片用）

  // === Prompt 三件套 ===
  // 注入到 prompt 開頭的風格錨點
  styleAnchor: string;
  // 注入到 prompt 結尾的視覺修飾詞
  visualModifiers: string;
  // 完整覆蓋預設的 NegativePrompt
  negativePrompt: string;

  // === 視覺錨定（核心）===
  // 預先註冊的主體 ID（最強鎖定，需呼叫主體註冊接口取得）
  subjectIds: string[];
  // 參考圖 FileId 池（次強鎖定，可隨機抽 1-3 張）
  referenceFileIds: string[];

  // === Kling 調用參數 ===
  recommendedModelVersion: "3.0" | "3.0-Omni" | "O1";
  recommendedSeed?: number;            // 固定 seed 讓系列更一致

  // === 元數據 ===
  tags: string[];                      // ["2d", "hand-drawn", "warm"]
  createdAt: string;
  qualityScore?: number;               // 內部 A/B 測試後的綜合品質
}
```

### 4.2 Prompt 合成邏輯

```typescript
function buildKlingPrompt(userPrompt: string, preset: AnimeStylePreset): string {
  // 順序：風格錨點 → 用戶內容 → 視覺修飾詞
  // Kling 3.0 對結尾位置的 style 詞特別敏感，所以 visualModifiers 放最後
  return `${preset.styleAnchor}. ${userPrompt}. ${preset.visualModifiers}`;
}
```

### 4.3 完整調用範例

```typescript
async function generateAnimeVideo(
  userPrompt: string,
  preset: AnimeStylePreset,
  options?: { aspectRatio?: string; seed?: number }
) {
  // 隨機抽 1-3 張參考圖（避免過擬合到單張）
  const sampledRefs = sampleN(preset.referenceFileIds, Math.min(3, preset.referenceFileIds.length));

  return tencentVOD.CreateAigcVideoTask({
    SubAppId: YOUR_SUB_APP_ID,
    ModelName: "Kling",
    ModelVersion: preset.recommendedModelVersion,

    // ⭐ 主鎖：預註冊主體
    SubjectInfos: preset.subjectIds.map(id => ({ SubjectId: id })),

    // ⭐ 副鎖：參考圖
    FileInfos: sampledRefs.map(fileId => ({
      FileId: fileId,
      Usage: "Reference",
    })),

    // Prompt 三件套合成
    Prompt: buildKlingPrompt(userPrompt, preset),
    NegativePrompt: preset.negativePrompt,

    // ⚠️ 關鍵：關閉騰訊的 prompt 改寫
    EnhancePrompt: "Disabled",

    OutputConfig: {
      StorageMode: "Permanent",
      AspectRatio: options?.aspectRatio ?? "16:9",  // 傳 Reference 時可能被覆蓋
      AudioGeneration: "Disabled",
      InputComplianceCheck: "Enabled",
      OutputComplianceCheck: "Enabled",
    },

    // 固定 seed 提升系列一致性（讓同 style 的多次生成更像）
    Seed: options?.seed ?? preset.recommendedSeed,
  });
}
```

---

## 五、Anime Style Preset Starter Set（6 個常用風格）

> 以下是建議的初始 preset。`subjectIds` 和 `referenceFileIds` 需要你後續用 Kling 圖生圖生成樣張 + 註冊為主體後填入。

### Preset 1: `ghibli` — 宮崎駿 / 吉卜力風

```typescript
{
  id: "ghibli",
  displayName: "宮崎駿風格",
  styleAnchor: "Studio Ghibli anime style, hand-drawn 2D cel animation, soft watercolor backgrounds, Hayao Miyazaki aesthetic",
  visualModifiers: "warm pastel color palette, gentle natural lighting, lush detailed scenery, soft outlines, nostalgic atmosphere, traditional animation feel",
  negativePrompt: "3D render, CGI, photorealistic, realistic skin texture, live action, plastic, octane render, hyperrealistic, uncanny valley, blurry, distorted, low quality, harsh shadows, dark gritty",
  recommendedModelVersion: "3.0",
  tags: ["2d", "hand-drawn", "warm", "nostalgic"],
}
```

### Preset 2: `shinkai` — 新海誠風

```typescript
{
  id: "shinkai",
  displayName: "新海誠風格",
  styleAnchor: "Makoto Shinkai anime style, hyper-detailed anime, cinematic lighting, ultra-vivid skies",
  visualModifiers: "lens flare, god rays, volumetric lighting, photorealistic backgrounds with anime characters, saturated colors, cloud-heavy skies, golden hour atmosphere, sharp detail",
  negativePrompt: "3D render, CGI, flat colors, sketchy, unfinished, photorealistic humans, live action, plastic, distorted, low quality, muted colors, dull lighting",
  recommendedModelVersion: "3.0",
  tags: ["2d", "cinematic", "vibrant", "atmospheric"],
}
```

### Preset 3: `kyoani` — 京阿尼風（現代日常系）

```typescript
{
  id: "kyoani",
  displayName: "京阿尼風格",
  styleAnchor: "Kyoto Animation anime style, modern slice-of-life anime, clean line art, expressive character animation",
  visualModifiers: "soft natural lighting, detailed backgrounds, vibrant but balanced colors, smooth character movement, subtle facial expressions, glossy hair highlights",
  negativePrompt: "3D render, CGI, photorealistic, dark gritty, hyperrealistic, sketchy unfinished, plastic, distorted, low quality, exaggerated proportions",
  recommendedModelVersion: "3.0",
  tags: ["2d", "modern", "slice-of-life", "clean"],
}
```

### Preset 4: `cel_90s` — 90 年代賽璐璐風

```typescript
{
  id: "cel_90s",
  displayName: "90 年代賽璐璐",
  styleAnchor: "1990s anime style, traditional cel animation, retro Japanese animation aesthetic, vintage anime",
  visualModifiers: "limited color palette, visible cel shading, slight grain, analog warmth, hand-painted backgrounds, classic anime composition, nostalgic vibe",
  negativePrompt: "3D render, CGI, modern digital anime, photorealistic, ultra-smooth gradients, hyperrealistic, plastic, distorted, low quality, overly clean",
  recommendedModelVersion: "3.0",
  tags: ["2d", "retro", "cel-shading", "vintage"],
}
```

### Preset 5: `modern_thick_paint` — 現代日系厚塗

```typescript
{
  id: "modern_thick_paint",
  displayName: "現代日系厚塗",
  styleAnchor: "modern anime illustration, semi-realistic anime style, thick painted rendering, digital painting anime",
  visualModifiers: "rich color depth, soft brush strokes, painterly textures, dynamic lighting, detailed character rendering, anime portrait style",
  negativePrompt: "flat colors, cel shading only, sketchy lineart, 3D render, photorealistic humans, plastic, distorted, low quality, watercolor",
  recommendedModelVersion: "3.0-Omni",
  tags: ["2d", "semi-realistic", "painterly", "modern"],
}
```

### Preset 6: `cyberpunk_anime` — 賽博朋克動漫風

```typescript
{
  id: "cyberpunk_anime",
  displayName: "賽博朋克動漫",
  styleAnchor: "cyberpunk anime style, futuristic neon-lit anime, Akira-inspired aesthetic, neo-Tokyo vibes",
  visualModifiers: "neon lights, rain-soaked streets, holographic signs, dark moody atmosphere, electric blue and magenta palette, high contrast lighting, sci-fi anime",
  negativePrompt: "bright cheerful, daytime, pastoral, photorealistic, 3D CGI, plastic, distorted, low quality, low contrast, muted colors, rural",
  recommendedModelVersion: "3.0",
  tags: ["2d", "sci-fi", "neon", "dark"],
}
```

---

## 六、Reference Image 質量過濾管線

預先生成 reference image 時，用騰訊 `AssessQuality` 接口（`tiia.tencentcloudapi.com`）做質量過濾，避免低品質參考圖污染 style。

### 6.1 過濾標準

```typescript
function isAcceptableReference(quality: AssessQualityResponse): boolean {
  return (
    quality.ClarityScore >= 70 &&        // 清晰度門檻
    quality.AestheticScore >= 65 &&      // 美觀度門檻
    !quality.SmallImage &&               // 不能太小
    !quality.PureImage &&                // 不能太單調（純色/純文字）
    !quality.LongImage                   // 不能極端長寬比
  );
}
```

### 6.2 批量建構 reference pool

```typescript
async function buildReferenceImagePool(
  preset: AnimeStylePreset,
  targetCount = 10
): Promise<Array<{ fileId: string; scores: AssessQualityResponse }>> {
  const pool: Array<{ fileId: string; scores: AssessQualityResponse }> = [];
  let attempts = 0;
  const MAX_ATTEMPTS = 30;

  while (pool.length < targetCount && attempts < MAX_ATTEMPTS) {
    // 1. 用 Kling 圖生圖 (CreateAigcImageTask) 生 N 張
    const candidates = await tencentVOD.CreateAigcImageTask({
      SubAppId: YOUR_SUB_APP_ID,
      ModelName: "Kling",
      ModelVersion: "O1",
      Prompt: `${preset.styleAnchor}, character portrait, ${preset.visualModifiers}`,
      NegativePrompt: preset.negativePrompt,
      EnhancePrompt: "Disabled",
      // ... 其他必要參數
    });

    // 2. 跑 AssessQuality 過濾
    for (const img of candidates) {
      const quality = await tencentTIIA.AssessQuality({ ImageUrl: img.url });
      if (isAcceptableReference(quality)) {
        pool.push({ fileId: img.fileId, scores: quality });
      }
    }
    attempts++;
  }

  // 3. 按綜合分排序，取最好的 targetCount 張
  return pool
    .sort((a, b) =>
      (b.scores.ClarityScore + b.scores.AestheticScore) -
      (a.scores.ClarityScore + a.scores.AestheticScore)
    )
    .slice(0, targetCount);
}
```

### 6.3 用戶上傳參考圖的守門員

如果你的平台允許用戶上傳自己的參考圖（圖生視頻流程），上傳時先過質量檢查：

```typescript
async function validateUserReferenceImage(imageUrl: string) {
  const r = await tencentTIIA.AssessQuality({ ImageUrl: imageUrl });

  if (r.SmallImage) return { ok: false, reason: "圖片解析度太低，建議至少 512x512" };
  if (r.PureImage) return { ok: false, reason: "圖片內容過於單一，難以提取風格特徵" };
  if (r.LongImage) return { ok: false, reason: "圖片長寬比過於極端，建議裁切為接近方形或 16:9" };
  if (r.ClarityScore < 40) return { ok: false, reason: "圖片清晰度不足，可能影響生成質量" };

  return { ok: true, scores: r };
}
```

---

## 七、相關接口連結

| 接口 | 用途 | 文檔 |
|------|------|------|
| `CreateAigcVideoTask` | 生 AIGC 視頻（主接口） | https://cloud.tencent.com/document/product/266/126239 |
| `CreateAigcImageTask` | 生 AIGC 圖片（產 reference 用） | https://cloud.tencent.com/document/product/266/126240 |
| `AssessQuality` | 圖像質量評估（過濾參考圖） | https://cloud.tencent.com/document/api/865/36899 |
| `AigcVideoTaskInputSubjectInfo` schema | 主體輸入結構（重要待查） | https://cloud.tencent.cn/document/api/266/31773#AigcVideoTaskInputSubjectInfo |
| `AigcVideoOutputConfig` schema | 輸出配置結構 | https://cloud.tencent.cn/document/api/266/31773#AigcVideoOutputConfig |

---

## 八、實作優先順序（給 Claude Code 用）

### Phase 1：止血（立刻可做，0.5 天）

1. **檢查當前線上的 `EnhancePrompt` 設定，全部改為 `"Disabled"`**
2. **為現有的 style 補上一份獨立的 `NegativePrompt`**（從上面的 starter set 抄起來改）
3. **觀察 1-2 天，看 style 漂移是否減輕**

### Phase 2：建 Style Preset 系統（2-3 天）

4. 設計 `style_presets` 資料表，用上面的 TypeScript interface 當 schema
5. 把 6 個 starter preset 入庫
6. API 層加入 prompt 合成邏輯（styleAnchor + userPrompt + visualModifiers）
7. **此時不要動 SubjectInfos，先用純 prompt + NegativePrompt 看效果**

### Phase 3：參考圖鎖定（3-5 天）

8. 用 Kling 圖生圖批量為每個 preset 生 30-50 張候選 reference
9. 跑 `AssessQuality` 過濾，留下 5-10 張入 pool
10. 改寫調用邏輯加入 `FileInfos` with `Usage: "Reference"`
11. A/B 測試「純 prompt vs prompt + reference 圖」的 style 一致性

### Phase 4：主體綁定（最強鎖定，1-2 週）

12. **先打 API Explorer 查 `AigcVideoTaskInputSubjectInfo` 的具體 schema**
13. 找出主體註冊接口（可能是 `CreateSubject` 之類，文檔沒展開，需從 API Explorer 找）
14. 為每個 style 註冊 1-3 個主體
15. 改寫調用邏輯帶入 `SubjectInfos`
16. 這是終極解法，會比純 reference 圖更穩

### Phase 5：問騰訊售前（並行）

17. 索取 `ExtInfo` 的 Kling 特殊參數文檔（Nathan 有內部憑證）
18. 確認 Kling 3.0 / 3.0-Omni 在 VOD 包裝層支援哪些原廠 camera_control / shot_type 參數

---

## 九、已知的 Kling 行為（從研究中歸納）

- Kling **每次生成是獨立的**，prompt 不會自動延續上下文，所以 style 詞必須**每次都顯式包含**
- Kling 3.0 對「結尾位置」的 style 詞特別敏感（fal 官方建議的 prompt 結構：Scene → Characters → Action → Camera → **Style/Lighting**）
- Kling 3.0 引入了 **Element Binding**（facial consistency system），對應到 VOD 就是 `SubjectInfos`
- Kling 3.0 支援多達 6 個 shot 的 multi-shot generation，但這在 VOD 包裝層的暴露方式不明（可能要從 `ExtInfo` 傳分鏡 prompt）
- `Seed` 固定可以提升同一 style 系列的一致性，建議每個 preset 配一個 `recommendedSeed`

---

## 十、Nathan 的歷史技術上下文（保留）

從之前的研究累積：

- 端點：`vod.tencentcloudapi.com`，API version `2023-09-01`（注意：官方文檔顯示 VOD 的 API version 其實是 `2018-07-17`，Nathan 之前記的 `2023-09-01` 可能是別的 endpoint，需要確認）
- `SubAppId` 必填，即使有內部憑證也不能省（應用層級資源隔離）
- Kling `camera_control.type` 已知枚舉值：`simple`, `down_back`, `forward_up`, `right_turn_forward`, `left_turn_forward`（這是 Kling 原廠的，VOD 是否轉發、是否要從 `ExtInfo` 傳，需確認）
- `shot_type` 枚舉值：`customize`, `intelligent`（騰訊 VOD 文檔可能有 typo `intelligence`）
- 預設 `negative_prompt`：`"blur, distort, and low quality"`（2500 字符上限）

---

**文檔結束。下一步行動：Phase 1 立即執行，Phase 4 的主體綁定 schema 必須儘快查清楚。**
