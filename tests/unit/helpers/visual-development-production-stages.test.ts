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
    expect(result.prompt).toContain('Reference image 1 is the locked Face ID')
    expect(result.prompt).toContain('Reference image 2 is the approved upstream design asset')
    expect(result.prompt).toContain('Preserve all upstream Canon decisions')
    expect(result.prompt).toContain('Immutable screenplay-derived stage baseline')
    expect(result.prompt).toContain('Reduce decorative trim')
    expect(result.promptStack.stageTemplate).toBe('CADS_PHASE_04_COSTUME_V1')
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
