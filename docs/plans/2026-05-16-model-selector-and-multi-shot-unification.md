# Model Selector + Multi-Shot Unification Plan

**Date**: 2026-05-16
**Status**: Draft — pending product decision on Open Question 1 + 2
**Owner**: TBD
**Related memory**: `project_kuiperfilm_taijiai_seedance_blocked`, `project_kuiperfilm_fal_seedance_kling_backup`, `project_kuiperfilm_multi_user_inheritance`, `project_kuiperfilm_b_path_fixes`
**Related code**: `src/lib/generators/{ark,fal,video/taijiai,video/tencent-vod}.ts`, `src/lib/workers/handlers/multi-shot-video-{handler,b-path}.ts`, `src/lib/model-config-contract.ts`, `prisma/schema.prisma:330` (`NovelPromotionProject.videoModel`)

---

## 1. Context

Three problems converged 2026-05-16:

1. **Seedance 2.0 接入** — 主路徑 BobAPI (`taijiai::seedance-2.0-720p`) commit `5438bf8` 已 ship、被供應商 token 擋;備援 fal (`fal::bytedance/seedance-2.0/image-to-video`) commit `3b737c6` 已 ship、未 deploy。第三條 Kling Omni via Tencent VOD 一直是主力。
2. **多鏡頭模式 Kling 獨家** — `multi-shot-video-b-path.ts` (2,500+ 行) 圍繞 Kling Omni `multi_prompt[]` + `SubjectInfos` 設計,Seedance 沒對應 API。
3. **Admin-cascade 模型選擇** — 目前所有 user 繼承 admin 在 `/profile` 的模型設定(`project_kuiperfilm_multi_user_inheritance`)。User 想讓非 admin 也能在製作端切模型,不必回設定頁。

技術澄清(2026-05-16 重新比對 fal docs):**Seedance 其實有多鏡頭能力**,只是透過自然語言驅動(prompt 寫 "Shot 1: ... Cut to shot 2: ...")而非結構化陣列。跨鏡角色一致性透過 reference image + `@N` / `[Image1]` 引用達成。能力**對等但 paradigm 不同**,不是「沒有」。

## 2. Goals

- 在製作端(storyboard / panel editor)加 video model 下拉選單,user 可改自己當前 project 的 videoModel,不必回 `/profile`
- 多鏡頭按鈕對所有 model 都可按(Kling 走 native multi_prompt,Seedance 走 prompt 拼接)
- Provider-specific UI 變動(每鏡長度精細控制 / 真人審核 toggle)用 capability metadata 驅動,UI 不灑 `if (model === 'X')`
- 保留 admin-cascade 作為 fallback — user 沒主動選就繼承 admin

## 3. Non-Goals

- 不做自動 fallback(主 model 失敗自動切備援)— 違反 CLAUDE.md「不隱式回退」鐵則
- 不重設計多鏡頭 UI 成全新「序列模式」— 方案 Z 棄
- 不開放 task 級 override(每次按生成都選一次)— project 級已夠用,UX 不複雜化
- 不接 fal Seedance 1.0(已有 ARK 1.0/1.5 + AtlasCloud,3 條路徑冗餘)
- 不接 BobAPI Kling(Tencent VOD Kling Omni + fal Kling 已涵蓋)

## 4. Decision Summary

| 議題 | 方案 | 理由 |
|---|---|---|
| 多鏡頭跨 provider 策略 | **方案 X**:統一 UI,worker 內 transform | UX 一致,新 provider 加 entry 即可 |
| 模型選擇歸屬層級 | **project 級** | `NovelPromotionProject.videoModel` 欄位已存在(`schema.prisma:330`),只缺 UI |
| 每鏡長度精細控制(Seedance) | **灰掉 + tooltip** | 不藏能力,告訴 user 為什麼選不到 |
| 真人審核 toggle 顯示時機 | **per-model capability flag** | 只 `taijiai::seedance-2.0-720p` 顯示,Kling/fal 都不顯示 |
| Admin-cascade 處理 | **overlay,不拆** | User 沒選 → 繼承 admin;一旦選了 → 寫入 `videoModel` |

## 5. Capability Metadata Schema

### 5.1 擴充 `VideoCapabilities`

`src/lib/model-config-contract.ts:39-50` 加新欄位(全 optional,既有 model 不動):

```ts
export interface VideoCapabilities {
  // ── existing fields ──
  generationModeOptions?: string[]
  generateAudioOptions?: boolean[]
  durationOptions?: number[]
  fpsOptions?: number[]
  resolutionOptions?: string[]
  firstlastframe?: boolean
  supportGenerateAudio?: boolean
  supportNegativePrompt?: boolean
  supportReferenceImage?: boolean
  fieldI18n?: CapabilityFieldI18nMap

  // ── new (this plan) ──

  /** Native multi-shot support — does ONE API call produce a multi-shot video? */
  multiShot?: {
    /** true = native (Kling multi_prompt[]); false = simulated via prompt concat (Seedance) */
    native: boolean
    /** 'multi-prompt-array' | 'concat-prompt' | 'fan-out' */
    transform: 'multi-prompt-array' | 'concat-prompt' | 'fan-out'
    /** Max shots per single call (Kling Omni = 15s budget ≈ 5 shots; Seedance soft limit) */
    maxShotsPerCall?: number
  }

  /** Per-shot duration control (Kling customize mode). False = user can't pin per-shot seconds. */
  perShotDuration?: boolean

  /** Cross-shot character consistency mechanism */
  characterBinding?:
    | 'subject-infos'   // Kling: structured SubjectInfos[] with [#0] [#1] refs
    | 'reference-image' // Seedance: content[] reference_image with @N / [Image1] refs
    | null              // not supported

  /** Real-person review required flag (BobAPI 真人審核, ~10min, can fail). When true,
   *  UI must surface a "this image contains a real person" toggle on reference images. */
  personReviewFlag?: boolean

  /** Native synchronised audio (Seedance 2.0 generate_audio). Distinct from supportGenerateAudio
   *  which is the legacy flag — keep both during migration, deprecate old later. */
  nativeAudio?: boolean
}
```

### 5.2 Per-Model Catalog Entries

新增 `src/lib/capabilities/video-catalog.ts`(或併入既有 catalog 檔案):

```ts
export const VIDEO_CAPABILITY_CATALOG: Record<string, VideoCapabilities> = {
  // ── Kling Omni via Tencent VOD ──
  'tencent-vod::Kling-3.0-Omni': {
    multiShot: { native: true, transform: 'multi-prompt-array', maxShotsPerCall: 5 },
    perShotDuration: true,
    characterBinding: 'subject-infos',
    personReviewFlag: false,
    nativeAudio: false,
    durationOptions: [5, 10, 15],
    resolutionOptions: ['720p'],
    firstlastframe: false,
  },
  'tencent-vod::Kling-3.0': {
    multiShot: { native: true, transform: 'multi-prompt-array', maxShotsPerCall: 5 },
    perShotDuration: true,
    characterBinding: 'subject-infos',
    personReviewFlag: false,
    nativeAudio: false,
    durationOptions: [5, 10],
    resolutionOptions: ['720p'],
  },

  // ── Seedance 2.0 via BobAPI ──
  'taijiai::seedance-2.0-720p': {
    multiShot: { native: false, transform: 'concat-prompt', maxShotsPerCall: 4 },
    perShotDuration: false,
    characterBinding: 'reference-image',
    personReviewFlag: true,  // ← 真人審核 toggle 顯示
    nativeAudio: true,
    durationOptions: [4, 5, 8, 10, 12, 15],
    resolutionOptions: ['720p'],
    firstlastframe: true,
  },

  // ── Seedance 2.0 via fal ──
  'fal::bytedance/seedance-2.0/image-to-video': {
    multiShot: { native: false, transform: 'concat-prompt', maxShotsPerCall: 4 },
    perShotDuration: false,
    characterBinding: 'reference-image',
    personReviewFlag: false,  // ← fal 沒文件提到真人審核
    nativeAudio: true,
    durationOptions: [4, 5, 8, 10, 12, 15],
    resolutionOptions: ['480p', '720p', '1080p'],
    firstlastframe: true,
  },
  'fal::bytedance/seedance-2.0/fast/image-to-video': {
    multiShot: { native: false, transform: 'concat-prompt', maxShotsPerCall: 4 },
    perShotDuration: false,
    characterBinding: 'reference-image',
    personReviewFlag: false,
    nativeAudio: true,
    durationOptions: [4, 5, 8, 10, 12, 15],
    resolutionOptions: ['480p', '720p'],
    firstlastframe: true,
  },

  // ── 既有 fal Kling / Wan / Veo / Sora 沿用 single-shot 預設 ──
  // (multiShot undefined → UI 視為單鏡頭 only)
}
```

### 5.3 Helper

`src/lib/capabilities/resolve-video-capability.ts`(新):

```ts
export function resolveVideoCapability(modelKey: string): VideoCapabilities {
  return VIDEO_CAPABILITY_CATALOG[modelKey] ?? DEFAULT_SINGLE_SHOT_CAPABILITY
}

const DEFAULT_SINGLE_SHOT_CAPABILITY: VideoCapabilities = {
  multiShot: undefined,       // not advertised → UI 不顯示多鏡頭模式
  perShotDuration: false,
  characterBinding: null,
  personReviewFlag: false,
  nativeAudio: false,
}
```

## 6. Architecture

### 6.1 Model resolution (4-tier cascade)

讀視頻 model 時依序:

1. **Task-level override**(payload `videoModel`,Task 級短期 override,僅當 caller 顯式傳入時)
2. **Project-level**(`NovelPromotionProject.videoModel`,user 在製作端 dropdown 選的)
3. **User-level**(`User.customProviders` JSON 的 default video model,如果有)
4. **Admin fallback**(`applyAdminFallbackToNovelPromotionProject` helper,既有邏輯)

新 helper:`src/lib/run-runtime/resolve-video-model.ts`,所有 worker 入口統一走這支,移除四處散落的 fallback 邏輯。

### 6.2 Storage

- **無 schema change** — 沿用既有 `NovelPromotionProject.videoModel String?`
- 既有的 NULL value = 「未設定,走 admin fallback」(維持當前行為)
- User 在 dropdown 選了之後,API `PATCH /api/projects/[id]` 寫入 `videoModel` 欄位
- User 在 dropdown 選「回到預設(admin)」會把欄位寫回 NULL

### 6.3 UI components

#### 6.3.1 Model selector dropdown(新元件)

位置:V2 storyboard 工具列(`V2StoryboardClient.tsx` 附近),或專案頂部 sticky bar

```
┌─────────────────────────────────────────────────────────┐
│ 視頻模型:[Seedance 2.0 (fal · audio)              ▼]  │
│           ├─ ⚡ Kling Omni 3.0 (Tencent · 多鏡頭)        │
│           ├─ ⚡ Kling 3 (Tencent)                       │
│           ├─ ⓘ Seedance 2.0 (BobAPI · 720p)            │
│           ├─ ⓘ Seedance 2.0 (fal · audio · 推薦)       │
│           ├─ ⓘ Seedance 2.0 Fast (fal · cheap)         │
│           └─ ↺ 回到管理員預設                          │
└─────────────────────────────────────────────────────────┘
```

- ⚡ = native 多鏡頭支援,ⓘ = 模擬 multi-shot,↺ = 清除 override
- Disabled 選項顯示 + tooltip(例如 user 沒填 fal key 時 fal 系列 disabled)
- 列表只顯示**該 user 有 provider key 的 model**(沿用既有 `enabledModelsByType`)

#### 6.3.2 多鏡頭模式區塊(條件渲染)

```
當 capability.multiShot 存在:
  ┌─ 多鏡頭模式 ────────────────────────┐
  │ ○ 智慧模式(model 自己決定切點)     │   ← Kling intelligence
  │ ● 自訂模式                          │   ← Kling customize
  │   每鏡時長:5s ─────●──── 15s        │   ← 此 row 受 perShotDuration 控制
  │   (此模型不支持每鏡長度精細控制,    │      Seedance 時:row 灰掉 + tooltip
  │    將以總長度由 model 自動分配)     │
  └─────────────────────────────────────┘

當 capability.multiShot undefined:
  整塊 hide(原本就只有單鏡頭路徑)
```

#### 6.3.3 角色參考圖上傳(條件渲染)

每張角色 reference image 旁加:

```
┌──────────────────────┐
│  [character_ref.png] │
│  ☐ 此圖含真人面孔     │  ← 只有 capability.personReviewFlag=true 時顯示
│                      │     (即 taijiai::seedance-2.0-720p)
│  ⓘ 勾選後需審核 10   │     tooltip 解釋為什麼
│    分鐘,可能失敗     │
└──────────────────────┘
```

UI state → payload `isPersonReference: boolean` → generator's `subject_type: 'person' | 'generic'`

#### 6.3.4 Capability hint card(全局)

切換 model 後在頂部顯示 5 秒 toast:

```
已切換到 Seedance 2.0 (fal)。能力差異:
✓ 原生音訊        ✗ 每鏡時長精細控制(將自動分配)
✓ 1080p 解析度    ⓘ 多鏡頭品質依 model 詮釋,效果可能不一
```

從 capability 自動生成,不寫死文案。

### 6.4 Worker changes(`multi-shot-video-b-path.ts`)

當前 b-path 假設都是 Kling。要加 dispatch:

```ts
// pseudo
async function runMultiShotBPath(ctx) {
  const cap = resolveVideoCapability(ctx.videoModel)
  if (!cap.multiShot) throw new Error('MULTI_SHOT_NOT_SUPPORTED')

  switch (cap.multiShot.transform) {
    case 'multi-prompt-array':
      return runKlingMultiPrompt(ctx)        // 既有路徑,不動
    case 'concat-prompt':
      return runSeedanceConcatPrompt(ctx)    // 新增
    case 'fan-out':
      return runFanOutSingleShots(ctx)       // 預留(未用)
  }
}
```

`runSeedanceConcatPrompt(ctx)`:

1. 收 `ctx.panels[]`(每個有 prompt + 角色 ref + 可選首尾幀)
2. 拼接 prompt:`"Shot 1: ${p1.prompt}. Cut to shot 2: ${p2.prompt}. ..."`
3. 收集所有獨特角色 ref image → 塞入 `content[]` reference_image
4. 改寫 prompt 內角色名稱為 `@1`(BobAPI)或 `[Image1]`(fal)
5. 算總 duration = Σ panel.duration,clamp 4-15
6. 調 `TaijiaiSeedanceVideoGenerator` 或 `FalVideoGenerator`(provider 路由)
7. 回傳一個 video URL(同 Kling 行為)

### 6.5 API changes

`PATCH /api/projects/[id]`(既有路由,擴充):

```json
// request
{ "videoModel": "fal::bytedance/seedance-2.0/image-to-video" }
// or
{ "videoModel": null }   // 清除 override,回到 admin fallback
```

`GET /api/projects/[id]/available-models`(新):

```json
// response
{
  "models": [
    {
      "modelKey": "tencent-vod::Kling-3.0-Omni",
      "label": "Kling Omni 3.0",
      "enabled": true,
      "capabilities": { "multiShot": {...}, "personReviewFlag": false, ... }
    },
    ...
  ],
  "currentSelection": "fal::bytedance/seedance-2.0/image-to-video",
  "isAdminFallback": false
}
```

`enabled: false` 時附帶 reason(`"no_api_key" | "admin_disabled"`),UI 用來灰掉 + tooltip。

## 7. Migration & Backward Compatibility

- 既有 project 的 `videoModel = NULL` → 行為不變(走 admin fallback)
- 既有單鏡頭 / 多鏡頭 task → 行為不變(capability resolver 對應 model 已有 entry)
- Admin 在 `/profile` 改 default → 仍 cascade 到所有沒 override 的 user
- 既有 `multi-shot-video-b-path.ts` Kling 路徑 → 零改動(只是現在被 dispatch 包了一層)
- 既有 capability catalog 新增欄位皆 optional,沒填的 model 走 `DEFAULT_SINGLE_SHOT_CAPABILITY`

## 8. Phased Rollout

### Phase 1 — Capability metadata 基建(0.5 天)
- 擴充 `VideoCapabilities` interface(`src/lib/model-config-contract.ts`)
- 新增 `VIDEO_CAPABILITY_CATALOG`(覆蓋現有 Kling/Seedance 6 個 model)
- `resolveVideoCapability(modelKey)` helper
- 單元測試 catalog 對所有 model 有 entry + helper 預設值

### Phase 2 — Backend model resolution + API(0.5 天)
- `resolve-video-model.ts` 4-tier helper(取代散落 fallback)
- `GET /api/projects/[id]/available-models`(回傳 enabled models + currentSelection)
- `PATCH /api/projects/[id]` 接受 `videoModel` 欄位
- Worker 入口換用新 resolver(grep "videoModel" 全改)
- 整合測試:cascade 4 層、PATCH 寫入、PATCH null 清除

### Phase 3 — UI Model selector(1 天)
- 新元件 `VideoModelSelector.tsx`(下拉 + ⚡/ⓘ 圖示 + ↺ 重設)
- 嵌入 V2 storyboard 工具列
- 對接 `available-models` API + `PATCH`
- 切換後 toast 顯示能力差異
- Playwright E2E:user 切 model → 確認 PATCH 寫入 → 確認下次重整還在

### Phase 4 — 多鏡頭 worker 統一(1.5 天,最大塊)
- `runMultiShotBPath` 加 dispatch by transform
- 新增 `runSeedanceConcatPrompt(ctx)` — prompt 拼接 + 角色引用映射 + provider 路由
- 角色引用映射:Kling `[#N]` ↔ Seedance `@N` / `[ImageN]`
- 處理 maxShotsPerCall 超出時的 fallback(分批?還是 reject?待產品決定)
- 單元測試 transform 正確性
- E2E:同一專案 5 panel → Kling 跑通 + 切 Seedance 跑通,結果都是一個多鏡頭 video URL

### Phase 5 — UI conditional 渲染(0.5 天)
- 多鏡頭區塊讀 `capability.multiShot` 顯示/隱藏
- 「每鏡長度」row 讀 `capability.perShotDuration` 灰掉 + tooltip
- 角色 ref 圖加「此圖含真人面孔」toggle(讀 `capability.personReviewFlag`)
- Capability hint toast

### Phase 6 — 真人審核 UX 完整化(0.5 天)
- `isPersonReference` 從 UI 一路傳到 BobAPI generator
- 任務 progress UI 加「審核中」狀態(預期 10 分鐘)
- 失敗時友善錯誤訊息(對應「真人过白审核不通过」)

**總估時:4.5 天**(假設 1 人全職、沒中斷)

### 階段 Gate 點

- Phase 1-2 可獨立 ship(只是後端基建,不破壞既有 UX)
- Phase 3 ship 後 user 即可切 model,但多鏡頭 + Seedance 還是會走 single-shot fallback
- Phase 4 ship 後多鏡頭跨 provider 正式可用
- Phase 5-6 是 polish,可分批 ship

## 9. Edge Cases Checklist

| 場景 | 行為 | 備註 |
|---|---|---|
| User 切到 fal 但沒填 fal key | dropdown 選項 disabled + tooltip「請先到 /profile 填 fal API key」 | enabled=false reason=no_api_key |
| Admin 改 default 到一個 user 沒 key 的 model | User UI 提示「管理員切換到 X,你尚未配置該模型,生成將失敗」 | 不自動跳回備援 |
| 多鏡頭 Kling 跑到一半,user 改成 Seedance | 在跑的任務不受影響;下個任務用新 model | model 在 dispatch 時決定,task 內 immutable |
| 多鏡頭 panel 數 > maxShotsPerCall | reject 並提示用戶分批 | 不自動分批(維持顯式行為) |
| `videoModel` 寫入無效 key(打字錯/被刪) | resolver 退回 admin fallback + log warning | capability catalog 查不到 → fallback |
| Admin 改 admin password / customProviders | 既有 cascade 行為不變,user override 仍生效 | |
| User 同時在兩個專案,改 A 專案 model | 只影響 A,B 不變 | project 級隔離 |
| Capability catalog 沒涵蓋的新 model | 走 DEFAULT_SINGLE_SHOT_CAPABILITY,只能單鏡頭 | guardrail,逼工程師補 catalog |
| BobAPI Seedance personReviewFlag=true,但圖其實不是真人 | 仍走 10 分鐘審核(BobAPI 不會判斷) | UI 用 tooltip 警告 user |
| fal Seedance prompt 拼接超 `maxShotsPerCall` | reject(同 Kling 行為) | 一致性 |
| Seedance multi-shot 跑出來品質爛 | 用戶看了直接切回 Kling,UX 無痛 | 這是方案 X 的押注 |
| User 第一次進專案,videoModel=NULL,admin 也 NULL | 提示「請先到 /profile 設定模型」並阻擋生成 | 既有行為 |
| Project 設 Seedance 後 admin 把 Seedance model 從 catalog 移除 | resolver fallback 到 admin default;UI 提示 model 已不可用 | |
| 多鏡頭 Seedance 拼接 prompt 超出 model token 上限 | 截斷 + warning,或 reject(待產品決定) | Open Q3 |

## 10. Open Questions(待 user 拍板)

1. **Seedance 多鏡頭品質是否驗證後再決定 Phase 4 啟動?**
   - 推薦:Phase 4 開工前先用 Playwright + fal key(等 user 拿到)跑 3-5 個多鏡頭測試。品質爛 → Phase 4 改成「方案 Y:Seedance only 單鏡頭」,大幅省工。
2. **maxShotsPerCall 超出時行為**
   - (a) Reject(維持顯式 / 教育 user)
   - (b) 自動分批(server side stitch 我們不做,所以拆成多 task 還是會多個 video)
   - 推薦 (a)
3. **Seedance 拼接 prompt 超出 model 文字上限**
   - 截斷尾端 / reject / 不檢查讓 model 自己處理
   - 推薦先不檢查、上線觀察是否真的撞到(BobAPI/fal 都沒明文 prompt 上限)
4. **Task 級 override 要不要做**
   - 本 plan 寫的 4-tier cascade 含 task-level,但 UI 不暴露(只支援 project-level)。需要時加一顆「這次生成用其他 model」按鈕即可,但會增加 UX 複雜度。
   - 推薦先不做,project 級夠用
5. **真人審核 toggle 預設值**
   - 預設關 vs 預設開
   - 推薦預設關(避免無辜任務多等 10 分鐘),tooltip 解釋

## 11. Out of Scope

- 自動 fallback(主 model 失敗 → 切備援):違反鐵則,不做
- Server-side stitch(多 task video → 接成一個):用戶在 CapCut 自接(沿用既有設計)
- Task 級 override UI(見 Open Q4)
- Image / LLM model 切換(本 plan 只動 video)
- Admin 限制特定 user 能用哪些 model 的 ACL:後續再說
- Cost / quota 估算與顯示:`project_kuiperfilm_tencent_concurrency` 已有 ticket
- Worker 層 capability validation guard(防 worker 收到能力不對的 task):Phase 7 polish

## 12. Test Plan

### Unit
- `resolveVideoCapability(unknown_key)` 回傳 DEFAULT
- `resolveVideoCapability('tencent-vod::Kling-3.0-Omni').multiShot.native === true`
- `resolveVideoCapability('taijiai::seedance-2.0-720p').personReviewFlag === true`
- 4-tier resolver:task → project → user → admin,每層 NULL 落下一層
- Seedance prompt 拼接:5 panel → 「Shot 1: ... Cut to shot 2: ...」
- 角色引用映射:`[#0]` ↔ `@1` 雙向

### Integration
- `PATCH /api/projects/[id] {videoModel: "X"}` 寫入 DB
- `PATCH /api/projects/[id] {videoModel: null}` 清空
- `GET /api/projects/[id]/available-models` 過濾 user 沒 key 的 model
- Worker 收到 task 走正確 transform path

### E2E (Playwright)
- 切 model dropdown → API call → reload 後保留
- Kling 多鏡頭(既有)→ video 產出
- Seedance 多鏡頭(新)→ video 產出,內容含 cuts
- User 沒 fal key → fal 系列 dropdown disabled,選不到
- 真人 toggle 勾選 → payload `isPersonReference: true` → BobAPI generator 帶 `subject_type: 'person'`

### Manual QA
- Kling multi-shot 跨 user 一致性
- Seedance multi-shot 角色臉部跨鏡漂移程度(主觀打分 1-5)
- 真人審核 happy path + 過審失敗時的錯誤訊息可讀性
- 切 model toast 顯示能力差異

## 13. Risk Register

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| Seedance 多鏡頭品質爛 → 用戶選了就罵 | 中 | 中 | Phase 4 開工前先 spike;爛 → 退方案 Y |
| 改 b-path 既有 Kling 路徑時 break 多鏡頭 | 低-中 | **高**(b-path 是主力,2500 行) | dispatch 包 wrapper,Kling case 字面不動 + smoke test 覆蓋 |
| capability catalog 漏 entry → 新 model 上線後只能單鏡頭 | 中 | 低 | guard 加 lint 規則「PRESET_MODELS 出現的 video model 必須在 catalog 有 entry」 |
| User 改 model 後忘記 admin fallback 行為 → 客服 | 低 | 低 | toast 文案明示 + ↺「回到管理員預設」按鈕顯眼 |
| Seedance 拼接 prompt 超 token 上限 | 未知 | 中 | Open Q3,先觀察 |
| 真人審核 10 分鐘 user 以為任務卡住 | 高 | 低 | UI progress 明示「審核中,預計 10 分鐘」 |

## 14. Dependencies

- BobAPI 那邊 token 修好(`project_kuiperfilm_taijiai_seedance_blocked`)— blocks Seedance 真人審核 e2e 驗證
- User 拿到 fal key — blocks fal Seedance multi-shot 品質 spike
- 不阻擋 Phase 1-3(純後端 + UI 框架)

## 15. Acceptance Criteria

Plan 視為 done 當以下都滿足:

- [ ] Capability catalog 覆蓋所有 PRESET_MODELS 中的 video model
- [ ] `/profile` admin 設 default → user 沒 override → cascade 仍 work
- [ ] User 在製作端 dropdown 切 model → 寫入 `videoModel` → 下次重整保留
- [ ] User 切「↺ 回到管理員預設」→ 清 `videoModel` → 重整後顯示 admin default
- [ ] 同一 5-panel 多鏡頭專案:Kling 跑通 + Seedance 跑通,都產出 1 個 video URL
- [ ] User 沒填 fal key → fal 系列 disabled
- [ ] BobAPI Seedance:勾選「此圖含真人面孔」→ payload `isPersonReference: true` → BobAPI 帶 `subject_type: 'person'`
- [ ] BobAPI Seedance 多鏡頭 + 真人圖:走 10 分鐘審核 → 成功 / 失敗都有友善訊息
- [ ] 切 model toast 顯示能力差異(從 capability 自動生成,非寫死)
- [ ] 既有 Kling 多鏡頭 user 看不出任何行為改變

---

**Next step**:user 拍板 Open Questions 1 + 2 → 排序 Phase 啟動 → 開卡。
