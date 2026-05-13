/**
 * Style reference picker — chooses the best photographic anchor image
 * for a multi-shot group based on scene/dialogue era keywords.
 *
 * Why this exists:
 *   Kling 3.0-Omni's text-based style anchors (photorealistic, no CG)
 *   lose to its xianxia/wuxia training prior on crowd / period scenes.
 *   Feeding a real photo via SubjectInfos beats the text path because
 *   reference-image attention dominates the prompt-text attention (same
 *   mechanism that pins character identity).
 *
 * Each `realistic` preset variant can declare up to N reference images,
 * tagged with an era hint (period / modern / neutral). The worker resolves
 * each group's era from:
 *   1. The bound scene names (e.g. "唐玄洞府" → period)
 *   2. The combined panel description text
 *   3. Fallback to 'neutral'
 *
 * Conservative behaviour:
 *   - No 'period' keyword AND no 'modern' keyword → 'neutral'
 *   - Both present → 'modern' wins (mixed-era TikTok shorts are usually
 *     framed around modern POV with period flashback)
 *   - All ambiguous → 'neutral'
 *
 * The picker is intentionally keyword-based, not LLM-based:
 *   - Zero added latency / cost per generation
 *   - Deterministic, easy to debug
 *   - Wrong picks degrade gracefully (still a photoreal anchor, just not
 *     era-matched — Kling still extracts lighting/grain/texture cues)
 */

import { STYLE_PROFILE_PRESETS, type PresetKey, type StyleReferenceImage, type StyleRefEraHint } from './presets'

/**
 * Reverse-resolve a preset key from a project's stylePositivePrompt
 * (the only style-related column persisted at project creation).
 *
 * Exact match wins; falls back to null when no preset's positivePrompt
 * matches verbatim. Callers should treat null as "user has a custom
 * positivePrompt — skip preset-specific behaviour like styleReferences".
 *
 * The project DB schema doesn't store the preset key column; this is
 * the source-of-truth path for "which preset is this project on".
 */
export function resolvePresetKeyByPositivePrompt(
  positivePrompt: string | null,
): PresetKey | null {
  if (!positivePrompt) return null
  for (const [key, entry] of Object.entries(STYLE_PROFILE_PRESETS) as Array<[PresetKey, typeof STYLE_PROFILE_PRESETS[PresetKey]]>) {
    if (entry.positivePrompt === positivePrompt) return key
  }
  return null
}

/** Trigger words for period (古裝 / 古代) era. */
const PERIOD_KEYWORDS = [
  // Places
  '洞府', '宮', '殿', '廟', '寺', '觀', '塔', '城牆', '城樓', '皇城',
  '朝廷', '王府', '府邸', '驛站', '庭院', '書院', '校場',
  // Roles / titles
  '弟子', '修士', '師父', '師尊', '仙人', '道長', '皇帝', '皇上', '太子',
  '公主', '王爺', '丞相', '將軍', '武林', '俠客', '門派', '掌門',
  // Objects / wardrobe
  '玉佩', '長劍', '寶劍', '法器', '靈丹', '丹爐', '羅盤', '宣紙',
  '錦袍', '長袍', '官服', '袈裟', '蓑衣', '繡帕', '玉簪',
  // Setting cues
  '古代', '古裝', '盛唐', '大宋', '明朝', '清朝', '春秋', '戰國',
  '修真', '修仙', '武俠', '仙俠', '玄幻',
] as const

/** Trigger words for modern / contemporary era. */
const MODERN_KEYWORDS = [
  // Tech / objects
  '手機', '電話', '電腦', '筆電', '汽車', '計程車', '地鐵', '捷運',
  '紅綠燈', '電梯', '冷氣', '空調', 'WiFi', 'APP', '簡訊',
  // Places
  '公司', '辦公室', '咖啡廳', '便利商店', '便利店', '超市', '機場',
  '高速公路', '停車場', '飯店', '酒店大廳', '酒吧', '夜店', '商場',
  // Wardrobe / cues
  '西裝', '皮鞋', '高跟鞋', '牛仔褲', '運動鞋', 'T恤', '帽T', '球鞋',
  '現代', '當代', '都市', '城市', '網路', '網絡', '社群', '社交媒體',
] as const

/**
 * Lightweight era classifier. Scans a text blob for period vs modern
 * trigger words.
 *
 * Returns:
 *   - 'period':  ≥1 period keyword, 0 modern keywords
 *   - 'modern':  ≥1 modern keyword (with or without period — modern wins
 *     ties because TikTok shorts framing modern POV is more common than
 *     full-period dramas in this codebase's target audience)
 *   - 'neutral': no keyword matches in either pool
 */
export function detectEra(textBlob: string): StyleRefEraHint {
  if (!textBlob) return 'neutral'
  const lowered = textBlob.toLowerCase()
  let periodHits = 0
  let modernHits = 0
  for (const kw of PERIOD_KEYWORDS) {
    if (lowered.includes(kw.toLowerCase())) {
      periodHits++
      if (periodHits >= 1 && modernHits >= 1) break
    }
  }
  for (const kw of MODERN_KEYWORDS) {
    if (lowered.includes(kw.toLowerCase())) {
      modernHits++
      if (periodHits >= 1 && modernHits >= 1) break
    }
  }
  if (modernHits > 0) return 'modern'
  if (periodHits > 0) return 'period'
  return 'neutral'
}

/**
 * Pick the most appropriate style reference image from a preset's pool.
 *
 * Resolution order:
 *   1. Exact era match (e.g. detectedEra='period' → first 'period' ref)
 *   2. 'neutral' ref (safe fallback, era-agnostic)
 *   3. First entry (last-resort — preset declared only one era variant)
 *
 * Entries with empty url are filtered out so unconfigured placeholders
 * don't get sent to Tencent VOD (which would 400 on empty FileInfos.Url).
 *
 * Returns null when no usable entry exists.
 */
export function pickStyleReference(
  pool: StyleReferenceImage[] | undefined,
  detectedEra: StyleRefEraHint,
): StyleReferenceImage | null {
  if (!pool || pool.length === 0) return null
  const usable = pool.filter((r) => typeof r.url === 'string' && r.url.trim().length > 0)
  if (usable.length === 0) return null
  const exact = usable.find((r) => r.eraHint === detectedEra)
  if (exact) return exact
  const neutral = usable.find((r) => r.eraHint === 'neutral')
  if (neutral) return neutral
  return usable[0]
}
