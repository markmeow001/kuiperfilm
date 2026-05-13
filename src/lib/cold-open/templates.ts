/**
 * 4-shot × 2-second cold-open templates per genre variant.
 *
 * Each template encodes:
 *   - hookHeader: the segment-level intent line that orients Kling on
 *     "this is a hook, not a beat"
 *   - shotDescriptors[0..3]: per-shot framing label, camera move (EN),
 *     and a reformat() callback that wraps the panel.description with
 *     the variant-appropriate cinematic intent
 *   - pushInAntiLines: extra negative cues attached to shot 4 to
 *     suppress horror-movie grimace + variant-specific failure modes
 *
 * Hard rules across all three variants (per design doc §3.3):
 *   - 4 shots × 2s exact (no dialogue-driven stretching)
 *   - 2 character cap (Kling identity confusion mitigation)
 *   - Single grounded scene (no cuts to crowds / wide vistas)
 *   - 1 voice-over reveal in shot 4
 *   - Shot 4 = slow push-in (Kling's most stable camera motion)
 */

import type { ColdOpenVariant } from './types'

interface ShotTemplate {
  framing: string
  cameraMove: string
  reformat: (desc: string) => string
  isStunnedFace: boolean
}

interface VariantTemplate {
  hookHeader: string
  shotDescriptors: readonly [ShotTemplate, ShotTemplate, ShotTemplate, ShotTemplate]
  pushInAntiLines: readonly string[]
}

const MODERN: VariantTemplate = {
  hookHeader:
    'HOOK: 8-second cold open, 4 shots × 2 seconds, modern drama ReelShort vertical format. Two characters, single indoor scene, one voice-over reveal in shot 4, slow push-in to a stunned reaction.',
  pushInAntiLines: [
    'STRICT: not a horror movie, not exaggerated grimace, not theatrical gasp. Subtle believable shock — eyes widen, breath caught, micro-pause.',
  ],
  shotDescriptors: [
    {
      framing: 'Wide establishing — modern interior',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Wide establishing shot of the modern indoor environment, composed and quiet. ${desc}`
          : 'Wide establishing shot of the modern indoor environment, composed and quiet.',
      isStunnedFace: false,
    },
    {
      framing: 'Medium — protagonist intro',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Medium shot of the protagonist in routine motion within the same environment. ${desc}`
          : 'Medium shot of the protagonist in routine motion within the same environment.',
      isStunnedFace: false,
    },
    {
      framing: 'Over-the-shoulder — dialogue beat',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Over-the-shoulder shot, second character entering frame from behind, dialogue beat begins. ${desc}`
          : 'Over-the-shoulder shot, second character entering frame from behind, dialogue beat begins.',
      isStunnedFace: false,
    },
    {
      framing: 'Slow push-in to STUNNED FACE',
      cameraMove: 'slow push in',
      reformat: (desc) =>
        desc
          ? `Slow push-in to the protagonist's face as the reveal lands. Eyes widen, breath catches. ${desc}`
          : "Slow push-in to the protagonist's face as the reveal lands. Eyes widen, breath catches.",
      isStunnedFace: true,
    },
  ],
}

const PERIOD: VariantTemplate = {
  hookHeader:
    'HOOK: 8-second cold open, 4 shots × 2 seconds, period / cultivation drama format. Two characters, single grounded location (chamber, hall, or mountain peak), one voice-over reveal in shot 4, slow push-in to a determined / awakened reaction.',
  pushInAntiLines: [
    'STRICT: not a horror grimace, not floating CG glow, not magical particle storm. Subtle steel — eyes set, jaw firms, robe hem still.',
  ],
  shotDescriptors: [
    {
      framing: 'Wide establishing — grounded period setting',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Wide establishing shot of the period environment, composed and quiet, no floating particles. ${desc}`
          : 'Wide establishing shot of the period environment, composed and quiet, no floating particles.',
      isStunnedFace: false,
    },
    {
      framing: 'Medium — protagonist reveal',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Medium shot of the protagonist standing within the location, robe hem subtly drifting. ${desc}`
          : 'Medium shot of the protagonist standing within the location, robe hem subtly drifting.',
      isStunnedFace: false,
    },
    {
      framing: 'Over-the-shoulder — confrontation beat',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Over-the-shoulder shot, the second character delivers the conflicting line. ${desc}`
          : 'Over-the-shoulder shot, the second character delivers the conflicting line.',
      isStunnedFace: false,
    },
    {
      framing: 'Slow push-in to DETERMINED FACE',
      cameraMove: 'slow push in',
      reformat: (desc) =>
        desc
          ? `Slow push-in to the protagonist's face as resolve crystallizes. Eyes set, jaw firm, breath measured. ${desc}`
          : "Slow push-in to the protagonist's face as resolve crystallizes. Eyes set, jaw firm, breath measured.",
      isStunnedFace: true,
    },
  ],
}

const ACTION: VariantTemplate = {
  hookHeader:
    'HOOK: 8-second cold open, 4 shots × 2 seconds, action / disaster reveal format. One protagonist plus one threat or antagonist, single location, one voice-over reveal in shot 4, slow push-in to a shocked reaction.',
  pushInAntiLines: [
    'STRICT: not a horror grimace, not whip-pan blur, not lens flare overload. Sharp focus on protagonist face — eyes widen, brow tightens.',
  ],
  shotDescriptors: [
    {
      framing: 'Wide establishing — disaster environment',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Wide establishing shot of the threatened environment, atmosphere heavy with foreboding. ${desc}`
          : 'Wide establishing shot of the threatened environment, atmosphere heavy with foreboding.',
      isStunnedFace: false,
    },
    {
      framing: 'Medium action — protagonist mid-motion',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Medium shot of the protagonist mid-action — drawing weapon, bracing stance, or raising hand. ${desc}`
          : 'Medium shot of the protagonist mid-action — drawing weapon, bracing stance, or raising hand.',
      isStunnedFace: false,
    },
    {
      framing: 'Reveal — threat enters frame',
      cameraMove: 'static shot',
      reformat: (desc) =>
        desc
          ? `Cut to the threat or antagonist entering frame, the danger made visible. ${desc}`
          : 'Cut to the threat or antagonist entering frame, the danger made visible.',
      isStunnedFace: false,
    },
    {
      framing: 'Slow push-in to SHOCKED FACE',
      cameraMove: 'slow push in',
      reformat: (desc) =>
        desc
          ? `Slow push-in to the protagonist's face, eyes widen as the scale of the threat lands. ${desc}`
          : "Slow push-in to the protagonist's face, eyes widen as the scale of the threat lands.",
      isStunnedFace: true,
    },
  ],
}

export function getColdOpenTemplate(variant: ColdOpenVariant): VariantTemplate {
  switch (variant) {
    case 'period':
      return PERIOD
    case 'action':
      return ACTION
    case 'modern':
    default:
      return MODERN
  }
}
