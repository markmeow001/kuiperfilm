import { describe, expect, it } from 'vitest'
import {
  appendCandidateGenerationHistory,
  collectCandidateHistoryTaskIds,
  readCandidateGenerationHistory,
  type CandidateGenerationSnapshot,
} from '@/lib/visual-development/candidate-history'

function snapshot(taskId: string, prompt: string): CandidateGenerationSnapshot {
  return {
    taskId,
    prompt,
    negativePrompt: null,
    requestedSeed: 123,
    effectiveSeed: 123,
    seedStatus: 'applied',
    modelKey: 'atlascloud::flux-2-pro',
    provider: 'atlascloud',
    modelId: 'flux-2-pro',
    modelVersion: null,
    aspectRatio: '3:4',
    resolution: null,
    shortlisted: false,
    isCanon: false,
    rejectionNote: null,
    createdAt: '2026-07-30T00:00:00.000Z',
  }
}

describe('visual development candidate generation history', () => {
  it('preserves the prompt stack while appending immutable slot revisions', () => {
    const first = appendCandidateGenerationHistory(
      { stageId: 'costume', referenceImages: ['face.png', 'hair.png'] },
      'candidate-1',
      snapshot('task-1', 'original prompt'),
    )
    const second = appendCandidateGenerationHistory(
      first,
      'candidate-1',
      snapshot('task-2', 'edited prompt'),
    )

    expect(second.stageId).toBe('costume')
    expect(second.referenceImages).toEqual(['face.png', 'hair.png'])
    expect(readCandidateGenerationHistory(second, 'candidate-1').map((entry) => entry.prompt)).toEqual([
      'original prompt',
      'edited prompt',
    ])
    expect(collectCandidateHistoryTaskIds([second])).toEqual(['task-1', 'task-2'])
  })

  it('ignores malformed history records instead of exposing partial revisions', () => {
    expect(readCandidateGenerationHistory({
      candidateGenerationHistory: {
        byCandidate: { 'candidate-1': [{ taskId: 'task-1' }] },
      },
    }, 'candidate-1')).toEqual([])
  })
})
