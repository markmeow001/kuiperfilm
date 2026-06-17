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
 *
 * 2026-06-17 — the old inline regex (/對白：|说「|: "/) missed the Seedance
 * 「…」 form, so dialogueBeatCount was 0 for the primary R2V narrative-edit
 * path → the ambient-only directive (below) forbade speech → R2V went silent
 * on dialogue. Regression from 18250aa, which wired this already-broken count
 * into a speech-banning directive. Matching 「 restores native dialogue.
 */
export function countDialogueBeats(raw: string): number {
  return (raw.match(/「|對白：|: "/g) || []).length
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
