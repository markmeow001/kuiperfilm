# R — Skill Primitive

> **Status**: spec / Phase 2.5–3.5 prep
> **Date**: 2026-06-03
> **Source**: 2026-06-03 logged-in walkthrough of flova.ai (12 screens captured)
> **See also**: [`REDESIGN_PLAN.md`](../REDESIGN_PLAN.md) Phase 2.5 / 3.5
> **Memory**: `reference_flova_skill_primitive_decoded.md`

---

## 1. Why this exists

The 2026-06-03 logged-in walkthrough of flova.ai surfaced an architectural primitive KuiperAI does not have: **Skill** as a named, attributable, shareable bundle of `(workflow + model chain + prompt template + workflow constraints)`. flova has built a Skill marketplace that lifts the product from "AI tool" to "creator economy platform". This doc specifies how to introduce the same primitive into KuiperAI without losing the existing R2V / 雙視圖 / 劇集設定 differentiation.

## 2. What flova actually ships

Two surfaces on the same page (`/zh-TW/skills`):

**我的 Skill** — 6 official Skills built by `@Flova`:
- 人文紀錄短片 — HappyHorse 1.0 driver, micro-motion documentary lens
- 劇情短片視頻 — Seedance 2.0 with **per-character voice anchoring** (each character gets its own reference audio at the Element stage; locks vocal continuity across shots); skips keyframe step, goes direct Element image → final shot
- 劇本驅動型視頻 — uploaded script (image / PDF / text) parsed for cinematic grammar (script + shot structure + visual language + pacing); generates new video around the user theme using Nano Banana + Seedance 2.0
- 商品宣傳短片 — Nano Banana + Seedance 2.0
- 音樂 MV — uploaded music drives lead vocal performance via Omnihuman lip-sync
- 視頻拉片複刻 — reference-video-driven recreation

**精選 Skill** — 12+ community Skills by named creators (`@阿娴`, `@境在丨米叔`, `@NET FLY`, `@Damon`, `@灵燚AI`, `@Seast Zhu`, `@渊静`, `@迷城孤影人`):
- 萌寵打工 Vlog — pet anthropomorphized, single/dual hero, handheld POV, vertical, no subtitles/BGM
- 天工開物：傳統工藝紀錄短片 — script analysis → 3-act story → 2×3 storyboard grid → Seedance 2.0 → 15s/segment × 3 → 45s edit
- 工業產品商業宣傳片 — 4 style options × 5 duration tiers × landscape/portrait recommendation; user uploads product image + spec; storyboard categories derived per analysis (not template); 720p default, upgradable
- 動作預演分鏡視頻 — matchstick PREVIS storyboard (GPT Image 2, 2×4 grid, 8 action panels) → Seedance 2.0 all-reference for ≤15s/board
- 主題變身特效短片 — batch generation grouped by themes (zodiac, festivals); per-group props/scenes/makeup derived; unified shot structure
- 韋斯·安德森風格短片 — visual/audio grammar based on Anderson's signatures; multimodal input analysis

Each Skill displays: thumbnail, title, creator attribution, multi-paragraph description, `+ 新增 / 已加入` toggle.

## 3. Mapping to KuiperAI primitives

KuiperAI already has the **runtime** for Skills — it just lacks the **abstraction layer**.

| flova Skill ingredient | KuiperAI today | gap |
|---|---|---|
| Model chain (Nano Banana → Seedance 2.0) | per-shot model picker + multi-shot composite worker | no named bundling |
| Workflow constraints (2×3 grid, 15s × 3, 9:16) | aspect ratio + duration + frame-lock per group | no preset combo |
| Per-character reference audio anchoring | TTS preview + voice-line extraction | no audio reference field on character |
| Storyboard format (2×4 PREVIS grid) | panels + multiShotGroupId | no pre-defined grid templates |
| Script analysis pipeline | analyze-novel + episode split | no "uploaded script + style transfer" entrypoint |
| Reference video recreation | `referenceVideoUrl` per group (Phase S) | already shipped, just unnamed |
| Style transfer (Wes Anderson) | 30+ `visualStyles` registry | no LLM prompt template binding |
| Creator attribution | none | new |
| Marketplace (我的 / 精選 toggle) | none | new |
| Discoverability | none | new |

**Conclusion**: KuiperAI can package its existing capabilities into 6 official Skills in ~1 sprint without adding a single new generation primitive. The hard work is **naming, attributing, and surfacing** what's already there.

## 4. Schema additions

```prisma
model Skill {
  id              String        @id @default(uuid())
  slug            String        @unique           // url-safe e.g. "drama-short-seedance"
  name            String                          // 「劇情短片視頻」
  nameEn          String?                         // bilingual
  description     String        @db.Text          // multi-paragraph spec
  descriptionEn   String?       @db.Text
  thumbnailUrl    String?                         // hero image
  
  // Attribution
  authorType      SkillAuthorType                 // official | community
  authorUserId    String?                         // null for official
  authorDisplay   String                          // 「@Flova」 / 「@阿娴」
  
  // Marketplace state
  status          SkillStatus    @default(draft)  // draft | published | archived
  isFeatured      Boolean        @default(false)  // 精選 ribbon
  popularityScore Int            @default(0)      // for 熱門 sorting
  installCount    Int            @default(0)
  
  // The runtime spec — what the worker does when this Skill runs
  config          Json                            // see §5
  
  // Multi-tenant
  workspaceId     String?                         // null = global; set = ws-scoped
  
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  
  installations   SkillInstallation[]
  
  @@index([authorType, status, isFeatured, popularityScore])
  @@index([slug])
  @@map("skills")
}

enum SkillAuthorType {
  official  // 我的 Skill default set
  community // 精選 + user-created
}

enum SkillStatus {
  draft
  published
  archived
}

model SkillInstallation {
  id            String   @id @default(uuid())
  userId        String
  skillId       String
  enabled       Boolean  @default(true)
  installedAt   DateTime @default(now())
  lastUsedAt    DateTime?
  
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  skill         Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)
  
  @@unique([userId, skillId])
  @@index([userId, enabled])
  @@map("skill_installations")
}
```

## 5. `Skill.config` shape

JSON column. Worker reads at run time. Versioned via `version: 1`.

```ts
interface SkillConfig {
  version: 1
  
  // Stage 1: input requirements — what the UI gates submission on
  input: {
    requiresScript?: boolean              // 「需上傳劇本」
    requiresMusic?: boolean
    requiresProductImage?: boolean
    requiresReferenceVideo?: boolean
    requiresPetImage?: { count: 1 | 2 }   // "上傳一至兩張寵物清晰參考圖"
    requiresThemeText?: boolean
    minElementsCount?: number             // require N characters
  }
  
  // Stage 2: model chain — which workers fire in sequence
  pipeline: Array<{
    stage: 'analyze_script' | 'generate_keyframe' | 'generate_storyboard_grid'
         | 'generate_panel_image' | 'generate_panel_video' | 'composite_multi_shot'
         | 'tts_voice_line' | 'lip_sync' | 'stitch_final'
    model?: string                        // model key override e.g. 'atlascloud::seedance-2.0'
    settings?: Record<string, unknown>    // per-stage params
  }>
  
  // Stage 3: style + format defaults
  defaults: {
    visualStyleId?: string                // links to visualStyles registry
    aspectRatio?: '9:16' | '16:9' | '1:1'
    durationPerShotSec?: number           // e.g. 15
    shotCount?: number                    // e.g. 3 segments → 45s final
    storyboardGrid?: '2x3' | '2x4' | '3x4' // PREVIS / 六格 / etc
    resolution?: '720p' | '1080p' | '2k' | '4k'
    audioMode?: 'silent' | 'ambient' | 'bgm' | 'voiced'
    voNarration?: 'never' | 'on_request' | 'always'
  }
  
  // Stage 4: prompt template — system prompts injected at LLM steps
  prompts?: {
    analyzeScript?: string                // override default storyboard-prompt-router
    panelDescription?: string             // injected into NP_AGENT_STORYBOARD_DETAIL
    characterStyling?: string
    cinematography?: string
  }
  
  // Stage 5: constraints / guardrails
  constraints?: {
    forbiddenSubjects?: string[]          // e.g. real-face for NSFW-safe Skill
    forcePortrait?: boolean
    forceLandscape?: boolean
    enforceAudioRefPerCharacter?: boolean // 劇情短片視頻's voice-anchor lock
  }
}
```

## 6. The 6 official KuiperAI Skills (mirror of 我的 Skill)

| Slug | Korean equivalent | Pipeline | Defaults |
|---|---|---|---|
| `drama-short-seedance-voice` | 劇情短片視頻 (Seedance 角色音色連戲) | analyze_script → generate_panel_image (Nano Banana) → generate_panel_video (Seedance 2.0 r2v) → tts_voice_line per-char | aspect=9:16, durPerShot=10s, shotCount=4-6, audio=voiced |
| `script-driven-cinematic` | 劇本驅動型視頻 | analyze_script (uploaded PDF/text) → generate_keyframe (Nano Banana) → composite_multi_shot (Seedance 2.0) → stitch_final | aspect from analysis, dur from analysis |
| `product-promo-commercial` | 商品宣傳短片 | analyze (product image+spec) → generate_keyframe × N (Nano Banana) → generate_panel_video × N (Seedance 2.0) → stitch | aspect=16:9 default with portrait toggle, dur=15/30/60s |
| `music-mv-omnihuman` | 音樂 MV | tts_voice_line OR upload audio → lip_sync (Kling Omnihuman or Tencent) → generate_panel_video → stitch | aspect=9:16, sync to audio length |
| `previs-action-storyboard` | 動作預演分鏡視頻 | generate_storyboard_grid (GPT Image 2 matchstick) → generate_panel_video (Seedance 2.0 ref) → stitch | grid=2x4, durPerShot≤15s |
| `reference-recreation` | 視頻拉片複刻 | analyze_script (uploaded reference video) → generate_keyframe → generate_panel_video (Seedance 2.0 r2v + motion_ref) → stitch | inherits from reference |

Each maps to existing KuiperAI workers — **zero new generation code required** for v1.

## 7. UI surfaces

### 7.1 Skill picker (in narrative editor + new project flow)
Replaces the current ad-hoc model/style/preset config. Single chip in chat input or narrative editor toolbar: `🎬 Skill: 劇情短片視頻 ▾`. Click opens panel with installed Skills (我的 Skill) + browse button (精選 Skill).

### 7.2 Skill detail page
`/[locale]/skills/[slug]` — title, hero thumbnail, creator attribution, multi-paragraph description, default settings preview, sample output gallery (if community Skill has runs), 「啟用 / 已啟用」 toggle, 「使用此 Skill 建立專案」 primary CTA.

### 7.3 Skill library
`/[locale]/skills` — 2 sections matching flova:
- **我的 Skill** — installed (default = 6 official) with enable toggle
- **精選 Skill** — featured + community with install (`+ 新增`) action

### 7.4 Marketplace (Phase 3.5)
Browse / search / sort by 熱門 / install count / creator / category. User-created Skill submission form (Phase 3.5 only, behind feature flag initially).

## 8. Permissions / multi-tenant

Reuse the existing 8-tier `requireProjectAccess` cascade for Skill execution (a Skill run produces a project, so project auth applies). Skill creation:
- Official Skills: admin only (curated)
- Community Skills (Phase 3.5): any user with `creator` role flag; published Skills go through admin review before `status=published`

Workspace-scoped Skills (`Skill.workspaceId`): workspace editor can author internal-only Skills not visible globally.

## 9. Pricing implication

Currently KuiperAI charges per-shot. With Skills, the unit of consumption shifts to "running one Skill end-to-end". Two pricing options:
- (a) **Pass-through** — sum the underlying model costs + small Skill royalty if community-authored. Predictable for KuiperAI margins, less predictable for the user.
- (b) **Skill-tier pricing** — flat credit cost per Skill run, KuiperAI absorbs internal model swap. Predictable for the user, KuiperAI takes risk on margin.

flova went with (b) tier-based pricing aligned to subscription. Recommend KuiperAI go (a) until Skill marketplace matures, then switch to (b) for Pro+ tiers.

**Creator revenue share** (Phase 3.5): community Skill author gets X% of runs that use their Skill. Default 5-10% to start, mirroring Roblox / GameMaker model.

## 10. Phasing

| Phase | Scope | Effort |
|---|---|---|
| **2.5** | Schema + 6 official Skills + Skill picker UI + skill library page (我的 only, no community) | 2-3 weeks |
| **3.0** | Featured Skill section (Flova-curated `community` Skills written by KuiperAI staff under partner attribution) | 1 week |
| **3.5** | User-created Skill submission + admin review + creator dashboard + run-attribution metrics | 4 weeks |
| **4.0** | Creator revenue share + payout system | 3 weeks (depends on Stripe Connect setup) |

## 11. Risks

1. **Migration pain** — existing projects don't have `skillId`; need backfill or null-default. Recommend `Project.originSkillId String?` nullable column; existing projects = NULL = generic "free creation".
2. **Pipeline drift** — if a Skill hardcodes `model: 'atlascloud::seedance-2.0'` and the model is later retired, runs break. Need version pinning + fallback chain in `SkillConfig.pipeline[].fallbackModels`.
3. **Creator quality control** — community Skills with bad pipelines waste user credits. Admin review + automated probe (run the Skill against a fixture and confirm <X% failure rate) before `status=published`.
4. **Discoverability flywheel** — without enough Skills in marketplace, users won't browse. Solution: KuiperAI staff writes 12-20 partner-attributed Skills before opening community submission (mirror flova's 12+ 精選 list).

## 12. What NOT to copy from flova

- **Quick-gen paywall** (flova gates raw model access behind subscription, forcing all Free users into Skill flow). Don't do this — KuiperAI's short-drama vertical needs frictionless entry for word-of-mouth.
- **Multi-modal promo modal stacking** (flova ships 2-3 promotional overlays per session). Stays in your §3.8 anti-patterns.
- **Gradient CTA buttons everywhere** (flova's "生成" button is gold→green gradient). KuiperAI's solid `primary-500` plus violet AI-accent ring stays the differentiator.

## 13. Open questions

- [ ] Should `劇集設定` (existing main subjects library) become a kind of Skill, or stay parallel? Recommend parallel — Skills are workflow templates, 劇集設定 is project-scoped identity. Different layers.
- [ ] Do we surface "Skill" as the term in Chinese UI, or rename (e.g. 「導演模式」 / 「劇種」)? flova kept English "Skill" even in zh-TW. Recommend rename in early Phase 2.5 user test, fall back to "Skill" if rename underperforms.
- [ ] How aggressively to seed community Skills? Recommend hiring 5-10 short-drama directors as paid partners for first 20 Skills before opening submission.
