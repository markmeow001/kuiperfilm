# R2V-First 模式選擇器 + 自動鏈 + 開場節奏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者在「新建專案」時選擇影片生成模式（R2V 敘事直生 vs T2I 分鏡卡）與開場節奏（快鉤子 vs 電影氛圍），並讓 R2V 模式的「劇本分析 → 自動切組 → 自動重生敘事」一鍵串起來。

**Architecture:** 在 `NovelPromotionProject` 加兩個 per-project 欄位（`generationMode`、`openingPacing`），預設 `r2v-narrative` / `hook`，向下游分流：模式決定 cascadeImageGen、預設視頻模型、picker 過濾、預設視圖、是否自動鏈；節奏注入拆鏡 prompt 的 establishing-beat 分配。舊專案一律標 `t2i-storyboard`/`hook`（legacy 不動），新專案預設 R2V。不 rip out 任何 T2I 基礎設施——只是把它變成可選模式。

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript、Prisma + MySQL、TanStack Query、既有 orchestrator/script-to-storyboard + auto-group-multi-shot worker、Vitest。

**已知前置（來自 2026-05-29 描述詞品質根治，全 prod）:** description 已寫滿五要素、worker 已讀 description 優先、R2V 已支援純文字 panel（`videoModelToleratesTextOnlyPanels`）、V2 analyze 已帶 `cascadeImageGen:false`。

---

## 設計決策（鎖定）

- **欄位**：`NovelPromotionProject.generationMode: 'r2v-narrative' | 't2i-storyboard'`（預設 `r2v-narrative`）；`openingPacing: 'hook' | 'cinematic'`（預設 `hook`）。用 String + @default，不用 enum（對齊本專案既有風格，schema 既有欄位都是 String）。
- **舊專案遷移**：DB migration 把所有既有 `NovelPromotionProject` 設 `generationMode='t2i-storyboard'`、`openingPacing='hook'`（保留現狀，不改變既有用戶輸出）。新專案靠 @default 拿 `r2v-narrative`。
- **模式的下游影響**（單一來源 helper `resolveGenerationModeBehavior(project)`）：
  | 行為 | r2v-narrative | t2i-storyboard |
  |---|---|---|
  | analyze 的 cascadeImageGen | false | true |
  | storyboard 預設視圖 | 多鏡頭(敘事) | 画廊(分鏡卡) |
  | video model picker | 只 Seedance R2V/T2V 變體 | 全部(含 i2v/Kling) |
  | 分析後自動鏈 | 是(auto-group+reseed) | 否(維持手動) |
  | FrameLock 鎖幀 | 隱藏 | 顯示 |
- **節奏**：`openingPacing` 注入拆鏡 prompt 的 establishing-beat 規則：`cinematic` → 開場獨立成組、整組鋪氛圍；`hook` → 維持現有冷開場快節奏。

---

## File Structure

**新增：**
- `src/lib/novel-promotion/generation-mode.ts` — 模式型別 + `resolveGenerationModeBehavior()` 單一來源 helper（所有下游讀它，不散落 if）。
- `tests/unit/novel-promotion/generation-mode.test.ts` — helper 行為測試。
- `tests/unit/novel-promotion/opening-pacing-prompt.test.ts` — 節奏注入拆鏡 prompt 的測試。

**修改：**
- `prisma/schema.prisma:343` — `NovelPromotionProject` 加兩欄。
- `prisma/migrations/<ts>_add_generation_mode/migration.sql` — 欄位 + 既有資料 backfill。
- `src/app/[locale]/v2/new/V2NewProjectClient.tsx` — 加模式 + 節奏選擇 UI。
- 建立專案的 API route（create novel-promotion project；Task 3 會先定位確切路徑）— 接收並寫入兩欄。
- `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts` + `src/lib/storyboard-phases.ts` — phase1 plan prompt 注入 `openingPacing`。
- `lib/prompts/novel-promotion/agent_storyboard_plan.{zh,en}.txt` — 加 `{opening_pacing_directive}` placeholder。
- `src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx` — 自動鏈（analyze 完成 → autoGroup → reseed）+ 依模式過濾 picker/視圖/FrameLock。
- `messages/zh/v2*.json` + `messages/en/v2*.json` — UI 文案。

---

## Phase 1 — 模式選擇器骨架（schema + 建立流程 + 下游 helper）

> 先有骨架，後面 Phase 2/3 都掛在 `generationMode` 上。

### Task 1: generation-mode 型別 + behavior helper（純函式，先 TDD）

**Files:**
- Create: `src/lib/novel-promotion/generation-mode.ts`
- Test: `tests/unit/novel-promotion/generation-mode.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// tests/unit/novel-promotion/generation-mode.test.ts
import { describe, expect, it } from 'vitest'
import { resolveGenerationModeBehavior, GENERATION_MODES } from '@/lib/novel-promotion/generation-mode'

describe('resolveGenerationModeBehavior', () => {
  it('r2v-narrative: 跳過生圖、自動鏈、隱藏鎖幀、預設敘事視圖', () => {
    const b = resolveGenerationModeBehavior('r2v-narrative')
    expect(b.cascadeImageGen).toBe(false)
    expect(b.autoChainAfterAnalyze).toBe(true)
    expect(b.showFrameLock).toBe(false)
    expect(b.defaultStoryboardView).toBe('multishot')
    expect(b.videoModelFilter).toBe('seedance-only')
  })
  it('t2i-storyboard: 生圖、手動、顯示鎖幀、預設分鏡卡', () => {
    const b = resolveGenerationModeBehavior('t2i-storyboard')
    expect(b.cascadeImageGen).toBe(true)
    expect(b.autoChainAfterAnalyze).toBe(false)
    expect(b.showFrameLock).toBe(true)
    expect(b.defaultStoryboardView).toBe('gallery')
    expect(b.videoModelFilter).toBe('all')
  })
  it('null/未知值 → 安全預設 r2v-narrative', () => {
    expect(resolveGenerationModeBehavior(null).cascadeImageGen).toBe(false)
    expect(resolveGenerationModeBehavior('garbage' as never).autoChainAfterAnalyze).toBe(true)
  })
  it('GENERATION_MODES 暴露兩個合法值', () => {
    expect(GENERATION_MODES).toEqual(['r2v-narrative', 't2i-storyboard'])
  })
})
```

- [ ] **Step 2: 跑測試確認 FAIL**

Run: `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/novel-promotion/generation-mode.test.ts`
Expected: FAIL（模組不存在）

- [ ] **Step 3: 寫實作**

```typescript
// src/lib/novel-promotion/generation-mode.ts
export const GENERATION_MODES = ['r2v-narrative', 't2i-storyboard'] as const
export type GenerationMode = (typeof GENERATION_MODES)[number]

export const OPENING_PACINGS = ['hook', 'cinematic'] as const
export type OpeningPacing = (typeof OPENING_PACINGS)[number]

export interface GenerationModeBehavior {
  cascadeImageGen: boolean
  autoChainAfterAnalyze: boolean
  showFrameLock: boolean
  defaultStoryboardView: 'multishot' | 'gallery'
  videoModelFilter: 'seedance-only' | 'all'
}

/** Single source of truth — every downstream read goes through this, never
 *  scattered `mode === ...` checks. Defaults to r2v-narrative for null/unknown. */
export function resolveGenerationModeBehavior(
  mode: GenerationMode | string | null | undefined,
): GenerationModeBehavior {
  if (mode === 't2i-storyboard') {
    return {
      cascadeImageGen: true,
      autoChainAfterAnalyze: false,
      showFrameLock: true,
      defaultStoryboardView: 'gallery',
      videoModelFilter: 'all',
    }
  }
  // r2v-narrative (default for null / unknown)
  return {
    cascadeImageGen: false,
    autoChainAfterAnalyze: true,
    showFrameLock: false,
    defaultStoryboardView: 'multishot',
    videoModelFilter: 'seedance-only',
  }
}
```

- [ ] **Step 4: 跑測試確認 PASS**

Run: `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/novel-promotion/generation-mode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/novel-promotion/generation-mode.ts tests/unit/novel-promotion/generation-mode.test.ts
git commit -m "feat: generation-mode behavior helper (R2V-first vs T2I-storyboard)"
```

### Task 2: Prisma schema 兩欄 + migration backfill

**Files:**
- Modify: `prisma/schema.prisma:343`（model NovelPromotionProject）
- Create: `prisma/migrations/<timestamp>_add_generation_mode/migration.sql`

- [ ] **Step 1: schema 加欄位**（緊接 `targetDuration` 之後）

```prisma
  // 2026-05-29 — per-project 生成模式。r2v-narrative=text→切組→R2V 無 T2I;
  // t2i-storyboard=文生圖分鏡→圖生視頻(legacy)。新專案預設 R2V。
  generationMode       String                    @default("r2v-narrative")
  openingPacing        String                    @default("hook")
```

- [ ] **Step 2: 建 migration（含既有資料 backfill 成 legacy）**

```sql
-- prisma/migrations/<timestamp>_add_generation_mode/migration.sql
ALTER TABLE `novel_promotion_projects`
  ADD COLUMN `generationMode` VARCHAR(191) NOT NULL DEFAULT 'r2v-narrative',
  ADD COLUMN `openingPacing` VARCHAR(191) NOT NULL DEFAULT 'hook';

-- 既有專案維持現狀(T2I)，不改變既有用戶輸出
UPDATE `novel_promotion_projects` SET `generationMode` = 't2i-storyboard';
```
> ⚠️ 確認 @@map 表名：實作時 `grep '@@map' prisma/schema.prisma` 對 NovelPromotionProject 的真實表名（此處假設 `novel_promotion_projects`，以實際為準）。

- [ ] **Step 3: 套用 + 重生 client**

Run: `npx prisma migrate dev --name add_generation_mode`（本機）/ prod 走 `prisma migrate deploy`
Expected: 欄位建立，既有列 backfill 成 t2i-storyboard

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add generationMode + openingPacing to NovelPromotionProject (backfill legacy=t2i)"
```

### Task 3: 建立專案 API 接收兩欄

**Files:**
- Modify: 建立 novel-promotion 專案的 route（實作時定位：`grep -rn "novelPromotionProject.create\|create.*NovelPromotion" src/app/api`，最可能在 `src/app/api/novel-promotion/.../route.ts` 或 projects create）
- Test: 對應 route 的 integration test（沿用 `tests/integration/api` 既有 pattern）

- [ ] **Step 1: 寫失敗測試**（建立專案帶 generationMode → 存入）

```typescript
// 沿用既有 create-project integration test 結構；斷言：
// POST create with { generationMode: 'r2v-narrative', openingPacing: 'cinematic' }
// → 回傳 project.generationMode === 'r2v-narrative' && openingPacing === 'cinematic'
// 缺欄位 → 落 @default('r2v-narrative' / 'hook')
// 非法值('foo') → 用 zod 拒絕(INVALID_PARAMS) 或 clamp 成預設
```

- [ ] **Step 2: 跑測試確認 FAIL**

Run: `npx vitest run tests/integration/api/<create-project>.test.ts`
Expected: FAIL

- [ ] **Step 3: 實作**：route 的 zod schema 加 `generationMode: z.enum(GENERATION_MODES).optional()` + `openingPacing: z.enum(OPENING_PACINGS).optional()`，寫進 `novelPromotionProject.create({ data: { ..., generationMode, openingPacing } })`（省略時靠 @default）。import 從 `@/lib/novel-promotion/generation-mode`。

- [ ] **Step 4: 跑測試確認 PASS**；並跑 `npx vitest run tests/integration/api`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: accept generationMode/openingPacing on project create"
```

### Task 4: 新建專案 UI 模式 + 節奏選擇

**Files:**
- Modify: `src/app/[locale]/v2/new/V2NewProjectClient.tsx`
- Modify: `messages/zh/*.json` + `messages/en/*.json`（新 key，雙語必須同步，否則 i18n guard 擋）

- [ ] **Step 1**: 在建立表單加兩組選擇器（卡片式單選）：
  - 生成模式：`敘事直生(R2V) · 推薦快速` / `分鏡卡(文生圖→圖生視頻) · 精修每格`，state 預設 `r2v-narrative`。
  - 開場節奏：`短劇快鉤子` / `電影氛圍開場`，state 預設 `hook`。
- [ ] **Step 2**: 送出 create 時把兩值帶進 body（接 Task 3 的欄位）。
- [ ] **Step 3**: 文案進 messages（zh 為主、en 同步）。key 例：`v2New.mode.r2vTitle/r2vDesc/t2iTitle/t2iDesc`、`v2New.pacing.hook/cinematic`。
- [ ] **Step 4**: 手動驗證 `npm run dev:next` → /v2/new 看到兩組選擇、預設選中 R2V+hook、建立後 DB 寫對。
- [ ] **Step 5: Commit**

```bash
git commit -am "feat: generation-mode + pacing selectors on new-project page"
```

**Phase 1 出場條件**：新建專案能選模式、存進 DB、舊專案 backfill 成 legacy。此時下游還沒讀它（行為不變），可安全 ship。

---

## Phase 2 — R2V 模式自動鏈（分析 → 自動切組 → 自動重生敘事）

> 只在 `resolveGenerationModeBehavior(mode).autoChainAfterAnalyze === true` 時啟用。

### Task 5: V2StoryboardClient 讀專案模式 + gate

**Files:**
- Modify: `src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx`

- [ ] **Step 1**: 取得 `project.generationMode`（實作時確認 client 已有 project 物件或需從既有 query 取；`grep "generationMode\|project\." V2StoryboardClient.tsx` 找注入點）。算出 `const modeBehavior = resolveGenerationModeBehavior(project.generationMode)`。
- [ ] **Step 2**: video model picker 依 `modeBehavior.videoModelFilter` 過濾（沿用既有 `useUserModels` filter 機制 + `videoModelToleratesTextOnlyPanels`）；FrameLock UI 依 `modeBehavior.showFrameLock` 條件 render；預設視圖依 `defaultStoryboardView`。
- [ ] **Step 3**: Commit `git commit -am "feat: V2 storyboard reads generationMode for picker/view/framelock gating"`

### Task 6: 自動鏈 — analyze 完成後自動 autoGroup + reseed（核心）

**Files:**
- Modify: `src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx`（`handleAnalyzeStoryboard:877` + 新 useEffect 監看 `analyzeSnapshot.status`）

- [ ] **Step 1**: 新增 useEffect：當 `modeBehavior.autoChainAfterAnalyze && analyzeStatus 從非 completed → completed` 時，自動呼叫 `handleAutoGroup()`，並設一個 `autoChainPhase` state（'analyzing'|'grouping'|'done'）驅動進度文案。

```typescript
// 監看 analyze 完成 → 自動切組（只在 R2V 自動鏈模式）
const prevAnalyzeStatus = useRef<string | null>(null)
useEffect(() => {
  if (!modeBehavior.autoChainAfterAnalyze) return
  if (prevAnalyzeStatus.current !== 'completed' && analyzeStatus === 'completed') {
    setAutoChainPhase('grouping')
    void handleAutoGroup().finally(() => setAutoChainPhase('done'))
  }
  prevAnalyzeStatus.current = analyzeStatus
}, [analyzeStatus, modeBehavior.autoChainAfterAnalyze])
```

- [ ] **Step 2**: 自動鏈下的「重生敘事」：autoGroup 成功 + storyboards refetch 後，對**未被使用者手動編輯過**的組自動 reseed（用既有 saved-snapshot guard：`narrativeDirty===false` 才自動覆蓋；dirty 的不動，避免洗掉手改）。實作時把 reseed 暴露成 GroupCard 的 imperative handle 或在 V2GroupsLayout 層觸發。
- [ ] **Step 3**: 進度 UI：用 `autoChainPhase` 顯示「分析中…→ 切組中…→ 完成」，失敗任一步停在可重試狀態（沿用既有 analyzeState/autoGroup.error 顯示）。
- [ ] **Step 4**: 手動驗證：R2V 專案點「重新分析」→ 不用再手動點切組/重生敘事 → 自動跑出豐富分組敘事；手改過的組不被覆蓋。
- [ ] **Step 5: Commit** `git commit -am "feat: R2V auto-chain analyze→autoGroup→reseed (skips edited groups)"`

> ⚠️ 風險（已知）：autoGroup 是 LLM 非確定性，重跑換組——可接受（使用者本來就在重新分析）；多花一次 LLM 點數+時間——進度 UI 已交代；別洗掉手改——Step 2 的 dirty guard 處理。

---

## Phase 3 — 開場節奏注入拆鏡 prompt

### Task 7: plan prompt 加 `{opening_pacing_directive}` placeholder（雙語）

**Files:**
- Modify: `lib/prompts/novel-promotion/agent_storyboard_plan.zh.txt` + `.en.txt`
- Modify: `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts` + `src/lib/storyboard-phases.ts`（兩條路徑都要替換 placeholder——見記憶 [[reference_kuiperfilm_dual_collect_character_refs]] 的雙路徑陷阱）
- Test: `tests/unit/novel-promotion/opening-pacing-prompt.test.ts`

- [ ] **Step 1: 寫失敗測試**（節奏注入正確字串 + 兩路徑都替換）

```typescript
// 斷言：buildPlanPrompt(..., openingPacing='cinematic') 含「開場獨立成組」directive;
// 'hook' 含「冷開場快節奏」directive;placeholder {opening_pacing_directive} 不殘留
```

- [ ] **Step 2: 跑確認 FAIL**
- [ ] **Step 3**: prompt 檔在 establishing 鏡頭規則處插 `{opening_pacing_directive}`；orchestrator(L386 附近) + executePhase1(storyboard-phases L307 附近) 都加 `.replace('{opening_pacing_directive}', pacingDirective(openingPacing))`。directive 文案：
  - `cinematic`：「開場必須獨立成一個分鏡組(整組鋪環境氛圍+主體慢揭示)，不與動作高潮同組。」
  - `hook`：「開場走短劇冷開場節奏，3 秒內進入衝突/鉤子，環境鋪陳精簡。」
- [ ] **Step 4: 跑確認 PASS** + `node scripts/guards/seedance-prompt-redline-guard.mjs`
- [ ] **Step 5: Commit** `git commit -am "feat: openingPacing directive injected into plan prompt (zh+en, both paths)"`

### Task 8: openingPacing 從專案傳到 plan 階段

**Files:**
- Modify: orchestrator + storyboard-phases 的呼叫鏈（把 `project.openingPacing` 一路傳進 plan prompt builder）

- [ ] **Step 1**: 確認 `resolveNovelData`/orchestrator 入參已含 project；補傳 `openingPacing` 到 plan prompt 組裝。
- [ ] **Step 2**: 跑 `npx vitest run tests/unit/worker tests/unit/novel-promotion`
- [ ] **Step 3: Commit** `git commit -am "feat: thread openingPacing from project into plan stage"`

---

## 收尾

- [ ] `npm run test:regression` 全綠（注意：repo 有既有 pre-existing guard 失敗 api-handler/test-coverage/pricing/variants，與本變更無關——確認沒新增失敗即可）
- [ ] `npm run check:config-center-guards`（若動到 model picker filter）
- [ ] 更新 master plan / CLAUDE.md 記一筆模式選擇器；記憶 [[project_kuiperfilm_2026_05_29_r2v_first_mode_and_pacing.md]] 標完成
- [ ] prod：`prisma migrate deploy` 先跑（schema 變更），再 deploy app

## Rollout / 回退

- 每個 Task 可獨立 commit + ship。Phase 1 ship 後行為不變（下游還沒讀），安全。
- 回退：generationMode 欄位保留，把下游 gate 改成「永遠 t2i-storyboard 行為」即還原舊流程；不需 drop 欄位。
- **不自動遷移既有專案的已生成資料**（panel.imageUrl 留著）；COS 清理當未來可選腳本。

## 風險

| 風險 | 緩解 |
|---|---|
| migration 在 prod 跑（schema 變更）| 先 `prisma migrate deploy` 再換 app image;欄位有 @default 不會炸既有 row |
| 自動鏈洗掉手改敘事 | dirty-guard：只 reseed `narrativeDirty===false` 的組 |
| 兩 session 共用工作目錄撞 deploy | 照慣例 deploy 固定一邊做;每 Task 小 commit 縮短衝突窗 |
| picker 過濾誤殺使用者已選模型 | 沿用既有 useUserModels「當前選中即使被 disable 也留住」邏輯 |

## Self-Review 註記

- Spec 覆蓋：模式選擇(Task 1-4) / 自動鏈(Task 5-6) / 節奏(Task 7-8) 三項齊。
- 型別一致：`GenerationMode`/`OpeningPacing`/`resolveGenerationModeBehavior` 跨 Task 用同名。
- 待實作時確認（非 placeholder，是需對實際檔驗的點）：① NovelPromotionProject @@map 真實表名 ② 建立專案 route 確切路徑 ③ V2StoryboardClient 取 project 物件的注入點 ④ GroupCard reseed 的 imperative 觸發方式。這四點實作時 grep 一次即可確定。
