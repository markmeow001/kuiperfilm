// Dialogue extraction + group-aware attribution for storyboard panels.
// Split out of script-to-storyboard-helpers.ts (2026-05-28) to keep that file
// under the worker-handler line budget and make the dialogue logic a cohesive,
// independently testable module. Pure string/regex — no external deps.

/**
 * 從 LLM 輸出的 source_text 抽出真正的對話。
 *
 * Background: agent_storyboard_plan prompt 規定每個 panel 都要有 source_text
 * (對應原文片段),所以 LLM 把場景描述如「特写: 一个插着...」、
 * 「全景: 餐桌上一片死寂。BRUCE...」、「编号1 ...」也塞進這個欄位,跟真
 * 對話混在一行。我們直接寫 srtSegment 結果 V2 對話框出現一堆敘述。
 *
 * 觀察到的混雜模式(real prod data,project 17b1f037):
 *   ❌ 「特写: 一个插着"45"数字蜡烛的蛋糕被端上桌。CATHERINE: ¡Sorpresa!...」
 *      → 一行內前段是場景敘述,後段才是對話
 *   ❌ 「全景: 餐桌上一片死寂。BRUCE(丈夫)盯着平板...沒人看蛋糕一眼」
 *      → 一行內全是敘述沒真對話(BRUCE 後面是定語不是冒號)
 *   ❌ 「编号3 TOBY 戴着大耳机...」
 *      → 「TOBY」雖是角色名但這裡是「關於 TOBY 的描述」非「TOBY 說的話」
 *   ✅ 「TOBY: Mamá, estás tapando la luz...」
 *      → 標準說話者:對話
 *
 * 抽法 v2 — match-all + 場景詞 denylist:
 *   1. 全文 regex 找出所有 `<說話者>:<內容>` segment(可在一行內多個)
 *   2. 說話者必須是「全大寫拉丁字母 ≥ 2」或「短中文(1-4 字)且不在場景詞 denylist」
 *   3. 抽出後重組為 `說話者: 內容` 換行串接
 *   4. 整段沒命中 → null(留空對話框,讓 user 手動補)
 */
const SCENE_KEYWORDS = new Set<string>([
  '特写', '特寫', '大特写', '大特寫',
  '近景', '中近景', '中景', '全景', '远景', '遠景',
  '空镜', '空鏡', '空镜头', '空鏡頭',
  '俯视', '俯視', '仰视', '仰視', '平视', '平視',
  '正反打', '反打', '过肩', '過肩',
  '航拍', '推拉', '运镜', '運鏡',
  '蒙太奇', '蒙太奇',
  '场景', '場景', '镜头', '鏡頭',
  '描述', '动作', '動作', '画外', '畫外', '画外音', '畫外音',
  '编号', '編號',
])

// 2026-05-22 — audio-design labels masquerade as speakers because they
// share the `<word>：<content>` shape. The 迁徙 ep3 bug was
// `（音效：尖锐的单音蜂鸣）` landing in panel srtSegment as if 音效 spoke
// it. These are metadata categories, never characters.
const AUDIO_METADATA_KEYWORDS = new Set<string>([
  '音效', '音樂', '音乐', '配乐', '配樂', 'BGM', 'SFX',
  '声音', '聲音', '对白', '對白', '台词', '台詞',
  '旁白', '旁白', '解说', '解說', '字幕',
  '光效', '特效',
])

// 2026-05-22 — compound camera/shot suffixes. The original denylist
// only caught literal `特写` but missed `极端特写` / `对话镜头` /
// `跟拍中景`. Suffix match catches every X+suffix compound the LLM
// invents.
const SCENE_SUFFIXES = [
  '镜头', '鏡頭', '特写', '特寫', '近景', '中景', '远景', '遠景',
  '全景', '空镜', '空鏡', '反打', '过肩', '過肩', '俯视', '俯視',
  '仰视', '仰視', '蒙太奇',
]

function isLikelyScenePrefix(speaker: string): boolean {
  const trimmed = speaker.trim()
  if (!trimmed) return true
  if (SCENE_KEYWORDS.has(trimmed)) return true
  if (AUDIO_METADATA_KEYWORDS.has(trimmed)) return true
  // Compound camera terms like `对话镜头`, `极端特写`, `跟拍中景`
  for (const suffix of SCENE_SUFFIXES) {
    if (trimmed.length > suffix.length && trimmed.endsWith(suffix)) return true
  }
  // "编号3" / "鏡頭5" / "Shot 7" / "Panel 12"
  if (/^(编号|編號|镜头|鏡頭|场景|場景|Shot|Panel|Scene)\s*\d+/i.test(trimmed)) return true
  // Pure digits like "1" / "01"
  if (/^\d+$/.test(trimmed)) return true
  return false
}

// Speaker shape — covers:
//  - ALL-CAPS Latin lead, mixed body (e.g. CATHERINE, AI, BO-7)
//  - CJK lead, mixed body (e.g. 长官, 镜, AI 系统广播 when matched via Latin lead)
//  - Mixed Latin+CJK like `AI 系统广播` — Latin track allows CJK in body
// Length bounded 1-30 incl. lead.
const SPEAKER_RE_SRC =
  '([A-ZÁÉÍÓÚÑÄÖÜ][A-ZÁÉÍÓÚÑÄÖÜa-zá-ÿ一-鿿\\s\']{1,30}|[一-鿿][一-鿿A-ZÁÉÍÓÚÑÄÖÜa-zá-ÿ\\s\']{0,19})'
// 2026-05-22 — `<speaker>（<modifier>）：<content>` is the screenplay
// convention used in《迁徙》 ep1+ep3 (5/6 dialogue lines) and was the
// silent failure mode that left panel.srtSegment NULL → Seedance R2V
// generated silent lip-sync. Make the parenthetical optional but
// allowed between the speaker name and the colon.
const PAREN_RE_SRC = '(?:\\s*[（(][^）)\\n]{0,40}[）)])?'
const COLON_RE_SRC = '\\s*[:：]\\s*'

/** Match `<speaker>(<modifier>)?:` heads across the whole text. */
const HEAD_RE = new RegExp(SPEAKER_RE_SRC + PAREN_RE_SRC + COLON_RE_SRC, 'gu')

export type DialogueLine = { speaker: string; content: string }

/**
 * Structured form of {@link extractDialogueFromSourceText}: every
 * `<speaker>(<modifier>)?:<content>` head (scene/audio denylist applied),
 * in source order. Exposed so dialogue can be attributed per-speaker.
 */
export function extractDialogueLinesFromSourceText(
  raw: string | null | undefined,
): DialogueLine[] {
  if (!raw) return []
  const text = raw.trim()
  if (!text) return []

  // Pass 1 — find every head position in the text. Two-pass instead of
  // one regex with lookahead makes the parens-aware boundary correct
  // even when consecutive heads have different shapes (e.g. one with
  // modifier, one without).
  type Head = { start: number; end: number; speaker: string }
  const heads: Head[] = []
  HEAD_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEAD_RE.exec(text)) !== null) {
    heads.push({
      start: m.index,
      end: m.index + m[0].length,
      speaker: m[1].trim(),
    })
    // Guard against pathological zero-width matches.
    if (m[0].length === 0) HEAD_RE.lastIndex += 1
  }

  if (heads.length === 0) return []

  // Pass 2 — for each valid head, content is the text up to the next
  // head's start (or end of text). Rejected heads still segment the
  // text but their content is discarded.
  const lines: DialogueLine[] = []
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]
    if (isLikelyScenePrefix(head.speaker)) continue
    const contentEnd = i + 1 < heads.length ? heads[i + 1].start : text.length
    const content = text.slice(head.end, contentEnd).trim()
    if (!content) continue
    lines.push({ speaker: head.speaker, content })
  }
  return lines
}

export function extractDialogueFromSourceText(raw: string | null | undefined): string | null {
  const lines = extractDialogueLinesFromSourceText(raw)
  if (lines.length === 0) return null
  return lines.map((l) => `${l.speaker}: ${l.content}`).join('\n')
}

/**
 * Normalize a speaker / character name for cross-matching dialogue heads
 * against a panel's framed `characters`. Case-insensitive; drops
 * parentheticals (（VO）/（旁白）), VO/OS modifiers, and whitespace so
 * `桃桃（VO）` matches `桃桃` and `Kent` matches `KENT`.
 */
export function normalizeSpeakerName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '') // drop （VO） / (modifier)
    .replace(/\b(?:V\.?O\.?|O\.?S\.?)\b/gi, '') // drop bare VO / OS
    .replace(/[^\p{L}\p{N}]/gu, '') // drop whitespace + leftover punctuation
    .toLowerCase()
}

export type PanelDialogueInput = {
  sourceText: string | null | undefined
  /** Names of characters FRAMED in this panel (from panel.characters). */
  framedNames: ReadonlyArray<string>
}

/**
 * Group-aware dialogue attribution.
 *
 * 2026-05-28 — fixes "on-screen speaker rendered as voice-over". The
 * agent_storyboard_plan prompt lets multiple shots SHARE one source_text,
 * and srtSegment was extracted per-panel from that shared text — so every
 * shot (incl. an action / reaction shot) inherited EVERY speaker's line.
 * A shot framing William then "spoke" Kent's line, but Seedance can only
 * lip-sync on-screen faces → Kent became a voice-over.
 *
 * Rule: a spoken line belongs to the panel that FRAMES its speaker
 * (speaker ∈ panel.framedNames). Each line is assigned to exactly one
 * panel. Lines whose speaker no panel frames stay as intentional
 * voice-over on the first panel that carries them — preserving the
 * deliberate VO-over-listener design (e.g. 桃桃 VO over 王玄's reaction,
 * where 桃桃 is intentionally absent from `characters`).
 *
 * Returns srtSegment (or null) per panel, index-aligned to `panels`.
 */
export function attributeDialogueToPanels(
  panels: ReadonlyArray<PanelDialogueInput>,
): Array<string | null> {
  const linesByPanel = panels.map((p) => extractDialogueLinesFromSourceText(p.sourceText))
  const framedSets = panels.map(
    (p) => new Set(p.framedNames.map(normalizeSpeakerName).filter(Boolean)),
  )
  const assigned: DialogueLine[][] = panels.map(() => [])
  const taken = new Set<string>()
  const keyOf = (l: DialogueLine) => `${normalizeSpeakerName(l.speaker)} ${l.content}`

  // Pass 1 — on-screen: route each line to the first panel framing its speaker.
  for (let i = 0; i < panels.length; i++) {
    for (const line of linesByPanel[i]) {
      const k = keyOf(line)
      if (taken.has(k)) continue
      if (framedSets[i].has(normalizeSpeakerName(line.speaker))) {
        assigned[i].push(line)
        taken.add(k)
      }
    }
  }

  // Pass 2 — fallback / VO: any line not claimed on-screen goes to the first
  // panel that carries it. Never drops dialogue; off-screen speakers stay VO.
  for (let i = 0; i < panels.length; i++) {
    for (const line of linesByPanel[i]) {
      const k = keyOf(line)
      if (taken.has(k)) continue
      assigned[i].push(line)
      taken.add(k)
    }
  }

  return assigned.map((lines) =>
    lines.length > 0 ? lines.map((l) => `${l.speaker}: ${l.content}`).join('\n') : null,
  )
}
