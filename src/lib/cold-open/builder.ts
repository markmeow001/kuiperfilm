/**
 * Cold-open shot block builder.
 *
 * Pure function: takes panels + variant + style tags, returns the
 * 4-shot text block ready to be concatenated with the existing
 * STYLE_HEADER / OVERALL / reference-header sections in GroupCard.
 *
 * Mechanical reformat only — Phase 1 does NOT understand semantic
 * content. Reformat callbacks (in templates.ts) wrap the raw panel
 * description with a variant-appropriate cinematic intent. Phase 2
 * will replace this with an LLM Shot Director.
 */

import {
  COLD_OPEN_PANEL_COUNT,
  COLD_OPEN_SHOT_DURATION_SECONDS,
  type ColdOpenBuildOptions,
  type ColdOpenPanel,
} from './types'
import { getColdOpenTemplate } from './templates'

function extractPanelCharNames(panel: ColdOpenPanel): string[] {
  const out: string[] = []
  const raw: unknown[] = Array.isArray(panel.characters) ? panel.characters : []
  const seen = new Set<string>()
  for (const item of raw) {
    let name: string | null = null
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed) as { name?: unknown }
          if (typeof parsed.name === 'string') name = parsed.name
        } catch {
          name = trimmed
        }
      } else {
        name = trimmed
      }
    } else if (item && typeof item === 'object') {
      const r = item as { name?: unknown }
      if (typeof r.name === 'string') name = r.name
    }
    if (!name) continue
    const cleaned = name.trim()
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  return out
}

function pickFirstDialogueLine(panels: ColdOpenPanel[]): string | null {
  for (const p of panels) {
    const lines = Array.isArray(p.voiceLines) ? p.voiceLines : []
    if (lines.length > 0) {
      const v = lines[0]
      return v.isVoiceover
        ? `Voiceover (off-camera, lips do not move) — ${v.speaker}: "${v.content}"`
        : `${v.speaker}: "${v.content}"`
    }
    const srt = (p.srtSegment ?? '').trim()
    if (srt) return srt
  }
  return null
}

function pickFirstVoiceoverLine(panels: ColdOpenPanel[]): string | null {
  for (const p of panels) {
    const lines = Array.isArray(p.voiceLines) ? p.voiceLines : []
    const vo = lines.find((v) => v.isVoiceover)
    if (vo) return `Voiceover (off-camera, lips do not move) — ${vo.speaker}: "${vo.content}"`
  }
  for (const p of panels) {
    const lines = Array.isArray(p.voiceLines) ? p.voiceLines : []
    const any = lines[0]
    if (any) return `Voiceover (off-camera, lips do not move) — ${any.speaker}: "${any.content}"`
  }
  return null
}

/**
 * Pad / trim panels to exactly 4 slots. Cold-open is a fixed-shape
 * formula — we honor it strictly even when the group has 2/3/5/6
 * panels.
 *
 * Strategy:
 *   - 0 panels: return empty (caller bails out)
 *   - 1-3 panels: repeat the last panel to reach 4
 *   - 4 panels: pass through
 *   - 5+ panels: keep first 3 + last (preserves climax)
 */
export function fitPanelsToFourSlots(panels: ColdOpenPanel[]): ColdOpenPanel[] {
  if (panels.length === 0) return []
  if (panels.length === COLD_OPEN_PANEL_COUNT) return panels
  if (panels.length > COLD_OPEN_PANEL_COUNT) {
    return [...panels.slice(0, COLD_OPEN_PANEL_COUNT - 1), panels[panels.length - 1]]
  }
  const out = [...panels]
  while (out.length < COLD_OPEN_PANEL_COUNT) out.push(panels[panels.length - 1])
  return out
}

/**
 * Build the 4-shot cold-open narrative block.
 *
 * Returned text starts with the variant hookHeader and contains four
 * `镜头N（X-Y seconds）·<framing>` blocks. Caller prepends the
 * STYLE_HEADER / OVERALL / reference-header sections.
 *
 * @returns the multi-line shot block, or empty string when no panels.
 */
export function buildColdOpenShotBlock(opts: ColdOpenBuildOptions): string {
  const fitted = fitPanelsToFourSlots(opts.panels)
  if (fitted.length === 0) return ''

  const template = getColdOpenTemplate(opts.variant)
  const firstDialogue = pickFirstDialogueLine(opts.panels)
  const voiceOverLine = pickFirstVoiceoverLine(opts.panels) ?? firstDialogue

  const sections: string[] = []
  sections.push(template.hookHeader)

  for (let i = 0; i < COLD_OPEN_PANEL_COUNT; i++) {
    const shotTemplate = template.shotDescriptors[i]
    const panel = fitted[i]
    const desc = (panel.description ?? '').trim()
    const start = i * COLD_OPEN_SHOT_DURATION_SECONDS
    const end = (i + 1) * COLD_OPEN_SHOT_DURATION_SECONDS

    const blockLines: string[] = []
    blockLines.push(
      `镜头${i + 1}（${start}-${end} seconds）·${shotTemplate.framing} ${opts.perShotTag}`,
    )

    const cast = extractPanelCharNames(panel)
    const sceneRaw = (panel.location ?? '').trim()
    const scene = sceneRaw.includes('#')
      ? sceneRaw.slice(0, sceneRaw.indexOf('#')).trim()
      : sceneRaw
    const bindingFragments: string[] = []
    if (cast.length > 0) bindingFragments.push(`Cast: ${cast.join('、')}`)
    if (scene) bindingFragments.push(`Scene: ${scene}`)
    if (bindingFragments.length > 0) {
      blockLines.push(`[${bindingFragments.join('] [')}]`)
    }

    blockLines.push(shotTemplate.reformat(desc))

    if (i === 2 && firstDialogue) {
      blockLines.push(firstDialogue)
    }
    if (i === 3 && voiceOverLine) {
      blockLines.push(voiceOverLine)
    }

    blockLines.push(`Camera: ${shotTemplate.cameraMove}`)
    blockLines.push(opts.antiTextLine)
    if (shotTemplate.isStunnedFace) {
      for (const extra of template.pushInAntiLines) {
        blockLines.push(extra)
      }
    }

    sections.push(blockLines.join('\n'))
  }

  return sections.join('\n\n')
}
