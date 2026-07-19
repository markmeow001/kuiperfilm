# B0 Benchmark 準備件（Phase 1，AtlasCloud 單一路線）

> 日期：2026-07-19
> 母計畫：`2026-07-19-ai-live-action-reconstruction-v2.1.md` §6 / §9 Phase 1
> 狀態：**準備件 — 未獲付費批准，不觸發任何供應商請求**
> 通路：僅 `atlascloud::seedance-2.0-r2v`（Standard）與 `atlascloud::seedance-2.0-fast-r2v`（Fast）

## 0. 執行前提（全部打勾才可跑最小測試集）

- [ ] §6.4 政策閘門：AtlasCloud `reference_videos` 真人素材書面政策查核完成（見 §5，待調研回填）
- [ ] 測試素材演員授權書簽署（表演用於驅動 AI 角色，輸出不含本人肖像）
- [ ] 使用者明確批准付費測試（最小測試集預算見 §2）
- [ ] 兩組標準測試素材拍攝完成並入庫（見 §1）
- [ ] 首次提交同時作為上傳檢測層驗證：被拒即停，保存安全化錯誤與 request ID，不改寫繞過

## 1. 標準測試素材規格

兩組素材，各 10 秒、單人、綠幕或乾淨背景、固定機位、保留同期聲。

### 1.1 表情組（主素材，最小測試集用）

| 要求 | 規格 |
|---|---|
| 時長 | 10 秒 ±0.5s |
| 內容 | 必含：一句完整台詞（≥3 秒）、一次情緒轉折（平靜→爆發 或 哭轉笑）、一次明確眼神變化（視線轉移+眨眼） |
| 構圖 | 半身或七分身，臉部佔畫面高度 ≥15%，正面偏 3/4 角度 |
| 光線 | 均勻柔光，臉部無硬陰影 |
| 音訊 | 同期聲，台詞清晰 |
| 附加 | 另拍一條同表演的近景/特寫覆蓋（供擴充測試集 video 2 用，最小集不用） |

### 1.2 動作組（擴充測試集用）

10 秒：跳躍或轉身 ×1、快速手部動作、持替代道具（棍/劍形）完成一次揮動軌跡。全身入鏡。

## 2. 最小測試集（6 組）— 唯一先執行的付費範圍

固定用**表情組**素材；統一 **8 秒目標時長、480p**（最低成本共同基準）；每組 1 次提交。

| # | 模型 | 輸入策略 | 參考素材 |
|---|---|---|---|
| 1 | fast-r2v | 只有表演影片 | video 1 |
| 2 | fast-r2v | +角色圖 | video 1 + image 1-3（AI 角色三視角） |
| 3 | fast-r2v | +角色圖+背景概念圖 | video 1 + image 1-3 + image 6 |
| 4 | r2v | 只有表演影片 | video 1 |
| 5 | r2v | +角色圖 | video 1 + image 1-3 |
| 6 | r2v | +角色圖+背景概念圖 | video 1 + image 1-3 + image 6 |

**成本預估**（內部 pricing catalog，flat 為 5 秒基準包價；8 秒素材的實際供應商帳單是本測試要驗證的項目之一）：

- fast-r2v ×3 ≈ 3 × $0.38 = $1.14
- r2v ×3 ≈ 3 × $0.48 = $1.44
- **最小測試集預估合計 ≈ $2.58**（另備 1 次失敗重試預算 → 建議批 $5 上限）
- 附帶固定成本：AI 角色三視角圖 + 背景概念圖生成（走既有 image spine，~$0.2）

**達標判準**（任一組達到才有資格申請擴充集）：盲測 3 人中 ≥2 人能從輸出辨識出（a）情緒轉折時點、（b）口型節奏與台詞對應、（c）眼神變化——三項全中。

## 3. 擴充測試集（需另批預算，先列組數再執行）

前提：最小集達標 + 新一輪費用批准。逐項增量，**不做全排列**：

| 增量變因 | 新增組數 | 預估 |
|---|---|---|
| 動作組素材（複測最小集勝出配置 ×2 模型） | 2 | ~$0.86 |
| +臉部近景 video 2（勝出配置，表情組） | 2 | ~$0.86 |
| 素材順序變體（角色圖前置 vs 後置） | 2 | ~$0.86 |
| prompt 模板 B（見 §4.2） | 2 | ~$0.86 |
| 720p 複測勝出配置 | 2 | ~$0.86 |
| 1080p（僅 Standard，勝出配置） | 1 | ~$0.48+ |
| 完整 10 秒 + generate_audio 開關對照 | 2 | ~$0.96 |

每次擴充前更新本表：新增組數、單次預估、最高總預算。

## 4. Prompt 模板初稿

素材順序語法用 `video 1` / `image 1`（AtlasCloud 契約），禁用 `@Image1`。模板變數以 `{{ }}` 標示。

### 4.1 模板 A（基準 — 表演鎖定優先）

```
Use video 1 as the sole reference for performance timing, facial emotion,
gaze direction, lip movement, body motion, framing and camera movement.
Replace the performer completely with the character defined by {{image_range_character}}.
{{#if scene_image}}Use {{scene_image_ref}} as the visual reference for the environment,
lighting mood and color palette.{{/if}}
Preserve the exact order and timing of every action, expression change and
line delivery from video 1. Do not add new actions, do not change the shot
duration, do not retain the original performer's identity or clothing.
{{character_description}} {{scene_description}}
```

### 4.2 模板 B（擴充集 — 角色一致性優先）

```
The character in {{image_range_character}} is the only person in this video.
Their face, hair, body shape, outfit and weapon must match {{image_range_character}}
in every frame without drift.
Animate this character to perform exactly what the performer does in video 1:
same timing, same facial emotion transitions, same gaze changes, same lip
movements synchronized to the dialogue, same body motion.
{{#if scene_image}}Environment follows {{scene_image_ref}}.{{/if}}
Do not show the original performer. Do not alter shot length or camera language.
{{character_description}} {{scene_description}}
```

註：兩模板皆為「文字指令策略」，AtlasCloud 無數值權重欄位（v2.1 §2.2/§3.5）；UI 不得宣稱原生權重。

## 5. 政策查核紀錄（§6.4）— 2026-07-19 查核完成

> 查核範圍僅 AtlasCloud 自家發布內容；未以 ARK / fal / Kling 條款推論。原始 schema JSON 快照存 session scratchpad。

### 5.1 來源與關鍵引文（查核日 2026-07-19）

| # | 來源 | 關鍵內容 |
|---|---|---|
| S1 | atlascloud.ai/acceptable-use（主法務文件） | 禁止項僅列 illegal/adult/hate/malware；**對真人臉、肖像、deepfake、參考素材、上游政策全部沉默**。⚠️ 附帶：benchmark 結果**對外發布需事先書面同意**；內部測試明確允許 |
| S3 | atlascloud.ai/privacy（Legal Terms §8） | 上傳內容（Contribution）需保證「**you have written consent for identifiable persons**」+ 禁止 impersonation → 有書面授權的演員素材在合約層面過關 |
| S4 | atlascloud.ai/models/seedance2（模型頁 FAQ） | 「**No.** …the Seedance 2.0 series does not support directly uploading reference images **or videos** that contain real human faces… The model runs **face detection** on reference uploads and rejects photorealistic real faces」（歸因 ByteDance 上游，consent-blind） |
| S5 | blog: seedance-2-0-api-complete-guide | 「**Yes**, Atlas Cloud's version of Seedance 2.0 supports realistic human faces. The original Jimeng platform has restrictions, but **Atlas Cloud's API version does not have this limitation**」——**與 S4 直接矛盾** |
| S6 | blog: how-to-use-seedance-2.0 | 「Uploading realistic human faces (an anti-deepfake protection measure)… will be immediately rejected」——支持 S4 |
| S7 | schema CDN（兩個 r2v 模型） | `reference_videos` 只有格式/數量/15s 限制，**無任何政策語言、無 moderation 輸入欄位**；輸出側有 `has_nsfw_contents` |
| S8 | uncensored 模型頁 | Seedance 2.0 **不在**無過濾層（v1.5 Spicy 才是）→ 2.0 端點在管制層 |
| S9 | docs/billing/refunds | Seedance 2.x 按 token 計費**任務成功才扣款**，失敗自動釋放 hold → **被 face filter 拒的測試不產生費用** |

### 5.2 判定

- 合約層（條件允許）：S3 的 written-consent 條款 + 演員授權書可滿足
- **技術層（一手實測已解，2026-07-19）**：S10 使用者本人在 AtlasCloud Seedance 實測——**含真人臉的參考素材不需綁定人物即可正常送出**，未被上傳檢測層攔截。S4/S6（模型頁 FAQ 稱有臉偵測）與實際 API 行為不符；S5（blog 稱 API 版無此限制）與實測一致。→ 上傳可行性不再是阻斷項。
- 上游穿透：AtlasCloud 從未正式聲明 ByteDance 政策是否適用其 API 流量——書面確認仍要發，目的從「可行性」轉為**政策/條款護身**（避免日後條款收緊或帳號風險時無書面依據）
- 財務風險低：S9 → 任務失敗不扣款
- ⚠️ 新約束入計畫：**benchmark 結果不得對外發布**（除非取得書面同意）——內測/內部報告 OK

**結論：技術阻斷解除，B0 付費 benchmark 的前提只剩（1）確認函發出（政策護身，不阻斷）、（2）素材+授權書、（3）付費批准。**

### 5.3 待辦

- [x] 書面確認函 → support@atlascloud.ai（cc sales@atlascloud.ai）——**已由使用者發出（2026-07-19）**
- [ ] 收到回覆後把結論回填此處 + 更新 §0 前提勾選

**書面確認函定稿（英文，發 support@atlascloud.ai，cc sales@atlascloud.ai）**：

> Subject: Policy confirmation — real-person performance footage as reference_videos for Seedance 2.0 R2V
>
> We are building a performance-driven character re-rendering product on your
> Seedance 2.0 R2V endpoints (`bytedance/seedance-2.0/reference-to-video` and
> `bytedance/seedance-2.0-fast/reference-to-video`). Our use case:
> `reference_videos` contains performance footage of a professional actor who
> has given written consent; the generated output replaces the actor's identity
> entirely with a fictional AI character — no real person's likeness appears in
> the output. We hold written releases from all performers.
>
> Please confirm in writing:
> 1. Is there an upload-side face-detection filter that rejects
>    `reference_videos` containing real human faces on these two models? Your
>    model page FAQ (atlascloud.ai/models/seedance2) says yes; your blog post
>    (seedance-2-0-api-complete-guide) says the Atlas Cloud API version "does
>    not have this limitation." Which is authoritative today?
> 2. Do ByteDance/Volcengine/BytePlus upstream content policies apply to
>    requests routed through Atlas Cloud, or does Atlas Cloud serve these
>    models under its own policy only?
> 3. Is our use case permitted under your Acceptable Use Policy and Legal
>    Terms? Is written actor consent (per your "written consent for
>    identifiable persons" warranty) sufficient?
> 4. If an upload-side face filter exists, is there an enterprise/verified
>    pathway (consent attestation, identity authorization) to submit consented
>    real-person reference footage?
> 5. If a task is rejected by content moderation (input or output), is the
>    billing hold always released in full for Seedance 2.x token-billed tasks?
> 6. Does repeated triggering of the face filter risk account suspension, or
>    is a moderation rejection treated as a normal failed task?
> 7. Please confirm an internal benchmark of Seedance 2.0 R2V is permitted,
>    and what "prior written consent" process applies if we later wish to
>    publish comparative results.
>
> We are happy to share our consent-form template and product description.

## 6. 盲測評分表（每組輸出一份）

評分人不知模型/配置；對照原始表演影片並排看。1–5 分（3=可辨識但有缺陷，4=可交付）。

| # | 維度 | 分數 | 備註 |
|---|---|---|---|
| 1 | 表情與情緒保真（轉折時點可辨識？） | | |
| 2 | 口型與音訊同步 | | |
| 3 | 眼神、眨眼與頭部方向 | | |
| 4 | 身體動作時間誤差 | | |
| 5 | 道具/武器軌跡（動作組） | | |
| 6 | AI 角色身份一致性（幀間漂移） | | |
| 7 | 服裝/妝容/配件穩定性 | | |
| 8 | 背景、透視與攝影機一致性 | | |
| 9 | 閃爍/破臉/手部錯誤/額外肢體（有=直接 ≤2） | | |

任務級記錄（非盲測）：成功率、提交→完成耗時、供應商實際帳單、每可採用秒成本（= 實際帳單 ÷ 盲測≥4分的秒數）。

## 7. 產出物清單（Phase 1 完成定義）

- [ ] 本文件 §5 政策查核回填 + 確認函已發出（或已獲回覆）
- [ ] 兩組素材入庫（asset ID 登記於此）
- [ ] 6 組最小集結果 + 評分表 + 成本實錄
- [ ] 勝出配置與 prompt 模板定稿 → 回寫 v2.1 §3.5
- [ ] 達標判定：通過 → 申請 Phase 2 開工；未達標 → 停在研究狀態（v2.1 §11 紅線）
