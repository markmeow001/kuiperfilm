/**
 * Video model variant registry — single source of truth for the V2
 * storyboard's inline picker, multi-shot gating, and admin/user default
 * resolution.
 *
 * Why this exists separately from `src/lib/constants.ts` (VIDEO_MODELS):
 *   VIDEO_MODELS is a flat label list dating from the original picker
 *   that never made it into V2. The 2026-05-17 plan limits the user-
 *   facing storyboard picker to TWO families (Seedance + Kling) plus
 *   their capability metadata so the multi-shot button can self-gate
 *   without `videoModel.toLowerCase().includes('kling')` substring
 *   tricks. Keep this file the authority for the picker; legacy paths
 *   that already work off VIDEO_MODELS can stay unchanged.
 *
 * Adding a new variant:
 *   1. Append below in family order (so dropdown order tracks UI intent).
 *   2. Capability shape must be filled (no defaults) — forcing the
 *      author to think about audio/multi-shot/duration before shipping.
 *   3. The id is the canonical `provider::modelId` string the worker
 *      already understands; never invent a new id scheme here.
 */

export type VideoModelFamily = 'seedance' | 'kling'

export interface VideoModelCapabilities {
  /** Native audio track in the output mp4 (no separate TTS overlay needed). */
  audio: boolean
  /** Worker accepts a single-call multi-shot batch (B-path Tencent VOD
   *  Kling-3 / O1 with multi_shot=intelligence, or any Kling via C-path
   *  i2v chunked). Seedance variants are false today — provider does
   *  not chunk natively and we have not built a chunker for them. */
  multiShot: boolean
  /** Maximum duration (seconds) the worker will accept for a single shot. */
  maxDurationSec: number
  /** Rough cost tier — '¥' cheapest, '¥¥¥' priciest. Used only for the
   *  picker UI badge, not for billing. Update when prices shift. */
  costTier: '¥' | '¥¥' | '¥¥¥'
}

export interface VideoModelVariant {
  /** Canonical `provider::modelId` — matches DB `project.videoModel`. */
  id: string
  family: VideoModelFamily
  /** Short label shown in the dropdown (zh). */
  label: string
  /** Optional one-line context shown in tooltip / sub-line. */
  hint?: string
  capabilities: VideoModelCapabilities
}

export const VIDEO_MODEL_VARIANTS: VideoModelVariant[] = [
  // ─────────── Seedance family ───────────
  // 2026-05-21 Phase D — fal Seedance 2.0 multi-shot composite line.
  // Same prompt-encoded multi-shot capability as AtlasCloud / BobAPI;
  // 4 variants total (i2v / r2v × std / fast). Worker routes to
  // multi-shot-video-fal-path. r2v variants accept image_urls[] up to 9
  // refs + @Image1/@Image2/... prompt tags (fal-specific convention).
  {
    id: 'fal::bytedance/seedance-2.0/image-to-video',
    family: 'seedance',
    label: 'Seedance 2.0 I2V (fal · audio)',
    hint: '起始圖驅動,1080p · native audio · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'fal::bytedance/seedance-2.0/reference-to-video',
    family: 'seedance',
    label: '✓ Seedance 2.0 R2V (fal · 9 圖綁定 · 推薦)',
    hint: '參考圖驅動,最多 9 張 @Image1...@Image9 · 視覺一致性最佳 · audio · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'fal::bytedance/seedance-2.0/fast/image-to-video',
    family: 'seedance',
    label: 'Seedance 2.0 Fast I2V (fal · cheap)',
    hint: 'fast 版起始圖驅動 · audio · 適合大量試片 · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },
  {
    id: 'fal::bytedance/seedance-2.0/fast/reference-to-video',
    family: 'seedance',
    label: '✓ Seedance 2.0 Fast R2V (fal · 9 圖綁定 · cheap)',
    hint: 'fast 版 9 張參考圖 · 視覺一致性最佳 · audio · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },
  {
    id: 'taijiai::seedance-2.0-720p',
    family: 'seedance',
    // 2026-05-17 — only Seedance variant with multi-ref composite support.
    // BobAPI/taijiai serves the content[] @N endpoint; fal Seedance is
    // flat i2v only, so only THIS id lights up the 多鏡頭 button.
    label: '✓ Seedance 2.0 720p (BobAPI · 9 圖綁定 · 推薦)',
    hint: '透過 BobAPI / taijiai 中轉 · 9 張角色 / 場景圖綁定 · 視覺一致性最佳 · 720p · audio · 支援多鏡頭合成 (9-ref @N)',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  // 2026-05-22 — 火山方舟 ARK 直连 Seedance 2.0 (and 2.0 Fast). Same
  // Doubao Seedance 2.0 model as the taijiai entry above, but bypasses
  // the BobAPI 中轉 (lower latency, account-billed via Volcengine
  // directly, requires ≥ 200元 balance). Same content[] multi-modal
  // shape, same 4-15s range. Worker dispatch goes through
  // multi-shot-video-ark-path. See https://www.volcengine.com/docs/82379/1520757
  {
    id: 'ark::doubao-seedance-2-0-260128',
    family: 'seedance',
    label: '✓ Seedance 2.0 (火山 ARK 直连 · 解析度可選 480p/720p/1080p)',
    hint: '直连 Volcengine 方舟 · 4-15s · 解析度在「Project Settings · 畫面解析度」選 (預設 720p; 1080p 約 2.25× 成本) · audio · 多鏡頭走 R2V 最多 9 張角色/場景圖 · 帳戶餘額 ≥ 200元 才能開通',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'ark::doubao-seedance-2-0-fast-260128',
    family: 'seedance',
    label: 'Seedance 2.0 Fast (火山 ARK · 解析度可選 480p/720p, no 1080p)',
    hint: '便宜的 fast 版火山直连 · 4-15s · 解析度在「Project Settings」選 480p/720p (本變體不支援 1080p) · audio · 多鏡頭走 R2V 最多 9 張角色/場景圖',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },
  // 2026-05-20 — AtlasCloud Seedance 2.0 line (6 variants: t2v/i2v/r2v × standard/fast).
  // Multi-shot is a MODEL capability, not an endpoint capability — Seedance 2.0
  // accepts shot breakdowns encoded in the prompt ("第一鏡：… 第二鏡：…") and
  // produces one composite mp4 with internal shot transitions. The 3 endpoints
  // differ in what gets anchored:
  //   - t2v: prompt-only (no images)
  //   - i2v: first_frame image + prompt
  //   - r2v: 1-9 reference_images[] + prompt (refs cited as "image 1" / "image 2")
  // All 6 are multiShot: true; worker dispatches to multi-shot-video-atlascloud-path.
  {
    id: 'atlascloud::seedance-2.0-t2v',
    family: 'seedance',
    label: '⚠️ Seedance 2.0 T2V (AtlasCloud · 純文字 · 無圖綁定)',
    hint: '純文字驅動 · 不送任何角色 / 場景參考圖,角色臉每次都會不同 · 適合無主角的氛圍鏡 / 環境鏡 · 720p · audio · 4-15s',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'atlascloud::seedance-2.0-i2v',
    family: 'seedance',
    label: 'Seedance 2.0 I2V (AtlasCloud · 首幀綁定)',
    hint: '首幀 1 張圖當錨點,後續鏡頭可能微飄 · 720p · audio · 4-15s · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'atlascloud::seedance-2.0-r2v',
    family: 'seedance',
    label: '✓ Seedance 2.0 R2V (AtlasCloud · 9 圖綁定 · 推薦)',
    hint: '參考圖驅動,最多 9 張角色 / 場景圖 · 視覺一致性最佳 · 720p · audio · 4-15s · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥¥' },
  },
  {
    id: 'atlascloud::seedance-2.0-fast-t2v',
    family: 'seedance',
    label: '⚠️ Seedance 2.0 Fast T2V (AtlasCloud · 純文字 · 無圖綁定)',
    hint: '便宜的 fast 版 · 純文字驅動,不送角色 / 場景參考圖,適合氛圍鏡 · audio · 4-15s',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },
  {
    id: 'atlascloud::seedance-2.0-fast-i2v',
    family: 'seedance',
    label: 'Seedance 2.0 Fast I2V (AtlasCloud · 首幀綁定 · cheap)',
    hint: '便宜的 fast 版 · 首幀 1 張圖當錨點 · audio · 4-15s · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },
  {
    id: 'atlascloud::seedance-2.0-fast-r2v',
    family: 'seedance',
    label: '✓ Seedance 2.0 Fast R2V (AtlasCloud · 9 圖綁定 · cheap)',
    hint: '便宜的 fast 版 · 9 張參考圖驅動 · 視覺一致性最佳 · audio · 4-15s · 多鏡頭由 prompt 編碼',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 15, costTier: '¥' },
  },

  // ─────────── Kling family ───────────
  // Tencent VOD line (Kling-3 / Omni / O1 hit B-path multi_shot=intelligence;
  // other Kling go through C-path i2v chunker). All Kling variants support
  // multi-shot batch dispatch — gating is by family, not by sub-variant.
  {
    id: 'tencent-vod::Kling-1.6',
    family: 'kling',
    label: 'Kling 1.6 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥' },
  },
  {
    id: 'tencent-vod::Kling-2.0',
    family: 'kling',
    label: 'Kling 2.0 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥' },
  },
  {
    id: 'tencent-vod::Kling-2.1',
    family: 'kling',
    label: 'Kling 2.1 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥' },
  },
  {
    id: 'tencent-vod::Kling-2.5',
    family: 'kling',
    label: 'Kling 2.5 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥' },
  },
  {
    id: 'tencent-vod::Kling-2.6',
    family: 'kling',
    label: 'Kling 2.6 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥' },
  },
  {
    id: 'tencent-vod::Kling-O1',
    family: 'kling',
    label: 'Kling-O1 (Tencent)',
    hint: 'B-path 多鏡頭 + 對白同步 · 10 圖參考',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 10, costTier: '¥¥¥' },
  },
  {
    id: 'tencent-vod::Kling-3.0',
    family: 'kling',
    label: 'Kling 3.0 (Tencent)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥¥' },
  },
  {
    id: 'tencent-vod::Kling-3.0-Omni',
    family: 'kling',
    label: 'Kling 3.0-Omni (Tencent)',
    hint: 'B-path 多鏡頭 + 多語 TTS · 10 圖參考 · 推薦預設',
    capabilities: { audio: true, multiShot: true, maxDurationSec: 10, costTier: '¥¥¥' },
  },
  // fal Kling line — i2v multi-shot via C-path chunker
  {
    id: 'fal::fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    family: 'kling',
    label: 'Kling 2.5 Turbo Pro (fal)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥' },
  },
  {
    id: 'fal::fal-ai/kling-video/v3/standard/image-to-video',
    family: 'kling',
    label: 'Kling 3 Standard (fal)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥' },
  },
  {
    id: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
    family: 'kling',
    label: 'Kling 3 Pro (fal)',
    capabilities: { audio: false, multiShot: true, maxDurationSec: 10, costTier: '¥¥¥' },
  },
]

/** Recommended default when no admin / user pref is set yet. */
export const DEFAULT_VARIANT_ID = 'tencent-vod::Kling-3.0-Omni'

const VARIANT_BY_ID: Record<string, VideoModelVariant> = (() => {
  const out: Record<string, VideoModelVariant> = {}
  for (const v of VIDEO_MODEL_VARIANTS) out[v.id] = v
  return out
})()

/** Returns null when the id is not in the registry (legacy / removed). */
export function getVideoModelVariant(id: string | null | undefined): VideoModelVariant | null {
  if (!id) return null
  return VARIANT_BY_ID[id] ?? null
}

/** Variants belonging to a family in registry order. */
export function getVariantsByFamily(family: VideoModelFamily): VideoModelVariant[] {
  return VIDEO_MODEL_VARIANTS.filter((v) => v.family === family)
}

/** Used by the multi-shot button to self-gate. Returns false for any
 *  variant whose capabilities.multiShot is false OR for an unknown id
 *  (fail closed — never assume multi-shot works for a variant we don't
 *  know). */
export function isMultiShotCapable(id: string | null | undefined): boolean {
  const v = getVideoModelVariant(id)
  return v !== null && v.capabilities.multiShot
}
