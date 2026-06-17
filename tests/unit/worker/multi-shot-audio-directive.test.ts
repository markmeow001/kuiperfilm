/**
 * 2026-06-03 — Shared audio-directive for all multi-shot composite paths.
 *
 * Audit (4-agent review) found the audio directive was hand-copied in FOUR
 * places (atlascloud / seedance / fal / raw branches) and had drifted:
 *  - fal's dialogue branch lacked the "ban extra gasps/moans" clause that
 *    the 2026-06-02 fix added to atlascloud+seedance → re-exposed AtlasCloud
 *    audio-moderation false-positives on fal.
 *  - atlascloud & fal rawPrompt branches appended NO audio directive at all
 *    → re-exposed both the moderation false-positive AND the 2026-05-29
 *    "低頻貝斯沉音 → fake human hum" incident on the primary R2V flow.
 *  - When the user turns audio OFF but a group HAS dialogue, every path
 *    still emitted "逐字配音 + 唇形嚴格同步" while the API sends
 *    generateAudio:false → TTS silently lost + visible lip-sync desync.
 *
 * This consolidates the directive into ONE pure function that all paths
 * call, and adds the missing `soundEnabled` dimension.
 */
import { describe, expect, it } from 'vitest'
import { buildAudioDirective, countDialogueBeats } from '@/lib/workers/handlers/multi-shot-audio-directive'

describe('buildAudioDirective', () => {
  it('defaults soundEnabled to true (back-compat with single-arg callers)', () => {
    expect(buildAudioDirective(0)).toBe(buildAudioDirective(0, true))
    expect(buildAudioDirective(2)).toBe(buildAudioDirective(2, true))
  })

  describe('sound ON', () => {
    it('with dialogue: lip-sync TTS + ambient, and bans EXTRA non-dialogue vocals', () => {
      const d = buildAudioDirective(2, true)
      expect(d).toMatch(/逐字配音/)
      expect(d).toMatch(/唇形/)
      expect(d).toMatch(/環境音|环境音/)
      // the 2026-06-02 moderation-avoidance clause must be present
      expect(d).toMatch(/喘息|呻吟|尖叫/)
      expect(d).toMatch(/勿|禁/)
    })

    it('no dialogue: ambient-only, hard-bans any human/human-like voice', () => {
      const d = buildAudioDirective(0, true)
      expect(d).toMatch(/嚴禁|禁止/)
      expect(d).toMatch(/人聲/)
      expect(d).toMatch(/類人聲|哼唱|歌聲/)
      expect(d).toMatch(/環境音|自然.*音/)
      // does NOT promise dialogue lip-sync
      expect(d).not.toMatch(/逐字配音/)
    })
  })

  describe('sound OFF (the core bug fix)', () => {
    it('with dialogue present: must NOT promise 配音 / 唇形同步 (avoids TTS-lost + desync)', () => {
      const d = buildAudioDirective(3, false)
      expect(d).not.toMatch(/逐字配音/)
      expect(d).not.toMatch(/唇形.*同步|唇形與配音/)
      // explicitly silent
      expect(d).toMatch(/靜音|不生成聲音|不生成任何聲音|無聲/)
    })

    it('no dialogue: also silent', () => {
      const d = buildAudioDirective(0, false)
      expect(d).toMatch(/靜音|不生成聲音|不生成任何聲音|無聲/)
      expect(d).not.toMatch(/逐字配音/)
    })

    it('silent branch is identical regardless of dialogue count', () => {
      expect(buildAudioDirective(0, false)).toBe(buildAudioDirective(5, false))
    })
  })
})

describe('countDialogueBeats — 2026-06-17 R2V dialogue regression', () => {
  // GroupCard buildInitialNarrativeSeedance renders dialogue as 王玄:「…」 and
  // VO as 「…」. The old raw-branch regex (/對白：|说「|: "/) missed these, so
  // dialogueBeatCount was 0 → buildAudioDirective emitted the ambient-only
  // "嚴禁合成…說話聲" directive → R2V went silent on dialogue. These cases lock
  // the fix: the Seedance narrative format MUST count as dialogue.
  it('counts Seedance 「…」 on-camera + VO dialogue (the bug case)', () => {
    const narrative = [
      '【開場】環境音效：整齊的腳步停頓聲與厚重衣物摩擦的下跪聲。',
      '王玄:「位列仙班！」',
      '王玄 聲音(僅音頻，無畫面文字，嘴部不動):',
      '「洞府一甲子，凡塵彈指間，我王玄今日終於要突破劍仙境。」',
    ].join('\n')
    expect(countDialogueBeats(narrative)).toBeGreaterThan(0)
    // → drives the lip-synced-TTS branch, NOT the speech-ban branch
    const directive = buildAudioDirective(countDialogueBeats(narrative), true)
    expect(directive).toMatch(/逐字配音/)
    expect(directive).not.toMatch(/嚴禁合成任何人聲/)
  })

  it('still counts the auto-built 對白： and Kling : " forms', () => {
    expect(countDialogueBeats('第1鏡：他開門。對白：王玄說「走吧」')).toBeGreaterThan(0)
    expect(countDialogueBeats('young man opens the door, 王玄: "let\'s go"')).toBeGreaterThan(0)
  })

  it('returns 0 for a pure-ambient narrative (no dialogue) → ambient directive', () => {
    const narrative = '【開場】洞府內，霧氣繚繞。環境音效：低頻風聲穿過石壁的回響。'
    expect(countDialogueBeats(narrative)).toBe(0)
    expect(buildAudioDirective(0, true)).toMatch(/嚴禁/)
  })
})
