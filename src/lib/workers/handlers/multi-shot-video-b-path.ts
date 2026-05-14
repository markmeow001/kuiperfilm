import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import { generateVideo } from '@/lib/generator-api'
import {
  parsePanelCharacterReferences,
  parsePanelPropReferences,
  findCharacterByName,
  findPropByName,
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
  /**
   * Tencent VOD AIGC Element ID for this character (per CreateAigcCustomElement,
   * §3.9.4.2). When present, the worker passes it via SubjectInfos.N to
   * Kling for the new "固定主体" binding mode (2026-03-30 doc). When null,
   * we fall back to FileInfos+ObjectId+`<<<image_N>>>` mode (§3.9.4.1).
   *
   * Populated by a separate pre-register pipeline (not yet wired):
   *   1. On character appearance image upload/generation
   *   2. Call CreateAigcCustomElement with the frontal image URL
   *   3. Cache the returned ElementId on NovelPromotionCharacter
   *
   * Until that pipeline lands this field is always null and we stay on
   * the image-index path that's working today.
   */
  tencentVodElementId?: string | null
}
import {
  assertTaskActive,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'
import { buildDialogueDrivenDurations, estimatePanelSpeechSeconds } from './speech-duration-estimator'
import { buildMultiKlingSplitPlan, MultiKlingChunkerError, type MultiKlingChunk } from './multi-kling-chunker'
import { buildMultiShotClipUpdate } from '@/lib/storyboard/multi-shot-clips'
import {
  getOrCreateTencentVodElement,
  getOrRegisterStyleReferenceElement,
} from '@/lib/tencent-vod/element-register'
import { loadStyleProfileByProjectId } from '@/lib/style-profile/loader'
import { STYLE_PROFILE_PRESETS } from '@/lib/style-profile/presets'
import {
  detectEra,
  pickStyleReference,
  resolvePresetKeyByPositivePrompt,
} from '@/lib/style-profile/style-reference-picker'

interface BPathPanel {
  id: string
  description: string | null
  videoPrompt: string | null
  characters: string | null
  // Phase 11.3 Stage 2 — JSON-encoded prop names referenced in this panel.
  // Same shape as `characters`; null = no props.
  props?: string | null
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
  /** LocationImage.id — needed by the tencent-vod element register pipeline
   * to cache the ElementId per view, not per location. */
  id?: string | null
  imageIndex?: number | null
  imageUrl?: string | null
  isSelected?: boolean | null
  viewName?: string | null
  /** See CharacterForBPath.tencentVodElementId — per-view caching. */
  tencentVodElementId?: string | null
}

interface LocationForBPath {
  id: string
  name: string
  images?: LocationImageForBPath[]
}

// Phase 11.3 Stage 2 — slim view of NovelPromotionProp the multi-shot
// path needs:imageUrl as Tencent SubjectInfos source, name to match
// against panel.props references.
interface PropForBPath {
  id: string
  name: string
  imageUrl?: string | null
  /** See CharacterForBPath.tencentVodElementId — same opt-in field for props. */
  tencentVodElementId?: string | null
}

interface BPathProjectData {
  characters?: CharacterForBPath[]
  locations?: LocationForBPath[]
  props?: PropForBPath[]
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

// Constants moved to ./kling-omni-constants on 2026-05-03 to break a
// circular import with speech-duration-estimator that crashed the
// worker at startup. Re-exported here so `import { ... } from
// './multi-shot-video-b-path'` keeps working everywhere.
export {
  KLING_OMNI_MAX_TOTAL_DURATION,
  KLING_OMNI_DEFAULT_PER_SHOT_DURATION,
  KLING_OMNI_MAX_SHOTS,
} from './kling-omni-constants'
import {
  KLING_OMNI_MAX_TOTAL_DURATION,
  KLING_OMNI_DEFAULT_PER_SHOT_DURATION,
  KLING_OMNI_MAX_SHOTS,
} from './kling-omni-constants'

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
/**
 * Detect spoken language of a dialogue line by dominant character set.
 *
 * 2026-05-13 — Flipped from "return null for zh/en (trust auto-detect)"
 * to "always return a language label" because Kling's auto-detect picks
 * the SURROUNDING prompt's dominant language, not the dialogue line's.
 * Symptom: Chinese description + English dialogue → Kling speaks the
 * line in Mandarin. Forcing an explicit `(in English)` per line overrides
 * the surrounding-prompt bias and locks each line to its actual language.
 *
 * This makes the contract source-of-truth: dialogue language = the
 * language of the dialogue line itself, regardless of description/
 * narrative language. User requirement (2026-05-13):
 *   "對白中文就講中文,英文就講英文,西班牙文就講西班牙文"
 *
 * Detection priority — checked in order, first match wins:
 *   1. Hiragana / katakana → Japanese (most distinctive)
 *   2. Hangul → Korean
 *   3. Spanish marks (ñ¿¡) → Spanish
 *   4. French marks (çœ) → French
 *   5. German eszett ß → German
 *   6. German umlauts + common-word check → German
 *   7. Cyrillic → Russian
 *   8. CJK Han → Mandarin Chinese
 *   9. Latin alphabet → English (catch-all)
 *  10. Punctuation/digits only → null (no override needed)
 */
function detectDialogueLanguage(content: string): string | null {
  const stripped = content.trim()
  if (!stripped) return null
  if (/[぀-ゟ゠-ヿ]/.test(content)) return 'Japanese'
  if (/[가-힯]/.test(content)) return 'Korean'
  if (/[ñ¿¡]/.test(content)) return 'Spanish'
  if (/[çœ]/.test(content)) return 'French'
  if (/ß/.test(content)) return 'German'
  if (/[äöü]/.test(content) && /\b(?:der|die|das|und|ist|nicht|ich|ein|sind)\b/i.test(content)) return 'German'
  if (/[Ѐ-ӿ]/.test(content)) return 'Russian'
  if (/[一-鿿]/.test(content)) return 'Mandarin Chinese'
  if (/[A-Za-zÀ-ÿ]/.test(content)) return 'English'
  return null
}

/**
 * Detect whether a speaker label encodes an off-camera voice-over.
 * Mirrors the same logic in storyboards/route.ts so worker + UI agree
 * on which lines should NOT trigger lip-sync animation.
 *
 * Recognised markers (case-insensitive):
 *   - parenthesised: 角色(VO) / 角色(V.O.) / 角色(O.S.) / 角色（画外音） / 角色（旁白） / 角色（独白）
 *   - bare suffix:   角色VO / 角色OS / 角色 V.O. (whole-word match)
 *   - keyword in name: 画外音 / 旁白 / 独白
 *
 * User requirement 2026-05-13:
 *   「所有OS的對白...角色的嘴唇不能有動作」
 */
function isVoiceoverSpeaker(rawSpeaker: string): boolean {
  if (!rawSpeaker) return false
  return /(\(|（)\s*(VO|V\.?O\.?|OS|O\.?S\.?|画外音|畫外音|旁白|独白|獨白)\s*(\)|）)/i.test(rawSpeaker)
    || /\b(VO|V\.?O\.?|OS|O\.?S\.?)\b/i.test(rawSpeaker)
    || /(画外音|畫外音|旁白|独白|獨白)/.test(rawSpeaker)
}

/**
 * Strip the VO/OS suffix from a speaker name for clean TTS attribution.
 * Without this, Kling reads `桃桃(VO)` aloud as "Taotao VO" instead of
 * just "Taotao", and the speaker-name lookup against character library
 * fails (no row matches `桃桃(VO)`).
 */
function stripVoiceoverMarkers(rawSpeaker: string): string {
  return rawSpeaker
    .replace(/[(（]\s*(VO|V\.?O\.?|OS|O\.?S\.?|画外音|畫外音|旁白|独白|獨白)\s*[)）]/gi, '')
    .replace(/\b(VO|V\.?O\.?|OS|O\.?S\.?)\b/gi, '')
    .replace(/(画外音|畫外音|旁白|独白|獨白)/g, '')
    .trim() || rawSpeaker.trim()
}

function formatDialogueForKling(rawSpeaker: string, content: string): string {
  const lang = detectDialogueLanguage(content)
  const isVO = isVoiceoverSpeaker(rawSpeaker)
  const speaker = stripVoiceoverMarkers(rawSpeaker)
  // Kling Omni's native dialogue format is `Character: "line"`. The
  // `(in <Language>)` parenthetical is the documented Kling 3.0-Omni
  // convention for per-line TTS language override. As of 2026-05-13 we
  // emit it for EVERY line so the dialogue language is the source of
  // truth regardless of surrounding description language — handles the
  // mixed-language drama case (CN narration + EN/ES dialogue) without
  // user intervention.
  //
  // Off-camera voice-over (OS / VO / 画外音 / 旁白 / 独白) gets a
  // distinct prefix that tells Kling NOT to lip-sync the line.
  // Recognised by the model's prompt parser (clean structural English),
  // and reinforced by the DIALOGUE RULE clause in STYLE_HEADER_REALISTIC
  // on the frontend.
  const langTag = lang ? ` (in ${lang})` : ''
  return isVO
    ? `Voiceover (off-camera, ${speaker}'s lips do not move)${langTag}: "${content}"`
    : `${speaker}${langTag}: "${content}"`
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
export function extractSpokenLineFromSrtSegment(
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
export function looksLikeStageDirection(content: string): boolean {
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
 * Normalize a panel's voice lines into the dialogue array consumed by
 * buildDialogueDrivenDurations + buildBPathCustomizePrompts.
 *
 * Handles two shapes of voice line content:
 *   1. Pre-cleaned spoken text from the modern 4-prompt LLM extraction
 *      pipeline ("当年我误入结界百年...") — pass through.
 *   2. Legacy mixed narration+dialogue dumps from older analyze runs
 *      ("SARAH嘴巴张大, SARAH说：'...'") — run through
 *      extractSpokenLineFromSrtSegment to strip stage directions.
 *
 * 2026-05-14 — bug fix: previously every voice line went through the
 * extractor, which returned null for shape #1 (no quote/colon markers
 * to anchor on). Result: clean voice lines were silently dropped →
 * dialogueByPanel stayed empty → dialogue-driven duration allocator
 * never engaged → worker fell through to Kling intelligence mode → 15s
 * narrative rendered as 10s video with mismatched dub (user report
 * 2026-05-13).
 */
export function normalizeVoiceLinesToDialogue(
  voiceLines: ReadonlyArray<{ speaker: string; content: string }>,
  fallbackSpeaker: string,
): Array<{ speaker: string; content: string }> {
  const out: Array<{ speaker: string; content: string }> = []
  for (const line of voiceLines) {
    const extracted = extractSpokenLineFromSrtSegment(
      line.content,
      line.speaker || fallbackSpeaker,
    )
    if (extracted) {
      out.push(extracted)
      continue
    }
    const rawContent = (line.content ?? '').trim()
    if (rawContent && !looksLikeStageDirection(rawContent)) {
      out.push({
        speaker: line.speaker?.trim() || fallbackSpeaker,
        content: rawContent,
      })
    }
  }
  return out
}

/**
 * Heuristic: does this line look like a dialogue line whose speaker
 * name MUST be preserved verbatim?
 *
 * Tencent VOD doc §3.9.4 / 3.9.5 — Kling Omni's TTS pipeline parses
 *   `${speaker}说："${content}"` or `${speaker}: "${content}"`
 * to identify the voice owner. If we replace the speaker with
 * `<<<image_N>>>`, the TTS parser fails and either no voice is dubbed
 * or the dialogue is read by the wrong speaker.
 *
 * Patterns we MUST NOT touch (case-insensitive across CJK + ASCII):
 *   - `王玄说："..."` / `王玄说道："..."` / `王玄道："..."`
 *   - `王玄：「...」` / `王玄: "..."`
 *   - `[王玄]：「...」` / `(王玄): "..."`
 *
 * Any line matching is returned untouched. Everything else is fair
 * game for substitution.
 */
const DIALOGUE_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  // `[Name]:` or `(Name):` or （Name）：— optional bracket wrapper, colon, optional quote
  /^\s*[\[\(（【「][^\]\)）】」]+[\]\)）】」]\s*[:：]\s*[「『"'“]?/,
  // `Name说/言/道/喊/叫：` followed by optional quote (no leading bracket needed)
  /^\s*[一-龥A-Za-z][一-龥A-Za-z\s]{0,20}[说言道喊叫嚷吼][道：:：]\s*[「『"'“]?/,
  // `Name: "..."` — bare ASCII/CJK name followed by colon and quote
  /^\s*[一-龥A-Za-z][一-龥A-Za-z\s]{0,20}[:：]\s*[「『"'“]/,
]

function isDialogueLine(line: string): boolean {
  if (!line) return false
  for (const re of DIALOGUE_LINE_PATTERNS) {
    if (re.test(line)) return true
  }
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
 * 2026-05-13 line-aware mode: when the input contains multiple lines,
 * dialogue lines (matched via isDialogueLine) are preserved verbatim.
 * Tencent doc explicitly says Kling Omni's TTS parser requires the
 * bare speaker name; `<<<image_N>>>说："..."` is not recognised.
 * Single-line callers (buildShotBody) get the legacy global behaviour.
 */
// 2026-05-13 — CRITICAL: skip single-char names (length < 2).
// CJK has no word boundaries, so substring-matching a 1-char name
// like 「離」 clobbers common Chinese collocations that happen to
// contain that char ("離地半米" / "離開" / "離別" etc.).
// Prod failure was: character "离" replaced "离地半米的空中" with
// "<<<image_2>>>地半米的空中" — Kling read this as garbage and
// fell back to its training prior (long-haired xianxia young man).
// Single-char names are still accepted into the cast — they just
// stay as bare-name mentions in prose; dialogue / explicit anchors
// still bind them.
const ALREADY_SUBSTITUTED_RE = /<<<image_\d+>>>/

/**
 * Rewrite every `<<<image_N>>>` token to `<<<element_N>>>` for the
 * element_list binding path (§3.9.4.2). N is preserved because the
 * worker builds `elementList` in the SAME order as `referenceImageUrls`,
 * so slot 1 is the same entity in either path. Only the prompt-side
 * namespace prefix changes.
 *
 * Idempotent (running twice produces the same string).
 */
function rewriteImageRefsToElementRefs(text: string): string {
  if (!text) return text
  return text.replace(/<<<image_(\d+)>>>/g, '<<<element_$1>>>')
}

function substituteImageRefs(text: string, nameToImageIndex: ReadonlyMap<string, number>): string {
  if (!text || nameToImageIndex.size === 0) return text
  const sortedNames = Array.from(nameToImageIndex.keys())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length)
  if (sortedNames.length === 0) return text

  // Multi-line — be both dialogue-aware AND idempotent.
  //   - skip dialogue lines (TTS speaker must stay bare)
  //   - skip lines already containing <<<image_N>>> (frontend pre-sub
  //     or earlier worker pass) — re-running clobbers `<<<image_1>>>=王玄`
  //     mapping headers into `<<<image_1>>>=<<<image_1>>>` nonsense
  if (text.includes('\n')) {
    return text
      .split('\n')
      .map((line) => {
        if (isDialogueLine(line)) return line
        if (ALREADY_SUBSTITUTED_RE.test(line)) return line
        let out = line
        for (const name of sortedNames) {
          const idx = nameToImageIndex.get(name)
          if (!idx) continue
          out = out.replace(new RegExp(escapeRegex(name), 'gi'), `<<<image_${idx}>>>`)
        }
        return out
      })
      .join('\n')
  }

  // Single-line callers (buildShotBody) — keep legacy global replace
  // (they hand us bare description text that hasn't been pre-substituted).
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

    // 2026-05-13 — Route through formatDialogueForKling so the `(in
    // <Language>)` per-line TTS hint applies in seedance mode too.
    // Previously seedance bypassed the formatter, leaving mixed-language
    // dialogue at the mercy of surrounding-prompt language detection.
    const dialogues = (dialogueByPanelId.get(panel.id) ?? [])
      .map((d) => formatDialogueForKling(d.speaker, d.content))
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
  /**
   * 2026-05-13 — Option B "首幀鎖定" mode (locked first frame).
   *
   * When set, the worker switches to Kling 3.0 / 3.0-Omni image-to-video
   * SINGLE-shot path:
   *   - FileInfos[0] = { Url: firstFrameImageUrl, Usage: 'FirstFrame' }
   *   - LastFrameUrl = lastFrameImageUrl (when also set)
   *   - multi_shot is dropped entirely (Tencent doc §3.9.3 / 3.9.1: the
   *     "首尾帧 一镜到底" capability is mutually exclusive with multi_shot
   *     in the third-party Tencent VOD path; the official Kling web UI
   *     allows mixing but the API does not)
   *   - Total duration: dialogue-driven if voice lines exist (clamped
   *     3-15s), otherwise 5s default
   *   - Single concatenated prompt built from all panel descriptions +
   *     dialogue (so the locked frame still gets the narrative arc the
   *     user wrote, just rendered as one continuous shot)
   *
   * UX intent: user picks a panel image (or uploads custom) to lock the
   * opening frame for character/scene consistency. Optionally locks the
   * ending frame too. Trades multi-shot capability for pixel-level
   * identity guarantee — most useful for character intros, transitions,
   * and reaction shots where Kling's free-form first-frame imagination
   * tends to drift off-model.
   */
  firstFrameImageUrl?: string
  lastFrameImageUrl?: string
}): Promise<{
  storyboardId: string
  multiShotVideoUrl: string
  /**
   * 2026-05-03 — when dialogue exceeded Kling Omni's 15s per-call cap
   * the chunker split the group across N Kling calls. This array
   * holds all chunk URLs in playback order. For ≤15s groups the
   * array has length 1 (and equals [multiShotVideoUrl]).
   */
  multiShotClipUrls: string[]
  /** Number of Kling calls dispatched (1 for single, >1 when chunked). */
  chunkCount: number
  shotCount: number
  subjectCount: number
  path: 'B'
  multiShotMode: 'intelligence' | 'customize' | 'first_frame' | 'first_last_frame'
  durations?: number[]
  promptSource?: 'panels' | 'raw' | 'seedance' | 'first_frame'
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
    // Phase 11.3 Stage 2 — props that made it past the 3-slot cap and
    // got included as Kling reference images. Empty array when the cap
    // pushed all props out (chars + scenes filled all 3 slots).
    props: Array<{
      id: string
      name: string
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
    firstFrameImageUrl,
    lastFrameImageUrl,
  } = params
  const isFirstFrameLockMode =
    typeof firstFrameImageUrl === 'string' && firstFrameImageUrl.length > 0
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
  // (A second auto-promotion happens later if voice lines exist —
  // dialogue-driven durations override the equal-split default.)
  let multiShotMode: 'intelligence' | 'customize' =
    panelDurations !== undefined ? 'customize' : (params.multiShotMode ?? 'intelligence')
  let effectivePanelDurations: number[] | undefined = panelDurations
  const { userId, projectId } = job.data
  const logger = createScopedLogger({
    module: 'worker.multi-shot-video-b-path',
    action: 'multi_shot_video_b_path_generate',
  })

  // ── 2026-05-13 — Photoreal style anchor for Kling 3.0-Omni ──
  //
  // Kling Omni's text-based "photorealistic" anchors lose to its
  // xianxia/wuxia training prior on crowd / period scenes. Fix is to
  // feed an actual photo via the same SubjectInfos pipeline that pins
  // character identity. Reference-image attention beats prompt-text
  // attention by a wide margin in our 2026-05-13 e2e diffs.
  //
  // Resolution path:
  //   1. Load project styleProfile (or fallback to 'realistic' preset)
  //   2. Reverse-resolve preset key by matching stylePositivePrompt
  //   3. If matched preset has styleReferences[], pick one by era hint
  //   4. Register it as a Tencent CustomElement (cached pod-locally)
  //
  // Failure is non-fatal: a null styleRefBinding just means the task
  // runs without an image-based style anchor (legacy behaviour).
  type StyleReferenceBinding = {
    url: string
    label: string
    tencentVodElementId: string | null
    /** 1-indexed FileInfos / element_list slot, filled in once allocated. */
    slot: number
  }
  let styleRefBinding: StyleReferenceBinding | null = null
  try {
    const styleProfile = await loadStyleProfileByProjectId(prisma, projectId)
    const presetKey = resolvePresetKeyByPositivePrompt(styleProfile?.positivePrompt ?? null)
    const preset = presetKey ? STYLE_PROFILE_PRESETS[presetKey] : null
    if (preset?.styleReferences?.length) {
      // Era detection: combine all panel descriptions + location names
      // so the picker has enough signal even when individual panels are
      // sparse. Cheap O(n) join — validPanels is at most ~6 entries.
      const eraTextBlob = validPanels
        .map((p) => `${p.description ?? ''} ${p.videoPrompt ?? ''} ${p.location ?? ''}`)
        .join(' ')
      const era = detectEra(eraTextBlob)
      const picked = pickStyleReference(preset.styleReferences, era)
      if (picked) {
        const elementId = await getOrRegisterStyleReferenceElement({
          userId,
          url: picked.url,
          label: picked.label,
        })
        styleRefBinding = {
          url: picked.url,
          label: picked.label,
          tencentVodElementId: elementId,
          slot: 0, // filled in after slot allocation
        }
        logger.info({
          message: 'style reference resolved',
          details: {
            presetKey,
            detectedEra: era,
            pickedEra: picked.eraHint,
            label: picked.label,
            elementRegistered: elementId !== null,
          },
        })
      }
    }
  } catch (err) {
    // Style anchor is an optimisation, not a correctness gate. Log
    // and fall through to text-only style anchoring.
    logger.warn({
      message: 'style reference resolution failed; running without image-based style anchor',
      details: { error: err instanceof Error ? err.message : String(err) },
    })
  }

  // Phase 11.4 / multi-appearance: pre-load EpisodeCharacter bindings
  // for the storyboard's episode so per-character costume overrides
  // apply to multi-shot generation too. All selected panels live under
  // the same storyboard, which lives under one episode.
  const episodeBindings = new Map<string, string>()
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
    /** See CharacterForBPath.tencentVodElementId. Null until pre-register pipeline lands. */
    tencentVodElementId: string | null
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

      // 2026-05-13 — resolution priority (user clarification):
      //   1. UI per-call override (charOverrideById)
      //   2. panel.characters[i].appearance — LLM picked per-shot
      //      (flashback vs current, costume change, etc.)
      //   3. EpisodeCharacter binding — episode-level fallback for
      //      shots where LLM didn't explicitly choose
      //   4. appearances[0] — global default
      //
      // The earlier order (episode > panel hint) treated EpisodeCharacter
      // as a forced override. User reported that broke per-shot
      // appearance variability — script said "王玄 (present-day)" but
      // the whole episode rendered as "王玄Y" because the binding was
      // sticky.
      let appearance = appearances[0]
      const overrideAppearanceId = charOverrideById.get(character.id)
      const boundAppearanceId = episodeBindings.get(character.id)
      if (overrideAppearanceId) {
        const ov = appearances.find((a) => a.id === overrideAppearanceId)
        if (ov) appearance = ov
      } else if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
        else if (boundAppearanceId) {
          const bound = appearances.find((a) => a.id === boundAppearanceId)
          if (bound) appearance = bound
        }
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
        name: ref.name,
        appearanceId: appearance.id ?? null,
        appearanceLabel: appearance.changeReason || null,
        imageUrl: publicUrl,
        tencentVodElementId: character.tencentVodElementId ?? null,
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
        tencentVodElementId: character.tencentVodElementId ?? null,
      })
    }
  }
  // ── 2026-05-04 description-mining fallback (third pass).
  //
  // The two passes above cover (1) panel.characters explicit refs
  // and (2) srtSegment speaker mentions. Silent shots that name a
  // character only inside `panel.description` still slip through
  // both — iangyc reported this for a "镜头切回洞府内,王玄紧闭着双眼"
  // shot where panel.characters was empty and there was no dialogue.
  //
  // Scan description / videoPrompt for project-character-name hits
  // and add as character bindings, capped at the same 3-slot Tencent
  // limit so we don't blow ref budget. Same alias-aware substring
  // match findCharacterByName uses (slash-split aliases).
  for (const panel of validPanels) {
    if (characterBindings.length >= 3) break
    const descSource = `${panel.description ?? ''}\n${panel.videoPrompt ?? ''}`.trim()
    if (!descSource) continue
    for (const character of projectData.characters ?? []) {
      if (characterBindings.length >= 3) break
      if (seenCharIds.has(character.id)) continue
      if (!character.name) continue
      const aliases = character.name.split('/').map((s) => s.trim()).filter(Boolean)
      const hit = aliases.some((alias) => descSource.includes(alias))
      if (!hit) continue
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
        tencentVodElementId: character.tencentVodElementId ?? null,
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
    /** LocationImage.id — used by the element-register pipeline so the
     * cached ElementId belongs to this specific view (not the location). */
    locationImageId: string | null
    name: string
    viewName: string | null
    imageUrl: string
    /** See CharacterForBPath.tencentVodElementId. Sourced from LocationImage row. */
    tencentVodElementId: string | null
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
        locationImageId: pickedImg?.id ?? null,
        name: loc.name,
        viewName: pickedImg?.viewName || null,
        imageUrl: publicUrl,
        // Element cache is per-image (per-view), not per-location.
        tencentVodElementId: pickedImg?.tencentVodElementId ?? null,
      })
    }
  }
  const sceneSubjects = sceneBindings.map((s) => ({
    name: s.name,
    imageUrls: [s.imageUrl],
  }))

  // Phase 11.3 Stage 2 — props as third-tier reference candidates.
  // Walk panels in order, collect unique props referenced in this
  // group's panel.props JSON, and resolve each to its imageUrl from
  // the project prop catalog. Order:dedup by prop.id, skip props
  // without imageUrl (catalog row exists but image not yet generated/
  // uploaded), sign COS keys.
  //
  // Slot priority is character → scene → prop. Tencent's 3-slot cap
  // means props rarely make it into SubjectInfos when there are 2+
  // speaking characters, but they ALWAYS appear in the bindings
  // response so the UI chip rail can show what was used and what got
  // dropped. Single-character single-scene groups will frequently
  // have 1 free slot for a prop.
  type PropBinding = {
    id: string
    name: string
    imageUrl: string
    /** See CharacterForBPath.tencentVodElementId. */
    tencentVodElementId: string | null
  }
  const propBindings: PropBinding[] = []
  const seenPropIds = new Set<string>()
  for (const panel of validPanels) {
    const propRefs = parsePanelPropReferences(panel.props)
    for (const ref of propRefs) {
      const prop = findPropByName(projectData.props || [], ref.name)
      if (!prop) continue
      if (seenPropIds.has(prop.id)) continue
      if (!prop.imageUrl) continue
      const publicUrl = toSignedUrlIfCos(prop.imageUrl, 7200)
      if (!publicUrl) continue
      seenPropIds.add(prop.id)
      propBindings.push({
        id: prop.id,
        name: prop.name,
        imageUrl: publicUrl,
        tencentVodElementId: prop.tencentVodElementId ?? null,
      })
    }
  }
  const propSubjects = propBindings.map((p) => ({
    name: p.name,
    imageUrls: [p.imageUrl],
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
  //
  // 2026-05-13 — slot allocation now also reserves 1 slot for the
  // photoreal style anchor when active. Priority: chars → style →
  // scenes → props. Style displaces props/scenes before it displaces
  // a character ref (identity is more visible than backdrop or prop).
  const STYLE_SLOT_RESERVED = styleRefBinding !== null ? 1 : 0
  const HARD_CAP = 3
  const slotAvail = HARD_CAP - STYLE_SLOT_RESERVED
  const trimmedCharacterSubjects = characterSubjects.slice(0, slotAvail)
  const remainingAfterChar = slotAvail - trimmedCharacterSubjects.length
  const trimmedSceneSubjects = sceneSubjects.slice(0, remainingAfterChar)
  const remainingAfterScene = remainingAfterChar - trimmedSceneSubjects.length
  const trimmedPropSubjects = propSubjects.slice(0, remainingAfterScene)
  // Style ref occupies the slot AFTER characters, before scenes/props,
  // so its slot index in the prompt is `chars.length + 1` (1-indexed).
  // This keeps identity refs at slot 1..N (where N = active chars).
  const styleSubjectEntries = styleRefBinding
    ? [{ name: '__STYLE_ANCHOR__', imageUrls: [styleRefBinding.url] }]
    : []
  const subjectInfos = [
    ...trimmedCharacterSubjects,
    ...styleSubjectEntries,
    ...trimmedSceneSubjects,
    ...trimmedPropSubjects,
  ].slice(0, HARD_CAP)
  const referenceImageUrls = subjectInfos
    .map((s) => (Array.isArray(s.imageUrls) ? s.imageUrls[0] : null))
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  const usedCharCount = trimmedCharacterSubjects.length
  const usedStyleCount = styleSubjectEntries.length
  const usedSceneCount = trimmedSceneSubjects.length
  const usedPropCount = trimmedPropSubjects.length
  const activeCharacterBindings = characterBindings.slice(0, usedCharCount)
  const activeSceneBindings = sceneBindings.slice(0, usedSceneCount)
  const activePropBindings = propBindings.slice(0, usedPropCount)
  // Style ref's prompt slot is 1-indexed against subjectInfos order.
  if (styleRefBinding && usedStyleCount > 0) {
    styleRefBinding.slot = trimmedCharacterSubjects.length + 1
  } else {
    styleRefBinding = null
  }

  // P1 (2026-05-13) — Pre-registered "固定主体" (CustomElement) binding.
  //
  // Per Tencent VOD AIGC §3.9.4.2, the most reliable identity-binding path
  // for Kling 3.0-Omni is:
  //   1. Pre-register each entity's frontal reference image via
  //      `CreateAigcCustomElement` → returns an `ElementId`.
  //   2. Pass element_list: [{element_id: ...}, ...] in
  //      ExtInfo.AdditionalParameters.
  //   3. Reference each entity in the prompt as `<<<element_N>>>`
  //      (1-based against element_list order).
  //
  // This is what the official Python multi-element sample uses. The
  // FileInfos+ObjectId+`<<<image_N>>>` path (§3.9.4.1) still works for
  // single-shot reference but Kling's identity adherence degrades when
  // the prompt is long and descriptive — observed 2026-05-13 as the
  // long-haired CG xianxia young man pulling instead of the 35yo with
  // stubble from the reference image.
  //
  // Lazy registration: we don't pre-register on appearance creation;
  // instead, the first video gen that needs an entity will call
  // CreateAigcCustomElement (sync API, ~1-2s) and cache the ElementId
  // on the DB row. Subsequent gens hit the cache.
  //
  // Fallback: any binding that fails to register (network error, image
  // rejected for size/ratio, etc.) falls back to the §3.9.4.1 path for
  // this whole task. We don't mix — either ALL active bindings have
  // ElementIds (switch to element_list mode) or we stay on FileInfos.
  // Mixing is technically supported but adds prompt-syntax bifurcation
  // we don't need to fight today.
  const elementRegisterTasks: Array<Promise<{ key: string; elementId: string | null }>> = []
  for (const c of activeCharacterBindings) {
    if (c.appearanceId) {
      elementRegisterTasks.push(
        getOrCreateTencentVodElement({
          userId,
          entityType: 'character-appearance',
          entityId: c.appearanceId,
          name: c.name,
          imageUrl: c.imageUrl,
          description: c.appearanceLabel || c.name,
        }).then((elementId) => ({ key: `char:${c.id}`, elementId })),
      )
    }
  }
  for (const s of activeSceneBindings) {
    if (s.locationImageId) {
      elementRegisterTasks.push(
        getOrCreateTencentVodElement({
          userId,
          entityType: 'location-image',
          entityId: s.locationImageId,
          name: s.viewName ? `${s.name}-${s.viewName}` : s.name,
          imageUrl: s.imageUrl,
          description: `场景：${s.name}${s.viewName ? `·${s.viewName}` : ''}`,
        }).then((elementId) => ({ key: `scene:${s.id}`, elementId })),
      )
    }
  }
  for (const p of activePropBindings) {
    elementRegisterTasks.push(
      getOrCreateTencentVodElement({
        userId,
        entityType: 'prop',
        entityId: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        description: `道具：${p.name}`,
      }).then((elementId) => ({ key: `prop:${p.id}`, elementId })),
    )
  }
  const registerResults = await Promise.all(elementRegisterTasks)
  const elementIdByKey = new Map<string, string>()
  for (const { key, elementId } of registerResults) {
    if (elementId) elementIdByKey.set(key, elementId)
  }
  // Order MUST mirror referenceImageUrls / nameToImageIndex so slot N is
  // the same entity regardless of which path (element_list vs FileInfos)
  // we end up using. Slot order: chars → style → scenes → props.
  const elementList: Array<{ element_id: string }> = []
  const elementListNames: string[] = []
  for (const c of activeCharacterBindings) {
    const eid = elementIdByKey.get(`char:${c.id}`)
    if (eid) {
      elementList.push({ element_id: eid })
      elementListNames.push(c.name)
    }
  }
  // Style anchor element — only push when both the binding survived slot
  // allocation AND Tencent registered the CustomElement. Without an
  // elementId we can't go down the element_list path for the style ref
  // (would create a slot/name mismatch with referenceImageUrls), so we
  // mark it as ineligible for element_list mode by clearing it.
  let styleRefForElementList: { element_id: string } | null = null
  if (styleRefBinding && styleRefBinding.tencentVodElementId) {
    styleRefForElementList = { element_id: styleRefBinding.tencentVodElementId }
    elementList.push(styleRefForElementList)
    elementListNames.push('__STYLE_ANCHOR__')
  }
  for (const s of activeSceneBindings) {
    const eid = elementIdByKey.get(`scene:${s.id}`)
    if (eid) {
      elementList.push({ element_id: eid })
      elementListNames.push(s.name)
    }
  }
  for (const p of activePropBindings) {
    const eid = elementIdByKey.get(`prop:${p.id}`)
    if (eid) {
      elementList.push({ element_id: eid })
      elementListNames.push(p.name)
    }
  }
  // Use element_list path only when EVERY active binding registered
  // successfully — otherwise mixing would leave some entities on the
  // <<<image_N>>> path and others on <<<element_N>>>, which Kling
  // can't fan-out coherently. Style ref counts toward the gate so a
  // failed style registration falls everyone back to FileInfos (which
  // is what passes the style ref via referenceImageUrls anyway).
  const styleRefIsRegistered = styleRefBinding !== null && styleRefBinding.tencentVodElementId !== null
  const totalActive =
    activeCharacterBindings.length
    + activeSceneBindings.length
    + activePropBindings.length
    + (styleRefBinding !== null ? 1 : 0)
  const expectedElementListSize =
    activeCharacterBindings.length
    + activeSceneBindings.length
    + activePropBindings.length
    + (styleRefIsRegistered ? 1 : 0)
  const useElementListPath = elementList.length === expectedElementListSize && elementList.length === totalActive && totalActive > 0
  logger.info({
    message: 'tencent vod element registration summary',
    details: {
      totalActive,
      registered: elementList.length,
      useElementListPath,
      elementListNames,
    },
  })

  // Legacy scaffolding (kept for diagnostic / SubjectInfos.N path).
  // Even with element_list, we don't currently pass SubjectInfos.N to the
  // generator (the official sample uses ExtInfo.element_list, which is
  // a separate parameter slot). Leave this empty so generator.subjectInfos
  // stays null and Tencent doesn't reject for mixed binding spec.
  const subjectInfosForGenerator: Array<{ id: string; name: string }> = []

  // 1-indexed name → FileInfos position. Order is character refs
  // first, then scene refs — must mirror the referenceImageUrls
  // order so prompt's <<<image_N>>> stays in sync. We also map the
  // location name (sceneBindings[i].name) so visual descriptions
  // mentioning the place get a `<<<image_N>>>` substitution too.
  //
  // 2026-05-13 — style anchor slot is INTENTIONALLY excluded from
  // nameToImageIndex. The substituteImageRefs path is for translating
  // user-visible names (character / scene / prop) in the narrative
  // into <<<image_N>>> tokens. The style anchor has no human-readable
  // name in the prompt — the worker emits its <<<image_N>>> reference
  // directly via the style header section (see buildStyleAnchorHeader).
  const nameToImageIndex = new Map<string, number>()
  subjectInfos.forEach((s, i) => {
    if (s.name && s.name !== '__STYLE_ANCHOR__') nameToImageIndex.set(s.name, i + 1)
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
    const cleaned = normalizeVoiceLinesToDialogue(fallback, fallbackSpeaker)
    if (cleaned.length > 0) dialogueByPanel.set(panel.id, cleaned)
  }

  // ──────── First-frame lock path (2026-05-13, Option B) ────────
  //
  // When caller passes firstFrameImageUrl, switch to Kling 3.0 / Omni
  // image-to-video SINGLE-shot mode. The locked image becomes the
  // exact opening pixel of the video; LastFrameUrl optionally locks
  // the ending pixel too. multi_shot is dropped (Tencent VOD's third-
  // party API treats 首尾帧 as 一镜到底 — mutually exclusive with
  // multi_prompt). Chunker, dialogue-driven allocator, and the entire
  // multi-shot dispatch path below are bypassed.
  //
  // Trade-off: user gets pixel-level character/scene consistency at
  // the cost of multi-shot pacing. Best for character intros,
  // reaction shots, and transition shots.
  if (isFirstFrameLockMode) {
    const storyboardId = validPanels[0].storyboardId
    const isFirstLastFrame =
      typeof lastFrameImageUrl === 'string' && lastFrameImageUrl.length > 0

    // Single-shot prompt: reuse the existing combined-prompt builder
    // (镜头N: …) so the narrative arc the user wrote still drives the
    // motion through the locked frame. Substitutes character names →
    // <<<image_N>>> tokens via nameToImageIndex when a SubjectInfos
    // slot exists for that name.
    const combinedPrompt = buildBPathCombinedPrompt(
      validPanels,
      dialogueByPanel,
      nameToImageIndex,
      unboundNames,
    )
    if (!combinedPrompt.trim()) {
      throw new Error(
        'MULTI_SHOT_PROMPT_EMPTY: every panel had empty videoPrompt + description (first-frame lock mode)',
      )
    }

    // Duration: dialogue-driven if voice lines exist, else 5s default.
    // Clamp 3-15s (Kling Omni hard limits).
    let totalDuration = 5
    if (dialogueByPanel.size > 0) {
      let speechSeconds = 0
      for (const lines of dialogueByPanel.values()) {
        speechSeconds += estimatePanelSpeechSeconds(lines)
      }
      if (speechSeconds > 0) {
        totalDuration = Math.max(3, Math.min(KLING_OMNI_MAX_TOTAL_DURATION, Math.ceil(speechSeconds)))
      }
    }

    logger.info({
      message: 'B path first-frame lock submit',
      details: {
        videoModel,
        shotCount: validPanels.length,
        hasLastFrame: isFirstLastFrame,
        duration: totalDuration,
        firstFrameImageUrl,
        ...(isFirstLastFrame ? { lastFrameImageUrl } : {}),
        promptLength: combinedPrompt.length,
        dialogueLineCount: voiceLines.length,
      },
    })

    await reportTaskProgress(job, 30, { stage: 'submit_generation_b_path_first_frame' })

    // Tencent doc §3.9.3: in 首帧/首尾帧 mode aspect ratio is derived
    // from the input frame (specifying it has no effect). Drop it.
    //
    // generateVideo signature: (userId, modelKey, imageUrl, options)
    // — third positional `imageUrl` is the first-frame image URL; the
    // tencent-vod generator places it as FileInfos[0]. Prompt rides
    // inside options.prompt. Optional last frame goes through as
    // options.lastFrameUrl (typed in TencentVODVideoOptions).
    const firstFrameOptions: Record<string, unknown> = {
      prompt: combinedPrompt,
      duration: totalDuration,
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      ...(isFirstLastFrame ? { lastFrameUrl: lastFrameImageUrl } : {}),
      // referenceUsage 'FirstFrame' tells the generator to set
      // FileInfos[0].Usage='FirstFrame' explicitly (matches Tencent
      // doc §3.9.3 方式1 recommended pattern).
      referenceUsage: 'FirstFrame',
      outputComplianceCheck: 'Enabled',
    }


    const generateResult = await generateVideo(
      userId,
      videoModel,
      firstFrameImageUrl,
      firstFrameOptions as any,
    )
    if (!generateResult.success) {
      throw new Error(generateResult.error || 'Tencent VOD first-frame submit failed')
    }
    const externalId =
      typeof generateResult.externalId === 'string' ? generateResult.externalId.trim() : ''
    if (!externalId) {
      throw new Error('Tencent VOD first-frame returned no externalId')
    }

    const polled = await waitExternalResult(job, externalId, userId, {
      progressStart: 35,
      progressEnd: 90,
    })

    await assertTaskActive(job, 'persist_multi_shot_video_b_path_first_frame')
    const cosKey = await uploadVideoSourceToCos(
      polled.url,
      isFirstLastFrame ? 'multi-shot-video-b-first-last' : 'multi-shot-video-b-first-frame',
      storyboardId,
    )

    await reportTaskProgress(job, 95, { stage: 'persist' })
    const update = buildMultiShotClipUpdate([cosKey])
    await prisma.novelPromotionStoryboard.update({
      where: { id: storyboardId },
      data: update,
    })

    return {
      storyboardId,
      multiShotVideoUrl: cosKey,
      multiShotClipUrls: [cosKey],
      chunkCount: 1,
      shotCount: validPanels.length,
      subjectCount: subjectInfos.length,
      path: 'B',
      multiShotMode: isFirstLastFrame ? 'first_last_frame' : 'first_frame',
      durations: [totalDuration],
      promptSource: 'first_frame',
      bindings: {
        characters: activeCharacterBindings,
        scenes: activeSceneBindings,
        props: activePropBindings,
      },
    }
  }
  // ──────── End first-frame lock path ────────

  // Dialogue-driven duration allocation + chunked dispatch (2026-05-03).
  //
  // When voice lines exist and the caller didn't pin per-shot durations:
  //   1. Try to fit the whole group in one Kling call (≤15s budget).
  //      Auto-promotes to customize mode + per-panel speech estimates.
  //   2. If the group's speech alone exceeds 15s, fall through to the
  //      chunker which splits the group into N sub-chunks (each ≤15s),
  //      each dispatched as its own Kling call. User downloads N mp4
  //      clips and stitches them in their NLE — we explicitly do NOT
  //      stitch server-side because the NLE is the user's editor of
  //      choice.
  //
  // Caller-supplied panelDurations or rawPrompt always win — both
  // signal "the upstream knows what they're doing, leave it alone".
  let chunkSplitPlan: { chunks: MultiKlingChunk[]; cutReasons: string[] } | null = null
  if (
    effectivePanelDurations === undefined
    && rawPrompt === undefined
    && dialogueByPanel.size > 0
  ) {
    try {
      const driven = buildDialogueDrivenDurations({
        panels: validPanels,
        dialogueByPanelId: dialogueByPanel,
      })
      if (driven) {
        effectivePanelDurations = driven.durations
        multiShotMode = 'customize'
        logger.info({
          message: 'B path auto-promoted to customize via dialogue-driven durations',
          details: {
            shotCount: validPanels.length,
            durations: driven.durations,
            totalDuration: driven.totalDuration,
            rawEstimateTotal: Number(driven.rawEstimateTotal.toFixed(2)),
            clampedPanelIndices: driven.clampedPanels,
          },
        })
      }
    } catch (err) {
      const message = (err as Error)?.message ?? ''
      if (message.startsWith('DIALOGUE_EXCEEDS_KLING_BUDGET')) {
        // Speech > 15s — chunk the group across multiple Kling calls.
        // Errors from the chunker (e.g. EXCEEDS_DISPATCH_LIMIT) bubble
        // up to the caller with a friendly message; we don't try to
        // recover further.
        try {
          const plan = buildMultiKlingSplitPlan({
            panels: validPanels,
            dialogueByPanelId: dialogueByPanel,
          })
          if (plan) {
            chunkSplitPlan = plan
            multiShotMode = 'customize'
            logger.info({
              message: 'B path auto-chunked via multi-kling split plan',
              details: {
                chunkCount: plan.chunks.length,
                chunkSizes: plan.chunks.map((c) => c.panels.length),
                chunkDurations: plan.chunks.map((c) => c.totalDuration),
                cutReasons: plan.cutReasons,
                score: plan.score,
              },
            })
          } else {
            // Shouldn't be reachable — buildDialogueDrivenDurations
            // threw, so the chunker should have something to do.
            throw err
          }
        } catch (chunkErr) {
          if (chunkErr instanceof MultiKlingChunkerError) throw chunkErr
          throw err
        }
      } else {
        throw err
      }
    }
  }

  await reportTaskProgress(job, 30, { stage: 'submit_generation_b_path' })

  // ──────── Chunked dispatch path (>15s dialogue groups) ────────
  if (chunkSplitPlan) {
    const cosKeys: string[] = []
    const allDurations: number[] = []
    const storyboardId = validPanels[0].storyboardId
    const progressBase = 30
    const progressRange = 60 / chunkSplitPlan.chunks.length

    for (let i = 0; i < chunkSplitPlan.chunks.length; i++) {
      const chunk = chunkSplitPlan.chunks[i]
      const chunkPanels = chunk.panels as BPathPanel[]
      const multiPrompt = buildBPathCustomizePrompts(
        chunkPanels,
        dialogueByPanel,
        chunk.durations,
        nameToImageIndex,
        unboundNames,
      )
      if (multiPrompt.length === 0) {
        throw new Error(
          `MULTI_SHOT_PROMPT_EMPTY: chunk ${i + 1}/${chunkSplitPlan.chunks.length} had no usable shots`,
        )
      }
      const finalTotal = multiPrompt.reduce((s, p) => s + p.duration, 0)
      allDurations.push(...multiPrompt.map((p) => p.duration))
      const placeholderPrompt = buildBPathCombinedPrompt(
        chunkPanels,
        dialogueByPanel,
        nameToImageIndex,
        unboundNames,
      )
      const chunkOptions: Record<string, unknown> = {
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

      logger.info({
        message: 'B path multi-chunk submit',
        details: {
          chunkIndex: i + 1,
          chunkTotal: chunkSplitPlan.chunks.length,
          shotCount: multiPrompt.length,
          durations: multiPrompt.map((p) => p.duration),
          totalDuration: finalTotal,
        },
      })

      // Stage label per-chunk so the task-status feed shows
      // "chunk 1/3" rather than a single opaque progress bar.
      // UI can read details.chunkIndex / chunkTotal to render
      // "對白較長,正在生成第 i 段（共 N 段）".
      await reportTaskProgress(job, Math.floor(progressBase + i * progressRange), {
        stage: 'multi_kling_chunk_submit',
        chunkIndex: i + 1,
        chunkTotal: chunkSplitPlan.chunks.length,
      })

       
      const generateResult = await generateVideo(userId, videoModel, '', chunkOptions as any)
      if (!generateResult.success) {
        throw new Error(
          generateResult.error || `Tencent VOD chunk ${i + 1} submit failed`,
        )
      }
      const externalId =
        typeof generateResult.externalId === 'string' ? generateResult.externalId.trim() : ''
      if (!externalId) {
        throw new Error(`Tencent VOD chunk ${i + 1} returned no externalId`)
      }

      const chunkProgressStart = progressBase + i * progressRange
      const chunkProgressEnd = chunkProgressStart + progressRange * 0.95
      const polled = await waitExternalResult(job, externalId, userId, {
        progressStart: chunkProgressStart,
        progressEnd: chunkProgressEnd,
      })

      await assertTaskActive(job, `persist_multi_shot_video_b_path_chunk_${i + 1}`)
      const cosKey = await uploadVideoSourceToCos(
        polled.url,
        `multi-shot-video-b-chunk-${i + 1}`,
        storyboardId,
      )
      cosKeys.push(cosKey)
    }

    await reportTaskProgress(job, 95, { stage: 'persist' })
    const update = buildMultiShotClipUpdate(cosKeys)
    await prisma.novelPromotionStoryboard.update({
      where: { id: storyboardId },
      data: update,
    })

    return {
      storyboardId,
      multiShotVideoUrl: cosKeys[0],
      multiShotClipUrls: cosKeys,
      chunkCount: cosKeys.length,
      shotCount: validPanels.length,
      subjectCount: subjectInfos.length,
      path: 'B',
      multiShotMode: 'customize',
      durations: allDurations,
      bindings: {
        characters: activeCharacterBindings,
        scenes: activeSceneBindings,
        props: activePropBindings,
      },
    }
  }
  // ──────── End chunked dispatch path ────────

  // Branch on mode: customize gets per-shot multi_prompt entries with
  // explicit durations; intelligence keeps the legacy combined-prompt
  // path so existing callers remain bit-for-bit identical to pre-fix
  // behaviour. Both paths share dialogue injection.
  let generateOptions: Record<string, unknown>
  let resolvedDurations: number[] | undefined
  let resolvedTotal: number
  let intelligencePromptSource: 'panels' | 'raw' | 'seedance' = 'panels'

  if (multiShotMode === 'customize') {
    // totalDuration from distributeShotDurations is recomputed below as
    // finalTotal after buildBPathCustomizePrompts may drop empty shots —
    // discard the initial value to avoid a misleading dead binding.
    const { durations } = distributeShotDurations(validPanels.length, effectivePanelDurations)
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
        useElementListPath,
      },
    })

    // Tencent API treats top-level Prompt as semantically ignored in
    // customize mode but still validates non-empty (fails with ret:1201
    // "prompt cannot be empty" otherwise). Use the combined prompt as a
    // safe non-empty payload — the model uses multi_prompt entries for
    // actual generation.
    const placeholderPromptRaw = buildBPathCombinedPrompt(validPanels, dialogueByPanel, nameToImageIndex, unboundNames)
    const placeholderPrompt = useElementListPath ? rewriteImageRefsToElementRefs(placeholderPromptRaw) : placeholderPromptRaw
    // Customize mode: Tencent ignores top-level Prompt and reads only
    // multi_prompt[].prompt. Append style suffix to EVERY per-shot
    // entry so the photoreal anchor applies uniformly across the cut.
    const styleSuffix = (() => {
      if (!styleRefBinding || styleRefBinding.slot <= 0) return ''
      const refToken = useElementListPath
        ? `<<<element_${styleRefBinding.slot}>>>`
        : `<<<image_${styleRefBinding.slot}>>>`
      return ` (visual style matches ${refToken}: live-action photography, NOT animation, NOT CG, NOT 3D render)`
    })()
    const multiPromptResolved = useElementListPath
      ? multiPrompt.map((mp) => ({
          ...mp,
          prompt: `${rewriteImageRefsToElementRefs(mp.prompt)}${styleSuffix}`,
        }))
      : (styleSuffix
        ? multiPrompt.map((mp) => ({ ...mp, prompt: `${mp.prompt}${styleSuffix}` }))
        : multiPrompt)
    generateOptions = {
      prompt: placeholderPrompt,
      duration: finalTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      // Element-list mode supplies references via ExtInfo; FileInfos refs
      // would conflict with the prompt token namespace. Image-mode keeps
      // referenceImageUrls so the FileInfos path resolves.
      ...(useElementListPath
        ? {}
        : referenceImageUrls.length > 0
          ? { referenceImageUrls }
          : {}),
      ...(subjectInfosForGenerator.length > 0 ? { subjectInfos: subjectInfosForGenerator } : {}),
      ...(useElementListPath ? { extInfo: { element_list: elementList } } : {}),
      klingMultiShot: {
        multi_shot: true,
        shot_type: 'customize',
        multi_prompt: multiPromptResolved,
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
      //
      // 2026-05-13 — but DO run substituteImageRefs so [character] /
      // bare character names in the narrative get translated to the
      // <<<image_N>>> tokens Kling actually parses for SubjectInfos
      // binding. Without this, the narrative looks readable in the UI
      // but Kling sees literal text and invents identities from prompt.
      // panel-numbered / seedance modes already do this; raw used to
      // skip it because we feared regex over-matching, but the regex
      // is case-insensitive whole-substring on a small known-name set
      // (subjectInfos.name list, max 3 entries) — collision risk is
      // negligible vs the binding payoff.
      // Step 1: bound names → <<<image_N>>> tokens (Kling binding syntax).
      let workingPrompt = nameToImageIndex.size > 0
        ? substituteImageRefs(rawPrompt.trim(), nameToImageIndex)
        : rawPrompt.trim()
      // Step 2 (2026-05-13): unbound character names → "另一人". When a
      // group has > 3 unique characters/scenes, Tencent VOD's hard
      // SubjectInfos cap (3 slots) drops the overflow — but their bare
      // names still litter the cinematic narrative ("...坎、离迅速转头
      // ...") and Kling tries to invent identities for them, producing
      // wrong faces. panel-numbered / seedance modes already do this
      // via buildShotBody → rewriteForUnboundCharacters; raw mode was
      // the outlier. Now mirrored.
      if (unboundNames.size > 0) {
        const { rewritten } = rewriteForUnboundCharacters(workingPrompt, unboundNames)
        workingPrompt = rewritten
      }
      // Step 3 (2026-05-13): drop "参考图片N的[X]（高度一致）" anchor lines
      // that reference an entity NOT actually in referenceImageUrls. The
      // frontend cinematic narrative emits one anchor per character/scene
      // it sees in the group, but the worker may cap at 3. Leaving stale
      // anchors makes Kling believe ref slots 4-6 exist when they don't,
      // and it hallucinates content to fill them. Filter by checking
      // each anchor line's referenced name against bound entities.
      const boundEntityNames = new Set<string>([
        ...activeCharacterBindings.map((c) => c.name),
        ...activeSceneBindings.map((s) => s.name),
        ...activePropBindings.map((p) => p.name),
      ])
      // Two anchor formats to filter:
      //   legacy: "参考图片1的[王玄]人物形象（高度一致）"
      //   2026-05-13: "<<<image_1>>>（即[王玄]，角色锚点，高度一致）"
      //                "<<<image_3>>>（即街道·夜，场景锚点，高度一致）"
      // Both encode (slot, entityName). If the entity isn't in the
      // bound set (because we've already substituted via the new
      // <<<image_N>>> path, this becomes a no-op for new lines).
      const ANCHOR_LINE_RE_LEGACY = /^参考图片\d+的\[?([^\]）]+?)\]?(?:人物形象)?（高度一致）$/
      const ANCHOR_LINE_RE_V2 = /^<<<image_\d+>>>（即\[?([^\]，）]+?)\]?(?:，[^）]*)?）$/
      workingPrompt = workingPrompt
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim()
          const matchV2 = ANCHOR_LINE_RE_V2.exec(trimmed)
          if (matchV2) {
            const refName = matchV2[1].trim()
            return boundEntityNames.has(refName)
          }
          const match = ANCHOR_LINE_RE_LEGACY.exec(trimmed)
          if (!match) return true
          const refName = match[1].trim()
          // <<<image_N>>> tokens are always bound — keep.
          if (/^<<<image_\d+>>>$/.test(refName)) return true
          // Otherwise check the bound entity set.
          return boundEntityNames.has(refName)
        })
        .join('\n')
      // 2026-05-13 — Photoreal style anchor injection.
      //
      // Kling Omni's xianxia/CG training prior overrides text-based
      // photorealistic anchors. We solve this by feeding an actual real
      // photo via SubjectInfos (slot `styleRefBinding.slot`) and
      // prepending a TOP-anchored English header that explicitly tells
      // Kling to copy the style from that slot. English-only to avoid
      // CN→xianxia trigger. TOP placement maximises Kling's attention
      // weight (model attention decays toward end of long prompts).
      if (styleRefBinding && styleRefBinding.slot > 0) {
        const refToken = useElementListPath
          ? `<<<element_${styleRefBinding.slot}>>>`
          : `<<<image_${styleRefBinding.slot}>>>`
        const styleHeader = [
          `STYLE: live-action film photography. Match the visual style of ${refToken} exactly — lighting, film grain, skin texture with visible pores, fabric weave, natural shadows, lens characteristics. ${refToken} is a STYLE REFERENCE ONLY, NOT a character or location.`,
          'STRICT: NOT animation, NOT CG, NOT 3D render, NOT illustration, NOT digital painting, NOT xianxia stylized art, NOT Genshin Impact aesthetic. Output must look like a real photograph captured on Arri Alexa or RED camera, 35mm lens, with documentary realism.',
          '',
        ].join('\n')
        workingPrompt = `${styleHeader}\n${workingPrompt}`
      }
      primaryPrompt = workingPrompt
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

    // If we're going element-list path, rewrite <<<image_N>>> tokens to
    // <<<element_N>>>. Slot order is preserved (elementList was built in
    // the same character → scene → prop order as referenceImageUrls), so
    // N stays the same — only the namespace prefix changes.
    let primaryPromptResolved = useElementListPath ? rewriteImageRefsToElementRefs(primaryPrompt) : primaryPrompt
    // Inject style anchor header for the non-raw intelligence paths
    // (panel-numbered / auto-seedance). The raw path already inlined the
    // header above so it doesn't get double-prepended.
    if (promptSource !== 'raw' && styleRefBinding && styleRefBinding.slot > 0) {
      const refToken = useElementListPath
        ? `<<<element_${styleRefBinding.slot}>>>`
        : `<<<image_${styleRefBinding.slot}>>>`
      const styleHeader = [
        `STYLE: live-action film photography. Match the visual style of ${refToken} exactly — lighting, film grain, skin texture with visible pores, fabric weave, natural shadows, lens characteristics. ${refToken} is a STYLE REFERENCE ONLY, NOT a character or location.`,
        'STRICT: NOT animation, NOT CG, NOT 3D render, NOT illustration, NOT digital painting, NOT xianxia stylized art, NOT Genshin Impact aesthetic. Output must look like a real photograph captured on Arri Alexa or RED camera, 35mm lens, with documentary realism.',
        '',
      ].join('\n')
      primaryPromptResolved = `${styleHeader}\n${primaryPromptResolved}`
    }

    logger.info({
      message: 'B path multi-shot submit (intelligence)',
      details: {
        videoModel,
        shotCount: validPanels.length,
        subjectCount: subjectInfos.length,
        promptLength: primaryPromptResolved.length,
        promptSource,
        dialogueLineCount: voiceLines.length,
        totalDuration: resolvedTotal,
        useElementListPath,
      },
    })

    generateOptions = {
      prompt: primaryPromptResolved,
      duration: resolvedTotal,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(sound !== undefined ? { generateAudio: sound } : {}),
      ...(useElementListPath
        ? {}
        : referenceImageUrls.length > 0
          ? { referenceImageUrls }
          : {}),
      ...(subjectInfosForGenerator.length > 0 ? { subjectInfos: subjectInfosForGenerator } : {}),
      ...(useElementListPath ? { extInfo: { element_list: elementList } } : {}),
      // 2026-05-13 — Tencent doc §3.9.5 spec:
      //   multi_shot: bool (true/false)
      //   shot_type: 'customize' | 'intelligence'  (required when multi_shot=true)
      // Earlier code passed `multi_shot: 'intelligence'` as a single
      // string field, which Tencent silently dropped (multi_shot must
      // be bool). Combined with the missing AdditionalParameters
      // wrapper bug, this meant intelligence-mode multi-shot was
      // never actually firing — Kling rendered the entire prompt as
      // a single 15s clip with whatever shot composition the parser
      // could divine from the embedded text.
      klingMultiShot: { multi_shot: true, shot_type: 'intelligence' },
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

  // Single-clip path still populates multiShotClipUrls with a 1-element
  // array so consumers always see a uniform shape.
  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: buildMultiShotClipUpdate([cosKey]),
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    multiShotClipUrls: [cosKey],
    chunkCount: 1,
    shotCount: validPanels.length,
    subjectCount: subjectInfos.length,
    path: 'B',
    multiShotMode,
    ...(resolvedDurations ? { durations: resolvedDurations } : {}),
    ...(multiShotMode === 'intelligence' ? { promptSource: intelligencePromptSource } : {}),
    bindings: {
      characters: activeCharacterBindings,
      scenes: activeSceneBindings,
      props: activePropBindings,
    },
  }
}
