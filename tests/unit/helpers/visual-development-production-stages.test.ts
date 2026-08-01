import { describe, expect, it } from 'vitest'
import { buildProductionStagePrompt } from '@/lib/visual-development/production-prompt'
import { canEnterProductionStage, getProductionStage, PRODUCTION_STAGE_DEFINITIONS } from '@/lib/visual-development/production-stages'
import { parseProductionStageBriefModelOutput } from '@/lib/visual-development/stage-brief'

describe('visual development production stages', () => {
  it('defines a continuous Phase 4 through Phase 13 Canon chain', () => {
    expect(PRODUCTION_STAGE_DEFINITIONS.map((stage) => stage.phase)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(getProductionStage('costume').prerequisiteStatus).toBe('hair_locked')
    expect(getProductionStage('video').prerequisiteStatus).toBe('integration_locked')
    expect(getProductionStage('video').mediaType).toBe('video')
    expect(getProductionStage('expression').referenceSources).toEqual([
      expect.objectContaining({ source: 'face', candidateCode: 'EXPR-RESTRAINED' }),
      expect.objectContaining({ source: 'accessory', candidateCode: 'PROP-WORN' }),
    ])
    expect(getProductionStage('turnaround').referenceSources[1]).toEqual(
      expect.objectContaining({ source: 'accessory', candidateCode: 'PROP-WORN' }),
    )
    expect(getProductionStage('video').referenceSources).toEqual([
      expect.objectContaining({ source: 'integration' }),
    ])
  })

  it('does not open a stage before its upstream Canon, but permits controlled regeneration later', () => {
    expect(canEnterProductionStage('hair_locked', 'costume')).toBe(true)
    expect(canEnterProductionStage('hair_locked', 'accessory')).toBe(false)
    expect(canEnterProductionStage('ability_locked', 'costume')).toBe(true)
    expect(canEnterProductionStage('integration_locked', 'video')).toBe(true)
  })

  it('keeps identity and upstream design reference responsibilities explicit', () => {
    const stage = getProductionStage('costume')
    const result = buildProductionStagePrompt({
      stage,
      variant: stage.variants[0]!,
      characterCode: 'CHR-SNO',
      worldBible: { visualThesis: 'sacred order hides predation' },
      characterDna: { role: 'protagonist', coreTraits: 'guarded' },
      stageRecord: { silhouetteSystem: 'tower silhouette', materialConstruction: 'worn wool', storyWear: 'soot and repairs' },
      stageBrief: {
        version: 1,
        stageId: 'costume',
        characterCode: 'CHR-SNO',
        modelKey: 'openrouter::gemini',
        createdAt: '2026-07-30T00:00:00.000Z',
        sourceAnalysisId: 'analysis-1',
        summary: 'A guarded fugitive whose clothing protects movement and preserves class history.',
        fields: {
          silhouetteSystem: 'tower silhouette',
          materialConstruction: 'worn wool',
          storyWear: 'soot and repairs',
        },
        evidence: ['The character escapes through industrial tunnels.'],
        constraints: ['Do not alter locked identity or hair.'],
      },
      creativePrompt: 'Reduce decorative trim and emphasize repaired seams.',
    })
    expect(result.prompt).toContain('Reference image 1 is the locked Face ID and identity only')
    expect(result.prompt).toContain('Reference image 2 is the locked Hair ID')
    expect(result.prompt).toContain('one uninterrupted photorealistic live-action costume reference')
    expect(result.prompt).toContain('Preserve all upstream Canon decisions')
    expect(result.prompt).toContain('Immutable screenplay-derived stage baseline')
    expect(result.prompt).toContain('Reduce decorative trim')
    expect(result.promptStack.stageTemplate).toBe('CADS_PHASE_04_COSTUME_V1')
    expect(result.negativePrompt).toContain('costume concept sketch')
    expect(result.negativePrompt).not.toContain('changed locked costume')
  })

  it('inlines exclusions when the selected image model has no negative-prompt channel', () => {
    const stage = getProductionStage('expression')
    const result = buildProductionStagePrompt({
      stage,
      variant: stage.variants[0]!,
      characterCode: 'CHR-SNO',
      worldBible: {},
      characterDna: {},
      stageRecord: Object.fromEntries(stage.fields.map((field) => [field, `locked ${field}`])),
      stageBrief: {
        version: 1,
        stageId: stage.id,
        characterCode: 'CHR-SNO',
        modelKey: 'openrouter::gemini',
        createdAt: '2026-07-30T00:00:00.000Z',
        sourceAnalysisId: 'analysis-1',
        summary: 'Restrained performance.',
        fields: Object.fromEntries(stage.fields.map((field) => [field, `locked ${field}`])),
        evidence: [],
        constraints: [],
      },
      creativePrompt: '',
      inlineNegativeConstraints: true,
    })
    expect(result.prompt).toContain('no separate negative-prompt channel')
    expect(result.prompt).toContain('generic sad stare')
    expect(result.prompt).toContain('Do not render any excluded item')
  })

  it('assigns a phase-specific physical output contract to every production stage', () => {
    for (const stage of PRODUCTION_STAGE_DEFINITIONS) {
      expect(stage.referenceSources.length).toBeGreaterThan(0)
      expect(stage.outputRule).toMatch(/one /i)
      expect(stage.negativeTerms.length).toBeGreaterThan(0)
    }
    expect(getProductionStage('expression').outputRule).toContain('entire head')
    expect(getProductionStage('turnaround').outputRule).toContain('crown to soles')
    expect(getProductionStage('evolution').negativeTerms).toContain('unmotivated dirt')
  })

  it('references only real candidate codes from completed upstream production stages', () => {
    for (const stage of PRODUCTION_STAGE_DEFINITIONS) {
      for (const reference of stage.referenceSources) {
        if (reference.source === 'face' || reference.source === 'hair' || !reference.candidateCode) continue
        const upstream = getProductionStage(reference.source)
        expect(upstream.phase).toBeLessThan(stage.phase)
        expect(upstream.variants.map((variant) => variant.code)).toContain(reference.candidateCode)
      }
    }
  })

  it('validates a screenplay baseline against the distinct fields of every Phase 4–13 stage', () => {
    for (const stage of PRODUCTION_STAGE_DEFINITIONS) {
      const fields = Object.fromEntries(stage.fields.map((field) => [field, `${stage.id}:${field}`]))
      const brief = parseProductionStageBriefModelOutput({
        text: JSON.stringify({
          summary: `${stage.id} screenplay baseline`,
          fields,
          evidence: [`${stage.id} evidence`],
          constraints: [`${stage.id} constraint`],
        }),
        stage,
        characterCode: 'CHR-SNO',
        modelKey: 'openrouter::gemini',
        createdAt: '2026-07-30T00:00:00.000Z',
        sourceAnalysisId: 'analysis-1',
      })

      expect(brief.stageId).toBe(stage.id)
      expect(Object.keys(brief.fields).sort()).toEqual([...stage.fields].sort())
    }
  })
})
