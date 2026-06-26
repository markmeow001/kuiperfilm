/**
 * Shared audio directive for every multi-shot composite path (atlascloud /
 * seedance-BobAPI / ark / fal, both auto-built and hand-edited rawPrompt).
 *
 * Single source of truth so the directive can't drift per-vendor (the
 * 4-agent audit, 2026-06-03, found fal lacked the gasp/moan ban and the
 * rawPrompt branches emitted no directive at all).
 *
 * Three mutually-exclusive branches, gated on `soundEnabled` first:
 *
 *   soundEnabled === false → SILENT. The request also sends
 *     generateAudio:false, so the model must NOT be told to "逐字配音 /
 *     唇形同步" — doing so loses the TTS and animates mouths speaking
 *     words that produce no sound (visible desync). This is the fix for
 *     "turn audio off on a dialogue group" (audit finding #1).
 *
 *   dialogueBeatCount > 0 → lip-synced TTS + ambient, but BAN extra
 *     non-dialogue vocalizations (gasps/moans the model invents from
 *     emotional cues), which AtlasCloud's audio moderation false-flags
 *     and blocks the whole clip (2026-06-02 incident).
 *
 *   otherwise → ambient-only, and HARD-ban any human / human-like voice
 *     so a sound-source noun in the description (e.g. 低頻貝斯沉音) is not
 *     synthesized into a human-like hum (2026-05-29 incident).
 */
/**
 * Count dialogue "beats" in a hand-edited rawPrompt narrative — decides whether
 * buildAudioDirective emits the lip-synced-TTS branch or the ambient-only
 * (speech-banned) branch.
 *
 * Matches every form the narrative builders emit:
 *   - 「…」     spoken / VO content. GroupCard buildInitialNarrativeSeedance
 *              renders dialogue as 王玄:「位列仙班！」 and VO as 「洞府一甲子…」;
 *              「 only ever wraps speech in these narratives.
 *   - 對白：    auto-built atlascloud format
 *   - : "       Kling buildInitialNarrative ASCII-quote form
 *   - “…”     v3 字段格式 角色（情绪）：“台词” 的弯引号（2026-06-25）
 *
 * 2026-06-17 — the old inline regex (/對白：|说「|: "/) missed the Seedance
 * 「…」 form, so dialogueBeatCount was 0 for the primary R2V narrative-edit
 * path → the ambient-only directive (below) forbade speech → R2V went silent
 * on dialogue. Regression from 18250aa, which wired this already-broken count
 * into a speech-banning directive. Matching 「 restores native dialogue.
 */
export function countDialogueBeats(raw: string): number {
  return (raw.match(/「|[:：]\s*“|對白：|: "/g) || []).length
}

export function buildAudioDirective(
  dialogueBeatCount: number,
  soundEnabled: boolean = true,
): string {
  if (!soundEnabled) {
    return (
      '音頻：本組關閉聲音輸出（靜音），請勿合成任何配音、對白語音、人聲或音效；'
      + '畫面照常呈現，若鏡頭中有人物說話，以自然神態與口型帶過即可，無需逐字對嘴配音；'
      + '無字幕、無 logo、無屏幕信息。'
    )
  }
  if (dialogueBeatCount > 0) {
    return (
      '音頻：原生輸出雙聲道，按上述對白逐字配音（語氣、停頓、情緒與角色一致），'
      + '唇形與配音嚴格同步；背景疊加場景對應的環境音（風聲、腳步、室內回響等）。'
      + '除上述對白台詞外，請勿額外合成喘息、呻吟、哭喊、尖叫、急促呼吸或其他非對白人聲；'
      + '無字幕、無 logo、無屏幕信息。'
    )
  }
  return (
    '音頻：本組無對白，僅輸出場景對應的自然環境音（風聲、雨聲、機械聲等非語音物理聲源）'
    + '與適配的無人聲背景音樂；嚴禁合成任何人聲、類人聲、哼唱、歌聲或說話聲——'
    + '描述中提及的聲源（如低頻、貝斯、鳴響）一律僅作為環境音場處理，不得當作人聲音色合成；'
    + '畫面無字幕、無 logo、無屏幕信息。'
  )
}

export interface RawDialogueBeat {
  speaker: string
  content: string
}

/**
 * Speaker tokens that are actually structural narrative labels, not characters.
 * A `镜头1` / `环境音效` / `场景` immediately before a 「…」 must NOT be turned
 * into a speech line. Kept tight on purpose — real character names are unlikely
 * to collide with these.
 */
const NON_SPEAKER_LABELS = new Set([
  '镜头', '鏡頭', '环境音效', '環境音效', '场景', '場景', '场景参考', '場景參考',
  '参考', '參考', '风格', '風格', '画面', '畫面', '旁白', '字幕', '音效', '背景',
  '开头', '開頭', '中段', '展开', '展開', '收尾', '收束', '空间锚点', '空間錨點',
  // locatives that commonly precede a quoted ambient-sound noun (远处「钟声」)
  '远处', '遠處', '近处', '近處', '周围', '周圍', '四周', '身后', '身後', '头顶',
  '頭頂', '空中', '远方', '遠方', '耳边', '耳邊', '楼下', '樓下', '楼上', '樓上',
  '门外', '門外', '窗外', '屋内', '屋內', '室内', '室內',
  // v3 字段标签：【人物对应台词】角色：「…」 — 标签本身不是说话者
  '人物对应台词', '人物對應台詞', '台词', '台詞',
])

const stripSpeakerDecorations = (token: string): string =>
  token.replace(/^[@＠]/, '').replace(/[MＭFＦ]$/, '').trim()

/**
 * Extract on-camera dialogue beats from a hand-edited R2V narrative.
 *
 * Matches `{speaker}「…」`, `{speaker}:「…」`, `{speaker}：「…」` and
 * `{speaker}（声线：…）:「…」` — the forms GroupCard's narrative builder and the
 * storyboard-detail LLM emit. A speaker name MUST sit on the same span right
 * before the 「 — bare 「…」 (VO content lines whose speaker is on the previous
 * line, or quoted non-dialogue terms) is skipped so we don't voice non-dialogue.
 *
 * 2026-06-16 — AtlasCloud Seedance R2V reliably TTS's `{speaker}说「…」` but very
 * often ships SILENT on plain `{speaker}「…」` (proven by the sibling BobAPI
 * seedance path, which rewrites every line into `说「…」` form and documents that
 * pure-visual prompts produce no speech). The rawPrompt branch shipped the
 * narrative verbatim with no 说 verb, so dialogue went unvoiced even though the
 * audio directive asked for 逐字配音. We extract the beats here and the caller
 * appends an explicit 说「…」 speech list the model acts on.
 */
export function extractRawDialogueBeats(
  raw: string,
  knownSpeakers?: ReadonlyArray<string>,
): RawDialogueBeat[] {
  if (!raw) return []
  const roster = (knownSpeakers ?? [])
    .map((n) => stripSpeakerDecorations(n))
    .filter((n) => n.length > 0)
  const useRoster = roster.length > 0
  const re = /([一-龥A-Za-z0-9·•]{1,12})(?:（[^）]*）)?[:：]?[「“]([^」”]+)[」”]/g
  const beats: RawDialogueBeat[] = []
  const seen = new Set<string>()
  for (const match of raw.matchAll(re)) {
    const rawSpeaker = stripSpeakerDecorations(match[1])
    const content = match[2].trim()
    if (!rawSpeaker || !content) continue
    let speaker = rawSpeaker
    if (useRoster) {
      const hit = roster.find((n) => rawSpeaker === n || rawSpeaker.endsWith(n))
      if (!hit) continue
      speaker = hit
    } else {
    // Skip structural labels and verb-ended runs (e.g. 他说的「天命」 where the
    // "speaker" is really a clause tail, or an already-rewritten X说「…」).
      if (NON_SPEAKER_LABELS.has(rawSpeaker)) continue
      if (/[说說道的是在]$/.test(rawSpeaker)) continue
    }
    const key = `${speaker} ${content}`
    if (seen.has(key)) continue
    seen.add(key)
    beats.push({ speaker, content })
  }
  return beats
}

/**
 * Build an explicit, structured speech list in the proven `{speaker}说「…」` form
 * so AtlasCloud Seedance actually voices the dialogue. Returns '' when there are
 * no beats (caller skips appending). "仅朗读一次/请勿额外添加" guards against the
 * model double-reading lines that also appear in the prose narrative.
 */
export function buildSpeechDialogueBlock(beats: ReadonlyArray<RawDialogueBeat>): string {
  if (beats.length === 0) return ''
  const lines = beats.map((b, i) => `${i + 1}. ${b.speaker}说「${b.content}」`)
  return (
    '【配音台詞清單 — 請讓畫面中對應角色逐字朗讀下列台詞，配音與唇形嚴格同步，'
    + '每句僅朗讀一次，請勿改寫、跳過或額外添加台詞】：\n'
    + lines.join('\n')
  )
}
