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
import { buildAudioDirective } from '@/lib/workers/handlers/multi-shot-audio-directive'

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
