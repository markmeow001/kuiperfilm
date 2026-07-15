import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('DirectorStage AI blocking view', () => {
  it('keeps the free director view after applying an AI blocking draft', () => {
    const source = readFileSync(
      'src/app/[locale]/canvas/director/DirectorStage.tsx',
      'utf8',
    )
    const start = source.indexOf('const applyBlockingDraft')
    const end = source.indexOf('const undoBlocking', start)
    const applyBlockingDraft = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(applyBlockingDraft).toContain("setView('director')")
    expect(applyBlockingDraft).not.toContain("setView('shot')")
    expect(applyBlockingDraft).toContain('可自由调整')
  })
})
