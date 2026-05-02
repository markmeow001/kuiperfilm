import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import { generateVideo } from '@/lib/generator-api'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
  parseImageUrls,
} from './image-task-handler-shared'

interface CharacterAppearanceForBPath {
  id: string
  changeReason: string | null
  imageUrls: string | null
  imageUrl: string | null
  selectedIndex: number | null
}

interface CharacterForBPath {
  id: string
  name: string
  appearances?: CharacterAppearanceForBPath[]
}
import {
  assertTaskActive,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'

interface BPathPanel {
  id: string
  description: string | null
  videoPrompt: string | null
  characters: string | null
  /**
   * Free-form scene name written by the analyze worker — typically
   * `<locationName>` or `<locationName>#<viewHint>` (Approach B-Standard).
   * We use the bare name to look up Location entities for SubjectInfos.
   */
  location: string | null
  /** "平视中景" / "仰拍特写" / "越肩近景" — passed straight to the prompt. */
  shotType: string | null
  /** "缓缓推近" / "手持跟随" / "猛然拉远" — appended after the visual body. */
  cameraMove: string | null
  /**
   * User-edited dialogue / SRT segment for this panel. Wins over
   * NovelPromotionVoiceLine when non-empty so the user can fix
   * mis-translated dialogue from the UI without re-running analysis.
   */
  srtSegment?: string | null
  imageUrl: string | null
  storyboardId: string
}

interface LocationImageForBPath {
  imageIndex?: number | null
  imageUrl?: string | null
  isSelected?: boolean | null
  viewName?: string | null
}

interface LocationForBPath {
  id: string
  name: string
  images?: LocationImageForBPath[]
}

interface BPathProjectData {
  characters?: CharacterForBPath[]
  locations?: LocationForBPath[]
}

interface BPathDialogueLine {
  speaker: string
  content: string
}

/** Per-shot entry that maps to Kling 3-Omni's customize-mode multi_prompt. */
export interface BPathShotPromptEntry {
  index: number
  prompt: string
  duration: number
}

/** Maximum total Duration accepted by Kling 3 / 3-Omni (std/pro). */
export const KLING_OMNI_MAX_TOTAL_DURATION = 15
/** Default per-shot allocation when caller does not specify durations. */
export const KLING_OMNI_DEFAULT_PER_SHOT_DURATION = 3
/** Tencent doc constraint: customize-mode multi_prompt allows at most 6 shots. */
export const KLING_OMNI_MAX_SHOTS = 6

/**
 * Build a per-panel shot fragment (no `镜头N:` prefix) that mixes the
 * visual + motion prompt with any matched dialogue. Used by both modes:
 * intelligence concatenates the fragments under `镜头N:`, customize
 * embeds them as discrete multi_prompt entries.
 *
 * Priority: description over videoPrompt. The script_to_storyboard
 * worker writes description with the original character names
 * (e.g. "劉浩重重倒在水洼中，陳子豪站在前方") and videoPrompt with
 * anonymised generic phrasing (e.g. "一名年轻男子重重倒在…另一名年轻男子站立")
 * so non-subject-aware image models can render shots without context.
 * Kling Omni's SubjectInfos.N pipeline ANCHORS subjects by name match
 * — feeding it the anonymised version causes identity confusion (e.g.
 * the wrong character falls in the puddle). Reproduced 2026-05-01:
 * uneven-duration regen of panels 1-5 had Chen Zihao falling instead
 * of Liu Hao because videoPrompt only said "另一名年轻男子".
 */
/**
 * Escape regex metacharacters in a literal string. Character names
 * may contain `()`, `.`, `?`, etc. (e.g. "Mary J. Blige"); raw
 * concatenation into a regex would mis-match.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip parenthetical stage directions from a dialogue line so they
 * don't reach Kling's TTS engine and get dubbed as if they were spoken
 * words.
 *
 * Examples (all should be removed):
 *   "(Susurrando) Feliz cumpleaños"      → "Feliz cumpleaños"
 *   "(softly) Are you sure?"              → "Are you sure?"
 *   "（在心里）我恨你"                    → "我恨你"
 *   "I love you (sobbing)"                → "I love you"
 *
 * Cap parenthetical length at 30 chars to avoid eating legitimate
 * inline parentheticals that happen to be part of dialogue (e.g.
 * "I told you (and I meant it) — leave"). 30 chars covers all
 * common stage-direction phrases without false positives.
 */
function stripParentheticalStageDirections(content: string): string {
  return content
    .replace(/\([^)]{1,30}\)/g, '')
    .replace(/（[^）]{1,30}）/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detect dialogue language from the line content using only highly
 * distinctive code points / characters. We deliberately avoid common-word
 * heuristics ("el", "la", "the") because they false-positive across
 * latin-alphabet languages and against character names.
 *
 * Returns the English language name suitable for inlining into a Kling
 * prompt hint (`TOBY (in Spanish): "..."`), or null when the line is
 * Chinese / English / unknown — let Kling auto-detect those.
 *
 * Why we bother: Kling 3.0-Omni's TTS does support CN/EN/JA/KO/ES
 * natively (per klingaio.com/blogs/kling-3-release + 2026 reviews),
 * but it picks the language by analyzing the *entire shot prompt*. Our
 * per-shot prompt is ~120 chars 中文 visual description + ~80 chars of
 * Spanish dialogue → the parser sees a mostly-Chinese prompt and
 * Mandarin-defaults the dub. Adding a tiny English-language hint
 * `(in Spanish)` to the dialogue line nudges the parser onto the
 * right voice without touching the visual portion.
 */
function detectDialogueLanguage(content: string): string | null {
  if (/[぀-ゟ゠-ヿ]/.test(content)) return 'Japanese' // hiragana / katakana
  if (/[가-힯]/.test(content)) return 'Korean' // hangul
  if (/[一-鿿]/.test(content)) return null // CJK Chinese — let Kling auto-detect (it's good at zh)
  // Spanish-specific characters that don't appear in English / French / German.
  if (/[ñ¿¡]/.test(content)) return 'Spanish'
  // French-specific: cedilla / ligatures.
  if (/[çœ]/.test(content)) return 'French'
  // German-specific: eszett / umlauts. Umlauts also appear in Turkish and
  // some Scandinavian languages, but eszett is a strong German signal.
  if (/ß/.test(content)) return 'German'
  if (/[äöü]/.test(content) && /\b(?:der|die|das|und|ist|nicht|ich|ein|sind)\b/i.test(content)) return 'German'
  // Russian / Cyrillic.
  if (/[Ѐ-ӿ]/.test(content)) return 'Russian'
  // No distinctive markers → leave it to Kling's auto-detect (English /
  // unknown). Adding `(in English)` for purely-English lines isn't
  // harmful but adds prompt-length noise, so we skip it.
  return null
}

function formatDialogueForKling(speaker: string, content: string): string {
  const lang = detectDialogueLanguage(content)
  // Kling Omni's native dialogue format (klingai.com webUI / direct API)
  // is `Character: "line"` — speaker name, colon, then the quoted line
  // verbatim. The optional `(in <Language>)` parenthetical is a
  // documented Kling 3.0-Omni convention for steering the per-line TTS
  // when the surrounding shot prompt is in a different language than
  // the dialogue (the 2026-05-02 user-reported case: Chinese visual
  // descriptions paired with Spanish dialogue → Kling defaulted to
  // Mandarin TTS without this hint).
  return lang
    ? `${speaker} (in ${lang}): "${content}"`
    : `${speaker}: "${content}"`
}

/**
 * Strip stage directions from a panel.srtSegment so only the actual
 * spoken line reaches Kling's TTS. The analyze worker sometimes
 * dumps mixed narration + dialogue into srtSegment, e.g.:
 *
 *   "SARAH嘴巴张大，震惊不已。 SARAH: Dios mío... ¿Catherine?"
 *   "慢镜头：CATHERINE面对高墙，没有减速，单脚蹬墙..." (no dialogue)
 *
 * We try in order:
 *   1. quoted spans `「...」` / `"..."` / `"..."` — usually the line
 *   2. text after `<NAME>: ` or `<NAME>说："..."` — speaker-tagged
 *   3. drop the whole content if it looks like pure stage direction
 *      (no dialogue indicators)
 *
 * Returns `{ speaker, content }` where speaker overrides the panel
 * default when a name was tagged in the segment, and content is the
 * cleaned-up line. Returns `null` when no actual dialogue could be
 * found — caller should treat the panel as silent rather than
 * dubbing the stage direction.
 */
function extractSpokenLineFromSrtSegment(
  raw: string,
  fallbackSpeaker: string,
): { speaker: string; content: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const QUOTE_OPEN = '「"“”'
  const QUOTE_CLOSE = '」"”“'

  // 1. Speaker-tagged dialogue with explicit quoting:
  //    `SPEAKER说："line"` / `SPEAKER说"line"` / `SPEAKER:「line」`
  const taggedQuoted = trimmed.match(
    /([一-鿿A-Za-z][一-鿿A-Za-z\d_]*)\s*(?:说|says?)\s*[:：]?\s*[「"“”]([\s\S]+?)[」"”“]/i,
  )
  if (taggedQuoted) {
    const content = stripParentheticalStageDirections(taggedQuoted[2])
    if (content) return { speaker: taggedQuoted[1].trim() || fallbackSpeaker, content }
  }

  // 2. Speaker-tagged colon style: `SPEAKER: spoken text...`
  //    Greedy to end of segment unless another bracketed action shows
  //    up (`(stage direction)` etc.). Skip if the trailing content
  //    itself reads like a description (no spoken-line indicators).
  const taggedColon = trimmed.match(
    /([一-鿿A-Za-z][一-鿿A-Za-z\d_]*)\s*[:：]\s*([\s\S]+)$/,
  )
  if (taggedColon) {
    let content = taggedColon[2].trim()
    // Strip any leading/trailing quote characters around the captured line.
    content = content.replace(new RegExp(`^[${QUOTE_OPEN}]|[${QUOTE_CLOSE}]$`, 'g'), '').trim()
    content = stripParentheticalStageDirections(content)
    if (content && !looksLikeStageDirection(content)) {
      return { speaker: taggedColon[1].trim() || fallbackSpeaker, content }
    }
  }

  // 3. Plain quoted span anywhere in the text — strip everything else
  //    and dub just that span.
  const bareQuoted = trimmed.match(new RegExp(`[${QUOTE_OPEN}]([\\s\\S]+?)[${QUOTE_CLOSE}]`))
  if (bareQuoted) {
    const content = stripParentheticalStageDirections(bareQuoted[1])
    if (content && !looksLikeStageDirection(content)) {
      return { speaker: fallbackSpeaker, content }
    }
  }

  // 4. Pure stage direction with no dialogue — silent panel.
  return null
}

/**
 * Quick heuristic to drop a line that's clearly a camera / action
 * description rather than spoken dialogue. We err on the side of
 * letting things through (false positives skip dub for a real line)
 * rather than letting stage directions reach Kling's TTS (which
 * dubs them as if they were speech — broken UX).
 */
function looksLikeStageDirection(content: string): boolean {
  if (!content.trim()) return true
  const STAGE_KEYWORDS = [
    '镜头', '特写', '近景', '中景', '全景', '远景', '俯拍', '仰拍', '俯视', '仰视',
    '推近', '拉远', '跟随', '环绕', '推轨', '运镜', '画面', '光影', '焦点',
    '慢动作', '慢镜头', '快速', '定格', '过场', '剪辑', '转场',
    '画外音', '旁白', '字幕',
    'CAMERA', 'CLOSE-UP', 'WIDE SHOT', 'PAN', 'CUT TO', 'FADE',
  ] as const
  for (const kw of STAGE_KEYWORDS) {
    if (content.includes(kw)) return true
  }
  // Removed (2026-05-02): the "long-without-speech-marker" rule
  // ( length>40 && no `!?` ) silently dropped legitimate non-CJK
  // dialogue. Spanish / French / English declarative dialogue routinely
  // ends with `.` and runs over 40 chars (e.g. "Gracias por el dinero.
  // No me esperes para cenar..."), so the rule misclassified essentially
  // every non-Mandarin line as stage direction. Result: dialogueByPanel
  // ended up empty for those panels → multi_prompt[].prompt held only
  // the Chinese visual description → Kling dubbed the description in
  // Mandarin. SARAH's exclamation-heavy line was the only one that
  // survived, which is exactly the "only one segment speaks Mandarin"
  // pattern user reported.
  //
  // The STAGE_KEYWORDS check above is enough to catch the original
  // false-negative case ("慢动作中景:CATHERINE...") because every real
  // stage direction we see in srtSegment contains one of those keywords.
  return false
}

/**
 * Replace character / scene names in a visual prompt with Kling
 * 3.0-Omni's `<<<image_N>>>` reference syntax. Per VOD AIGC 接入指南
 * §3.9.2 example 2 (multi-image 参考生视频):
 *
 *   "Prompt": "让 <<<image_1>>> 牵着 <<<image_2>>> 转圈圈"
 *
 * The N is positional and 1-indexed against FileInfos array order;
 * the caller passes a map built from subjectInfos so the slot order
 * stays in sync.
 *
 * Longer names get substituted first so "CATHERINE" doesn't clobber
 * "CATH" matches accidentally. Match is case-insensitive because
 * panel descriptions sometimes lowercase the entity name.
 *
 * Dialogue speakers are NOT substituted — Kling Omni's audio dub
 * pipeline parses `${speaker}说："${content}"` to identify the
 * voice owner, and `<<<image_N>>>说："..."` is not recognised.
 */
function substituteImageRefs(text: string, nameToImageIndex: ReadonlyMap<string, number>): string {
  if (!text || nameToImageIndex.size === 0) return text
  const sortedNames = Array.from(nameToImageIndex.keys()).sort((a, b) => b.length - a.length)
  let out = text
  for (const name of sortedNames) {
    const idx = nameToImageIndex.get(name)
    if (!idx) continue
    out = out.replace(new RegExp(escapeRegex(name), 'gi'), `<<<image_${idx}>>>`)
  }
  return out
}

/**
 * Replace the bare names of project characters that did NOT make it
 * into the 3-slot SubjectInfos cap with anonymous role placeholders.
 *
 * Why: when a multi-shot group has more than 3 unique characters,
 * Tencent VOD's hard `FileInfos.N: 3` limit (Kling-Omni doc §1.1.1)
 * means at least one character ships without a reference image.
 * If we leave the unbound character's name in the visual prompt,
 * Kling tries to invent that identity from scratch and the resulting
 * face never matches what the user sees in their character roster
 * — the 2026-05-02 GROUP 04 case where BRUCE rendered as a stranger.
 *
 * Replacing "BRUCE" with "另一名男子" (or "另一人") tells Kling to
 * draw a generic background figure instead of attempting the wrong
 * identity. We also append a brief framing hint so the camera keeps
 * its focus on the bound speaker(s) rather than wide-shotting the
 * unbound character.
 *
 * Order matters: longest names first to avoid clobbering shorter
 * substrings (mirrors substituteImageRefs's behaviour).
 */
function rewriteForUnboundCharacters(
  text: string,
  unboundNames: ReadonlySet<string>,
): { rewritten: string; hadUnbound: boolean } {
  if (!text || unboundNames.size === 0) return { rewritten: text, hadUnbound: false }
  const sortedNames = Array.from(unboundNames).sort((a, b) => b.length - a.length)
  let out = text
  let hadUnbound = false
  for (const name of sortedNames) {
    if (!name) continue
    const re = new RegExp(escapeRegex(name), 'gi')
    if (!re.test(out)) continue
    hadUnbound = true
    re.lastIndex = 0
    out = out.replace(re, '另一人')
  }
  return { rewritten: out, hadUnbound }
}

function buildShotBody(
  panel: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>,
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  nameToImageIndex?: ReadonlyMap<string, number>,
  unboundNames?: ReadonlySet<string>,
): string {
  const rawVisual = (panel.description || panel.videoPrompt || '').trim()
  // Order: substitute bound characters with <<<image_N>>> first, THEN
  // anonymise unbound names. Doing it the other way would replace the
  // unbound names with "另一人" before substituteImageRefs sees them,
  // which is fine, but doing image refs first lets us keep the speaker
  // identity precise for the close-up directive.
  let visual = nameToImageIndex
    ? substituteImageRefs(rawVisual, nameToImageIndex)
    : rawVisual
  let unboundFraming = ''
  if (unboundNames && unboundNames.size > 0) {
    const { rewritten, hadUnbound } = rewriteForUnboundCharacters(visual, unboundNames)
    visual = rewritten
    if (hadUnbound) {
      // Append a Chinese framing hint so Kling biases toward the bound
      // speaker instead of giving the anonymised unbound character
      // foreground real-estate. Keep it terse — long instructions hurt
      // Kling's per-shot 512-char budget.
      const speakerLine = dialogueByPanelId.get(panel.id) ?? []
      const speakerName = speakerLine[0]?.speaker
      const speakerSlot = speakerName && nameToImageIndex?.get(speakerName)
      unboundFraming = speakerSlot
        ? `\n[镜头聚焦于<<<image_${speakerSlot}>>>，其他人物虚化或在画外]`
        : `\n[镜头聚焦于主体角色，其他人物虚化或在画外]`
    }
  }
  const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
    .map((d) => formatDialogueForKling(d.speaker, d.content))
    .join(' ')
  const body = dialogues ? `${visual}\n${dialogues}`.trim() : visual
  return unboundFraming ? `${body}${unboundFraming}` : body
}

/**
 * Auto-assemble a Seedance-style 5-element prompt from existing panel
 * data — time-indexed segments, entity tags `[name]` matching
 * SubjectInfos.N, dialogue inline as `[speaker]: "line"`. Used by
 * intelligence mode by default so Kling's parser gets a structured
 * prompt that mirrors the format we manually validated produced the
 * cleanest action sequences.
 *
 * Time slices fall through `distributeShotDurations` → 3s/panel default,
 * capped at 15s total. Caller-supplied durations win when provided
 * (length must match panels).
 *
 * Format per shot:
 *   `<start>-<end> seconds: [scene] - [character1] [character2] body. (cameraMove). [speaker]: "dialogue"`
 *
 * Example:
 *   0-3 seconds: [废弃工业区_破晓] - [劉浩] 近景：劉浩眉頭緊鎖大吼出聲 (急速推近) [劉浩]: "操！"
 *
 * Notes:
 * - Scene tag uses the bare location name (strips `#viewHint`).
 * - Entity name brackets are 1:1 with SubjectInfos.N.Name so Kling can
 *   anchor visuals — same fix that resolved the wrong-character-falls
 *   bug on 2026-05-01.
 * - cameraMove is wrapped in parens to keep it grammatically
 *   self-contained when missing.
 * - Empty visual + no dialogue panels are dropped (consistent with
 *   buildBPathCombinedPrompt) and time slices recompute around them.
 */
export function buildSeedancePrompt(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt' | 'characters' | 'location' | 'shotType' | 'cameraMove'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  requestedDurations?: number[],
  nameToImageIndex?: ReadonlyMap<string, number>,
): string {
  // Drop empty panels first so time accounting matches what makes it
  // into the output.
  const nonEmpty = panels.filter((p) => {
    const visual = (p.description || p.videoPrompt || '').trim()
    if (visual) return true
    return (dialogueByPanelId.get(p.id) ?? []).length > 0
  })
  if (nonEmpty.length === 0) return ''

  // Filter durations to non-empty panel positions if caller supplied
  // an array sized for the original panels list.
  let trimmedDurations: number[] | undefined
  if (requestedDurations && requestedDurations.length === panels.length) {
    trimmedDurations = []
    panels.forEach((p, idx) => {
      if (nonEmpty.includes(p)) trimmedDurations!.push(requestedDurations[idx])
    })
  } else if (requestedDurations) {
    trimmedDurations = requestedDurations
  }

  const { durations } = distributeShotDurations(nonEmpty.length, trimmedDurations)

  const lines: string[] = []
  let cursor = 0
  for (let i = 0; i < nonEmpty.length; i++) {
    const panel = nonEmpty[i]
    const start = cursor
    const end = cursor + durations[i]
    cursor = end

    const sceneRaw = (panel.location || '').trim()
    const sceneName = sceneRaw.includes('#') ? sceneRaw.split('#')[0].trim() : sceneRaw
    const sceneTag = sceneName ? `[${sceneName}]` : ''

    const charRefs = parsePanelCharacterReferences(panel.characters)
    const charTags = charRefs.map((r) => `[${r.name}]`).join(' ')

    const rawVisual = (panel.description || panel.videoPrompt || '').trim()
    const visual = nameToImageIndex
      ? substituteImageRefs(rawVisual, nameToImageIndex)
      : rawVisual
    const camMove = (panel.cameraMove || '').trim()

    const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
      .map((d) => `[${d.speaker}]: "${d.content}"`)
      .join(' ')

    const parts: string[] = [`${start}-${end} seconds:`]
    if (sceneTag) {
      parts.push(sceneTag)
      if (charTags) parts.push('-')
    }
    if (charTags) parts.push(charTags)
    if (visual) parts.push(visual)
    if (camMove) parts.push(`(${camMove})`)
    if (dialogues) parts.push(dialogues)

    lines.push(parts.join(' '))
  }
  return lines.join('\n\n')
}

/**
 * Build the combined `镜头N:` prompt that Kling Omni 3 ingests, including
 * matched dialogue lines so generate_audio:true dubs the script's actual
 * dialogue (otherwise the model invents talking sounds). Exposed for unit
 * tests; the runtime path calls it from runMultiShotBPath below.
 */
export function buildBPathCombinedPrompt(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  nameToImageIndex?: ReadonlyMap<string, number>,
  unboundNames?: ReadonlySet<string>,
): string {
  return panels
    .map((panel, i) => {
      const body = buildShotBody(panel, dialogueByPanelId, nameToImageIndex, unboundNames)
      return `镜头${i + 1}: ${body}`
    })
    .filter((line) => line.trim().length > `镜头N: `.length)
    .join('\n\n')
}

/**
 * Distribute a total duration across N shots. When caller passes
 * `requestedDurations` we trust them after validating sum / range; when
 * undefined we hand out KLING_OMNI_DEFAULT_PER_SHOT_DURATION each, capped
 * at KLING_OMNI_MAX_TOTAL_DURATION (excess truncated from the tail).
 *
 * Returns `{ durations, totalDuration }` so the caller can drop both
 * into the Kling payload (Duration = totalDuration, multi_prompt[i].duration
 * = durations[i]).
 */
export function distributeShotDurations(
  shotCount: number,
  requestedDurations: number[] | undefined,
): { durations: number[]; totalDuration: number } {
  if (shotCount <= 0) {
    throw new Error('SHOT_COUNT_INVALID: at least one shot required')
  }
  if (shotCount > KLING_OMNI_MAX_SHOTS) {
    throw new Error(`SHOT_COUNT_TOO_MANY: ${shotCount} exceeds Kling Omni's ${KLING_OMNI_MAX_SHOTS}-shot cap`)
  }

  if (requestedDurations) {
    if (requestedDurations.length !== shotCount) {
      throw new Error(
        `PANEL_DURATIONS_LENGTH_MISMATCH: expected ${shotCount} durations, got ${requestedDurations.length}`,
      )
    }
    for (const d of requestedDurations) {
      if (!Number.isFinite(d) || d < 1) {
        throw new Error('PANEL_DURATION_INVALID: each duration must be a finite number ≥1 second')
      }
    }
    const total = requestedDurations.reduce((a, b) => a + b, 0)
    if (total > KLING_OMNI_MAX_TOTAL_DURATION) {
      throw new Error(
        `TOTAL_DURATION_EXCEEDS_LIMIT: ${total}s exceeds Kling Omni's ${KLING_OMNI_MAX_TOTAL_DURATION}s cap`,
      )
    }
    if (total < shotCount) {
      throw new Error('TOTAL_DURATION_BELOW_MIN: each shot needs at least 1s')
    }
    return { durations: requestedDurations.map((d) => Math.round(d)), totalDuration: total }
  }

  // Default: KLING_OMNI_DEFAULT_PER_SHOT_DURATION seconds per shot,
  // capped at the model's hard ceiling. With 5 shots × 3s = 15s; 6 shots
  // truncates the last second to stay within budget (we just take
  // floor(15/6) = 2s each plus distribute the remainder).
  const idealTotal = shotCount * KLING_OMNI_DEFAULT_PER_SHOT_DURATION
  const totalDuration = Math.min(idealTotal, KLING_OMNI_MAX_TOTAL_DURATION)
  const base = Math.floor(totalDuration / shotCount)
  const remainder = totalDuration - base * shotCount
  const durations = Array.from({ length: shotCount }, (_, i) => base + (i < remainder ? 1 : 0))
  return { durations, totalDuration }
}

/**
 * Customize-mode payload builder. Returns the multi_prompt array Kling
 * expects (ordered by shot index, 1-based). Filters out shots that have
 * neither visual nor dialogue content — same guard as the intelligence
 * builder — and re-numbers indices so the array stays compact (Kling
 * rejects gaps in `index`).
 */
export function buildBPathCustomizePrompts(
  panels: Pick<BPathPanel, 'id' | 'description' | 'videoPrompt'>[],
  dialogueByPanelId: ReadonlyMap<string, BPathDialogueLine[]>,
  durations: number[],
  nameToImageIndex?: ReadonlyMap<string, number>,
  unboundNames?: ReadonlySet<string>,
): BPathShotPromptEntry[] {
  if (panels.length !== durations.length) {
    throw new Error(
      `PANEL_DURATION_PAIRING_MISMATCH: ${panels.length} panels vs ${durations.length} durations`,
    )
  }
  const out: BPathShotPromptEntry[] = []
  panels.forEach((panel, i) => {
    const body = buildShotBody(panel, dialogueByPanelId, nameToImageIndex, unboundNames)
    if (!body.trim()) return
    out.push({ index: out.length + 1, prompt: body, duration: durations[i] })
  })
  return out
}

/**
 * Tencent VOD Kling-Omni multi-shot path.
 *
 * Builds a single CreateAigcVideoTask with:
 *   - SubjectInfos.N for character consistency — first three speaking
 *     characters across the selected panels, each with their primary
 *     appearance image as the visual anchor.
 *   - One of two ExtInfo shapes:
 *     * **intelligence mode** (legacy default, total fixed 10s/5s):
 *       single combined Prompt ("镜头1: ... 镜头2: ...") with
 *       multi_shot=intelligence; Kling picks shot boundaries itself.
 *     * **customize mode** (new, total = sum of per-shot durations,
 *       up to 15s): multi_prompt array with explicit `{index, prompt,
 *       duration}` per shot; gives caller per-shot timing control.
 *       Falls into customize automatically if the caller supplies
 *       `panelDurations`, or requests `mode: 'customize'`.
 *
 * No imageUrl required on individual panels — this is text-to-video.
 */
export async function runMultiShotBPath(params: {
  job: Job<TaskJobData>
  validPanels: BPathPanel[]
  projectData: BPathProjectData
  videoModel: string
  sound?: boolean
  aspectRatio?: string
  /**
   * 'intelligence' (default) — model auto-decides shot boundaries.
   * 'customize' — every panel gets a fixed per-shot duration. Implicit
   * 'customize' when panelDurations is provided regardless of this flag.
   *
   * NB: payload.mode is already taken by the std/pro resolution selector
   * upstream — the multi-shot mode rides on its own field name.
   */
  multiShotMode?: 'intelligence' | 'customize'
  /**
   * Explicit per-shot durations matching panel order. Length must equal
   * panel count, each ≥1s, sum ≤15s. When omitted in customize mode,
   * defaults to KLING_OMNI_DEFAULT_PER_SHOT_DURATION per shot capped at
   * KLING_OMNI_MAX_TOTAL_DURATION.
   */
  panelDurations?: number[]
  /**
   * Caller-supplied final prompt that bypasses panel-based assembly.
   * Intended for hand-crafted Seedance-style 5-element prompts where
   * a single 15s segment internally describes 3-5 micro-shots with
   * time markers ("0-5 seconds: ... 5-10 seconds: ..."). Only honoured
   * in `intelligence` mode — customize mode requires per-shot prompts
   * via multi_prompt array, so rawPrompt is ignored there.
   *
   * Dialogue injection still happens — voiceLines matched to any of
   * the supplied panels are appended at the end as 「角色说: "对白"」
   * lines (so caller does not have to embed dialogue manually). If the
   * raw prompt already contains dialogue and you want to skip the
   * automatic append, omit the relevant panels from panelIds.
   */
  rawPrompt?: string
  /**
   * Intelligence-mode prompt assembly strategy. Ignored when rawPrompt
   * is provided (caller wins) or when multiShotMode is 'customize'.
   *
   * - 'panel-numbered' (DEFAULT, 2026-05-01 retest): `镜头N:` Chinese
   *   numbered list, total 10s. Tight rapid-cut pacing — verified
   *   most satisfying on action sequences (gunfight, fight choreo)
   *   where Kling's 15s render window degrades visual fidelity in
   *   later shots.
   * - 'auto-seedance': time-indexed
   *   `Xs-Ys: [scene] - [char] body (cameraMove). [speaker]: "line"`
   *   format. Spreads 15s across panels with soft cut hints — better
   *   suited to dialogue / reaction / small-action segments.
   *   Explicitly opt in for narrative scenes; default 'panel-numbered'
   *   covers the common case without surprising regressions.
   */
  promptStyle?: 'auto-seedance' | 'panel-numbered'
  /**
   * Pin specific character appearances (override the auto-collector's
   * pick of `appearances[0]` or the EpisodeCharacter binding). Lets a
   * UI ship a "switch costume" affordance per multi-shot call.
   *
   * Each entry { characterId, appearanceId? }:
   *   - If appearanceId given, force-use that appearance row.
   *   - If appearanceId omitted, force-include the character but let
   *     the auto-collector still pick the appearance.
   *
   * Characters NOT in this list still get auto-collected from
   * panel.characters references — overrides only adjust what was
   * already going to be included, they do not curate the subject set.
   */
  characterOverrides?: Array<{ characterId: string; appearanceId?: string }>
  /**
   * Pin specific location image views. Each entry { locationId,
   * viewName? }:
   *   - viewName selects a particular image in location.images[]
   *     (LocationImage.viewName).
   *   - When omitted, falls through to the existing isSelected →
   *     imageIndex=0 picking order.
   *
   * Same scoping rule as character overrides — only adjusts auto-
   * collected scenes, doesn't add ones panels never referenced.
   */
  locationOverrides?: Array<{ locationId: string; viewName?: string }>
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  shotCount: number
  subjectCount: number
  path: 'B'
  multiShotMode: 'intelligence' | 'customize'
  durations?: number[]
  promptSource?: 'panels' | 'raw' | 'seedance'
  /**
   * Bindings actually used by Kling for this generation, grouped by
   * entity kind so the UI can render chips ("出场角色 / 场景") and
   * surface override affordances (swap costume, swap view).
   */
  bindings: {
    characters: Array<{
      id: string
      name: string
      appearanceId: string | null
      appearanceLabel: string | null
      imageUrl: string
    }>
    scenes: Array<{
      id: string
      name: string
      viewName: string | null
      imageUrl: string
    }>
  }
}> {
  const {
    job,
    validPanels,
    projectData,
    videoModel,
    sound,
    aspectRatio,
    panelDurations,
    rawPrompt,
    characterOverrides,
    locationOverrides,
  } = params
  const charOverrideById = new Map<string, string | undefined>()
  for (const o of characterOverrides ?? []) {
    if (typeof o.characterId === 'string' && o.characterId) {
      charOverrideById.set(o.characterId, o.appearanceId)
    }
  }
  const locOverrideById = new Map<string, string | undefined>()
  for (const o of locationOverrides ?? []) {
    if (typeof o.locationId === 'string' && o.locationId) {
      locOverrideById.set(o.locationId, o.viewName)
    }
  }
  // Implicit promotion: caller passing panelDurations means they care
  // about per-shot timing; force customize regardless of the mode flag.
  const multiShotMode: 'intelligence' | 'customize' =
    panelDurations !== undefined ? 'customize' : (params.multiShotMode ?? 'intelligence')
  const { userId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-video-b-path',
    action: 'multi_shot_video_b_path_generate',
  })

  // Phase 11.4 / multi-appearance: pre-load EpisodeCharacter bindings
  // for the storyboard's episode so per-character costume overrides
  // apply to multi-shot generation too. All selected panels live under
  // the same storyboard, which lives under one episode.
  let episodeBindings = new Map<string, string>()
  const firstStoryboardId = validPanels[0]?.storyboardId
  if (firstStoryboardId) {
    const sb = await prisma.novelPromotionStoryboard.findUnique({
      where: { id: firstStoryboardId },
      select: { episodeId: true },
    })
    if (sb?.episodeId) {
      const rows = await prisma.episodeCharacter.findMany({
        where: { episodeId: sb.episodeId, appearanceId: { not: null } },
        select: { characterId: true, appearanceId: true },
      })
      for (const row of rows) {
        if (row.appearanceId) episodeBindings.set(row.characterId, row.appearanceId)
      }
    }
  }

  // Collect unique characters in panel order, resolve their appearance
  // image, and remember the full entity tuple for the response payload.
  // Resolution priority for appearance:
  //   1. characterOverrides[characterId].appearanceId (caller pin)
  //   2. EpisodeCharacter binding (cross-episode costume change)
  //   3. ref.appearance match against changeReason (legacy contract)
  //   4. appearances[0] (fallback)
  type CharacterBinding = {
    id: string
    name: string
    appearanceId: string | null
    appearanceLabel: string | null
    imageUrl: string
  }
  const characterBindings: CharacterBinding[] = []
  const seenCharIds = new Set<string>()
  for (const panel of validPanels) {
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      if (seenCharIds.has(character.id)) continue
      const appearances = character.appearances || []

      let appearance = appearances[0]
      const overrideAppearanceId = charOverrideById.get(character.id)
      const boundAppearanceId = episodeBindings.get(character.id)
      if (overrideAppearanceId) {
        const ov = appearances.find((a) => a.id === overrideAppearanceId)
        if (ov) appearance = ov
      } else if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      } else if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue

      seenCharIds.add(character.id)
      characterBindings.push({
        id: character.id,
        name: ref.name,
        appearanceId: appearance.id ?? null,
        appearanceLabel: appearance.changeReason || null,
        imageUrl: publicUrl,
      })
    }
  }
  // ── 2026-05-02 fix: pull speakers from panel.srtSegment as a fallback
  // character source. The analyze pipeline sometimes misses a speaker in
  // panel.characters JSON even when the panel description clearly stages
  // them (user-reported group-04 had TOBY appear visually + speak, but
  // panel.characters[] left TOBY out across all 5 panels). Without this
  // fallback, TOBY would never get a reference image and Kling rendered
  // a stranger lip-syncing TOBY's line.
  //
  // We re-use the same SRT-segment regexes as `extractSpokenLineFromSrtSegment`
  // but only capture the speaker name. Names that already appear in
  // characterBindings are skipped (seenCharIds dedup); names that don't
  // resolve to a project character are dropped (they may be one-off
  // narrators or typos).
  const speakerNamePattern = /([一-鿿A-Za-z][一-鿿A-Za-z\d_]{0,30})\s*(?:说|says?)?\s*[:：]/g
  for (const panel of validPanels) {
    const srt = (panel.srtSegment ?? '').trim()
    if (!srt) continue
    speakerNamePattern.lastIndex = 0
    const candidates = new Set<string>()
    for (const m of srt.matchAll(speakerNamePattern)) {
      const name = m[1]?.trim()
      if (name) candidates.add(name)
    }
    for (const name of candidates) {
      const character = findCharacterByName(projectData.characters || [], name)
      if (!character || seenCharIds.has(character.id)) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const overrideAppearanceId = charOverrideById.get(character.id)
      const boundAppearanceId = episodeBindings.get(character.id)
      if (overrideAppearanceId) {
        const ov = appearances.find((a) => a.id === overrideAppearanceId)
        if (ov) appearance = ov
      } else if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenCharIds.add(character.id)
      characterBindings.push({
        id: character.id,
        name: character.name,
        appearanceId: appearance.id ?? null,
        appearanceLabel: appearance.changeReason || null,
        imageUrl: publicUrl,
      })
    }
  }
  // ── Speaker-priority sort BEFORE the 3-slot cap.
  //
  // Kling Omni accepts at most 3 reference images per task (Tencent
  // VOD AIGC §1.1.1 + §3.9). When a group has >3 unique characters,
  // dropping a SPEAKING character has a much louder visual+audio
  // failure than dropping a background-only character (the speaker's
  // body / lips will lip-sync to a stranger's face). Sort speakers
  // first so the slice favours them.
  const speakerNames = new Set<string>()
  for (const panel of validPanels) {
    const srt = (panel.srtSegment ?? '').trim()
    if (!srt) continue
    speakerNamePattern.lastIndex = 0
    for (const m of srt.matchAll(speakerNamePattern)) {
      const name = m[1]?.trim()?.toLowerCase()
      if (name) speakerNames.add(name)
    }
  }
  characterBindings.sort((a, b) => {
    const aSpeaks = speakerNames.has(a.name.toLowerCase()) ? 0 : 1
    const bSpeaks = speakerNames.has(b.name.toLowerCase()) ? 0 : 1
    return aSpeaks - bSpeaks
  })
  // Tencent caps SubjectInfos at 3 entries per CreateAigcVideoTask. Take
  // characters first (typically 1-3 speaking roles drive the visual),
  // then fill remaining slots with location/scene reference images so
  // Kling has a consistent backdrop anchor across shots. Without scene
  // anchoring the same alleyway tends to drift in lighting/material
  // between cuts.
  const characterSubjects = characterBindings.map((c) => ({
    name: c.name,
    imageUrls: [c.imageUrl],
  }))

  type SceneBinding = {
    id: string
    name: string
    viewName: string | null
    imageUrl: string
  }
  const sceneBindings: SceneBinding[] = []
  const remainingSlots = Math.max(0, 3 - characterSubjects.length)
  if (remainingSlots > 0 && (projectData.locations?.length ?? 0) > 0) {
    const seenLoc = new Set<string>()
    for (const panel of validPanels) {
      if (sceneBindings.length >= remainingSlots) break
      if (!panel.location) continue
      // panel.location is "<name>" or "<name>#<viewHint>" (Approach
      // B-Standard). Match by name only — viewHint is for image picking
      // inside the location's images[] (handled below).
      const hashIdx = panel.location.indexOf('#')
      const locName = (hashIdx === -1 ? panel.location : panel.location.slice(0, hashIdx)).trim()
      if (!locName) continue
      const key = locName.toLowerCase()
      if (seenLoc.has(key)) continue
      const loc = projectData.locations!.find((l) => l.name.toLowerCase() === key)
      if (!loc) continue
      const panelViewHint = hashIdx === -1 ? null : panel.location.slice(hashIdx + 1).trim()
      // Override beats panel hint beats isSelected/imageIndex defaults.
      const overrideViewName = locOverrideById.get(loc.id)
      const effectiveView = (overrideViewName ?? panelViewHint) || null
      const images = loc.images ?? []
      const viewMatch = effectiveView
        ? images.find((img) => (img.viewName || '').trim().toLowerCase() === effectiveView.toLowerCase())
        : null
      const selected = images.find((img) => img.isSelected)
      const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
      const pickedImg = viewMatch || selected || primary
      const pickedRaw = pickedImg?.imageUrl
      const publicUrl = toSignedUrlIfCos(pickedRaw, 7200)
      if (!publicUrl) continue
      seenLoc.add(key)
      sceneBindings.push({
        id: loc.id,
        name: loc.name,
        viewName: pickedImg?.viewName || null,
        imageUrl: publicUrl,
      })
    }
  }
  const sceneSubjects = sceneBindings.map((s) => ({
    name: s.name,
    imageUrls: [s.imageUrl],
  }))

  // Tencent's 3-slot cap applies to the *combined* list. Trim bindings
  // identically so the response shape mirrors what Kling actually saw.
  //
  // 2026-05-01: SDK doc rabbit-hole resolution. Kling does NOT honor
  // SubjectInfos[].ImageUrls — that field is documented `仅Vidu有效`
  // (Vidu only). For Kling, training-free reference comes through
  // FileInfos[].Url with `Usage: 'Reference'`. SubjectInfos[].Id
  // works for Kling but requires a pre-trained Subject from
  // CreateAigcSubject (heavy, multi-step).
  //
  // We were sending SubjectInfos = [{Name, ImageUrls}] which Kling
  // silently dropped → refCount=0 → identity completely lost. Switch
  // to referenceImageUrls so the existing tencent-vod.ts path that
  // pushes FileInfos with Usage='Reference' runs.
  const subjectInfos = [...characterSubjects, ...sceneSubjects].slice(0, 3)
  const referenceImageUrls = subjectInfos
    .map((s) => (Array.isArray(s.imageUrls) ? s.imageUrls[0] : null))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const usedCharCount = Math.min(characterBindings.length, subjectInfos.length)
  const usedSceneCount = Math.min(
    sceneBindings.length,
    Math.max(0, subjectInfos.length - usedCharCount),
  )
  const activeCharacterBindings = characterBindings.slice(0, usedCharCount)
  const activeSceneBindings = sceneBindings.slice(0, usedSceneCount)

  // 1-indexed name → FileInfos position. Order is character refs
  // first, then scene refs — must mirror the referenceImageUrls
  // order so prompt's <<<image_N>>> stays in sync. We also map the
  // location name (sceneBindings[i].name) so visual descriptions
  // mentioning the place get a `<<<image_N>>>` substitution too.
  const nameToImageIndex = new Map<string, number>()
  subjectInfos.forEach((s, i) => {
    if (s.name) nameToImageIndex.set(s.name, i + 1)
  })

  // Names of project characters that were detected in this group's
  // panels (or as dialogue speakers) but lost the 3-slot cap fight in
  // characterBindings.slice above. Their bare names still show up in
  // panel.description text — without anonymising, Kling tries to
  // invent that identity from scratch and we get the GROUP 04 BRUCE
  // "stranger lip-syncing" symptom. Pass this set down to the prompt
  // builders so buildShotBody can rewrite mentions.
  const unboundNames = new Set<string>()
  const boundCharIds = new Set(activeCharacterBindings.map((c) => c.id))
  for (const c of characterBindings) {
    if (!boundCharIds.has(c.id) && c.name) unboundNames.add(c.name)
  }
  // Also walk the panels for any character mentioned in description
  // text that's in projectData.characters but never made it into
  // characterBindings at all (rare path: panel.characters[] AND
  // dialogue both missed, but the description string names them).
  for (const panel of validPanels) {
    const desc = (panel.description ?? panel.videoPrompt ?? '').trim()
    if (!desc) continue
    for (const c of projectData.characters ?? []) {
      if (boundCharIds.has(c.id)) continue
      if (!c.name) continue
      if (unboundNames.has(c.name)) continue
      const re = new RegExp(escapeRegex(c.name), 'i')
      if (re.test(desc)) unboundNames.add(c.name)
    }
  }

  // Dialogue resolution. Two sources, in priority order:
  //
  //   1. panel.srtSegment (user-edited in the Storyboard UI). This is
  //      the source of truth for "what should be said in this shot"
  //      because the user can fix mismatched / mis-translated lines
  //      directly. Voice lines from script_to_storyboard go stale once
  //      a user edits.
  //   2. NovelPromotionVoiceLine (matched by matchedPanelId) — the
  //      auto-extracted dialogue from script analysis. Used only when
  //      panel.srtSegment is empty.
  //
  // Without (1), Kling Omni was dubbing whatever the original analysis
  // produced — even if the user fixed the dialogue panel in the UI,
  // the voice generation path read from voiceLines and ignored the
  // edit. Reported as "對話顯示西班牙文卻發出中文" — voiceLines had a
  // stale Spanish-mixed line and the UI showed the user's Chinese
  // edit.
  const panelIds = validPanels.map((p) => p.id)
  const voiceLines = panelIds.length > 0
    ? await prisma.novelPromotionVoiceLine.findMany({
        where: { matchedPanelId: { in: panelIds } },
        orderBy: [{ matchedPanelIndex: 'asc' }, { lineIndex: 'asc' }],
        select: { matchedPanelId: true, speaker: true, content: true },
      })
    : []
  const voiceLinesByPanel = new Map<string, Array<{ speaker: string; content: string }>>()
  for (const line of voiceLines) {
    if (!line.matchedPanelId) continue
    const content = (line.content ?? '').trim()
    if (!content) continue
    const speaker = (line.speaker ?? '').trim() || '旁白'
    const arr = voiceLinesByPanel.get(line.matchedPanelId) ?? []
    arr.push({ speaker, content })
    voiceLinesByPanel.set(line.matchedPanelId, arr)
  }
  const dialogueByPanel = new Map<string, Array<{ speaker: string; content: string }>>()
  for (const panel of validPanels) {
    const userEdited = (panel.srtSegment ?? '').trim()
    const charRefs = parsePanelCharacterReferences(panel.characters)
    const fallbackSpeaker = charRefs[0]?.name?.trim() || '旁白'
    if (userEdited) {
      // Run the loose srtSegment through extractSpokenLineFromSrtSegment
      // so stage directions ("慢动作中景:CATHERINE单脚蹬墙...",
      // "SARAH嘴巴张大,震惊不已") don't end up dubbed by Kling. Returns
      // null when the segment is pure narration — falls through to
      // voiceLines instead of polluting the audio track.
      const extracted = extractSpokenLineFromSrtSegment(userEdited, fallbackSpeaker)
      if (extracted) {
        dialogueByPanel.set(panel.id, [extracted])
        continue
      }
      // srtSegment exists but is pure narration — DON'T fall back to
      // voiceLines (which is also probably wrong if the user bothered
      // to edit srtSegment). Treat as silent.
      continue
    }
    const fallback = voiceLinesByPanel.get(panel.id)
    if (!fallback?.length) continue
    // Voice-line content can also have mixed narration+dialogue (the
    // analyze worker sometimes dumps both). Run each through the
    // same extractor before sending to Kling.
    const cleaned: Array<{ speaker: string; content: string }> = []
    for (const line of fallback) {
      const extracted = extractSpokenLineFromSrtSegment(line.content, line.speaker || fallbackSpeaker)
      if (extracted) cleaned.push(extracted)
    }
    if (cleaned.length > 0) dialogueByPanel.set(panel.id, cleaned)
  }

  await reportTaskProgress(job, 30, { stage: 'submit_generation_b_path' })

  // Branch on mode: customize gets per-shot multi_prompt entries with
  // explicit durations; intelligence keeps the legacy combined-prompt
  // path so existing callers remain bit-for-bit identical to pre-fix
  // behaviour. Both paths share dialogue injection.
  let generateOptions: Record<string, unknown>
  let resolvedDurations: number[] | undefined
  let resolvedTotal: number
  let intelligencePromptSource: 'panels' | 'raw' | 'seedance' = 'panels'

  if (multiShotMode === 'customize') {
    const { durations, totalDuration } = distributeShotDurations(validPanels.length, panelDurations)
    const multiPrompt = buildBPathCustomizePrompts(validPanels, dialogueByPanel, durations, nameToImageIndex, unboundNames)
    if (multiPrompt.length === 0) {
      throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
    }
    // If shots were dropped (empty visual + no dialogue), recompute the
    // total so Kling's "sum of per-shot durations == Duration" invariant
    // still holds — buildBPathCustomizePrompts re-numbers indices.
    const finalTotal = multiPrompt.reduce((s, p) => s + p.duration, 0)
    resolvedDurations = multiPrompt.map((p) => p.duration)
    resolvedTotal = finalTotal

    logger.info({
      message: 'B path multi-shot submit (customize)',
      details: {
        videoModel,
        shotCount: multiPrompt.length,
        subjectCount: subjectInfos.length,
        durations: resolvedDurations,
        totalDuration: finalTotal,
        dialogueLineCount: voiceLines.length,
      },
    })

    // Tencent API treats top-level Prompt as semantically ignored in
    // customize mode but still validates non-empty (fails with ret:1201
    // "prompt cannot be empty" otherwise). Use the combined prompt as a
    // safe non-empty payload — the model uses multi_prompt entries for
    // actual generation.
    const placeholderPrompt = buildBPathCombinedPrompt(validPanels, dialogueByPanel, nameToImageIndex, unboundNames)
    generateOptions = {
      prompt: placeholderPrompt,
      duration: finalTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
      klingMultiShot: {
        multi_shot: true,
        shot_type: 'customize',
        multi_prompt: multiPrompt,
      },
      outputComplianceCheck: 'Enabled',
    }
  } else {
    // Intelligence mode. Three prompt sources:
    //  1. Caller-supplied rawPrompt — wins over everything (e.g. user
    //     paste of a hand-crafted Seedance segment).
    //  2. promptStyle='panel-numbered' (DEFAULT, 2026-05-01 retest) —
    //     legacy `镜头N:` 10s tight cuts. Action sequences regressed
    //     visibly under auto-seedance (later shots blurred under the
    //     longer 15s render); reverted as default after user A/B.
    //  3. promptStyle='auto-seedance' (opt-in) — Seedance-style
    //     time-indexed entity-tagged 15s segment, better for dialogue
    //     and reaction scenes.
    const promptStyle = params.promptStyle ?? 'panel-numbered'
    let primaryPrompt: string
    let promptSource: 'panels' | 'raw' | 'seedance'
    if (typeof rawPrompt === 'string' && rawPrompt.trim().length > 0) {
      promptSource = 'raw'
      // Trust the user's narrative verbatim. Earlier we appended a
      // dialogue-only block via formatDialogueForKling so the worker
      // could "make sure" speakers reached Kling, but the user's
      // narrative (built by GroupCard.buildInitialNarrative) ALREADY
      // embeds `Character: line` per time-slice. Re-appending the same
      // lines in a slightly different format pushed Kling's per-shot
      // parser into picking the dominant prompt language (中文) for
      // TTS instead of the actual line language (e.g. Spanish dialogue
      // arriving as Mandarin voice, user-reported 2026-05-02).
      primaryPrompt = rawPrompt.trim()
    } else if (promptStyle === 'auto-seedance') {
      promptSource = 'seedance'
      primaryPrompt = buildSeedancePrompt(validPanels, dialogueByPanel, undefined, nameToImageIndex)
    } else {
      promptSource = 'panels'
      primaryPrompt = buildBPathCombinedPrompt(validPanels, dialogueByPanel, nameToImageIndex, unboundNames)
    }
    if (!primaryPrompt.trim()) {
      throw new Error('MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description')
    }
    // Auto-seedance and rawPrompt cover the full 15s window (each shot
    // gets a guaranteed slice via distributeShotDurations); legacy
    // panel-numbered keeps the conservative 10s default to preserve
    // pre-2026-05-01 behaviour for opted-out callers.
    resolvedTotal = promptSource === 'panels'
      ? (validPanels.length >= 3 ? 10 : 5)
      : KLING_OMNI_MAX_TOTAL_DURATION

    logger.info({
      message: 'B path multi-shot submit (intelligence)',
      details: {
        videoModel,
        shotCount: validPanels.length,
        subjectCount: subjectInfos.length,
        promptLength: primaryPrompt.length,
        promptSource,
        dialogueLineCount: voiceLines.length,
        totalDuration: resolvedTotal,
      },
    })

    generateOptions = {
      prompt: primaryPrompt,
      duration: resolvedTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      ...(referenceImageUrls.length > 0 ? { referenceImageUrls } : {}),
      klingMultiShot: { multi_shot: 'intelligence' },
      outputComplianceCheck: 'Enabled',
    }
    // Stash for the function's return shape.
    intelligencePromptSource = promptSource
  }
  // Diagnostic: snapshot exactly what we're about to hand off to
  // generateVideo so we can prove referenceImageUrls / klingMultiShot /
  // aspectRatio / generateAudio survive the spread chain into the
  // Tencent VOD generator. Logged at info to remain visible in prod.
  logger.info({
    message: 'B path generateOptions snapshot',
    details: {
      keys: Object.keys(generateOptions),
      referenceImageUrlsLen: Array.isArray(generateOptions.referenceImageUrls)
        ? (generateOptions.referenceImageUrls as unknown[]).length
        : 0,
      hasKlingMultiShot: !!generateOptions.klingMultiShot,
      aspectRatio: generateOptions.aspectRatio ?? null,
      generateAudio: generateOptions.generateAudio ?? null,
      duration: generateOptions.duration ?? null,
      // Truncated prompt preview so we can verify <<<image_N>>>
      // substitution actually rewrote the panel descriptions before
      // hitting Kling. Cap at 600 chars to keep the log readable.
      promptHead: typeof generateOptions.prompt === 'string'
        ? (generateOptions.prompt as string).slice(0, 600)
        : null,
      // Sanity checks that the substitution fired and that any leftover
      // bare names were uncatchable (typos, alias drift).
      hasImageRefSyntax: typeof generateOptions.prompt === 'string'
        ? /<<<image_\d+>>>/.test(generateOptions.prompt as string)
        : false,
      nameToImageIndex: Array.from(nameToImageIndex.entries()),
      // Customize mode ignores the top-level prompt — real per-shot
      // text (with dialogue) sits in klingMultiShot.multi_prompt[].
      // Without surfacing those entries we can't tell whether dialogue
      // language tagging or character refs reached Kling for each shot,
      // which is exactly the diagnostic we need for the 2026-05-02
      // language-pivot debug.
      multiPromptPreview: (() => {
        const km = generateOptions.klingMultiShot as
          | { multi_prompt?: Array<{ index?: number; prompt?: string; duration?: number }> }
          | undefined
        const arr = km?.multi_prompt
        if (!Array.isArray(arr)) return null
        return arr.map((entry) => ({
          index: entry.index ?? null,
          duration: entry.duration ?? null,
          // Cap each shot at 400 chars; with up to 6 shots × 400 the log
          // line stays under most syslog limits.
          prompt: typeof entry.prompt === 'string' ? entry.prompt.slice(0, 400) : null,
        }))
      })(),
      // Surface character coverage vs Kling's hard 3-ref cap so it's
      // obvious when a panel speaker got dropped. The 2026-05-02 group
      // had CHLOE/CATHERINE/BRUCE/TOBY = 4 chars; TOBY fell out and the
      // rendered clip showed a stranger lip-syncing TOBY's line.
      characterCoverage: {
        bound: characterBindings.map((c) => c.name),
        sceneSlotsUsed: sceneBindings.map((s) => s.name),
        capWasHit: characterBindings.length + sceneBindings.length > 3,
        // Names that lost the cap fight and got anonymized in shot
        // descriptions via rewriteForUnboundCharacters. Empty when
        // the group fits inside Kling's 3-ref limit.
        unboundAnonymized: Array.from(unboundNames),
      },
    },
  })
  // generateVideo's option type is intentionally narrow (only standard
  // fields). Tencent-specific keys (subjectInfos / klingMultiShot /
  // outputComplianceCheck) ride through as extras and are picked up by
  // the TencentVODVideoGenerator typed options.
  const generateResult = await generateVideo(
    userId,
    videoModel,
    '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateOptions as any,
  )

  if (!generateResult.success) {
    throw new Error(generateResult.error || 'Tencent VOD multi-shot submit failed')
  }
  const externalId = typeof generateResult.externalId === 'string' ? generateResult.externalId.trim() : ''
  if (!externalId) {
    throw new Error('Tencent VOD multi-shot returned no externalId')
  }

  const polled = await waitExternalResult(job, externalId, userId, {
    progressStart: 35,
    progressEnd: 90,
  })

  await assertTaskActive(job, 'persist_multi_shot_video_b_path')

  const storyboardId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(polled.url, 'multi-shot-video-b', storyboardId)
  await reportTaskProgress(job, 95, { stage: 'persist' })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { multiShotVideoUrl: cosKey },
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    shotCount: validPanels.length,
    subjectCount: subjectInfos.length,
    path: 'B',
    multiShotMode,
    ...(resolvedDurations ? { durations: resolvedDurations } : {}),
    ...(multiShotMode === 'intelligence' ? { promptSource: intelligencePromptSource } : {}),
    bindings: {
      characters: activeCharacterBindings,
      scenes: activeSceneBindings,
    },
  }
}
