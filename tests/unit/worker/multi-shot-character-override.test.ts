/**
 * Episode appearance is now authoritative. A per-call appearance override
 * may force-include a character in canonical resolution, but its appearanceId
 * must never reach a provider path or beat EpisodeCharacter.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')

function readWorkerFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

const handler = readWorkerFile('src/lib/workers/handlers/multi-shot-video-handler.ts')
const seedancePath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-seedance-path.ts')
const arkPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-ark-path.ts')
const atlascloudPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-atlascloud-path.ts')
const falPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-fal-path.ts')
const bPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-b-path.ts')
const sharedCollector = readWorkerFile('src/lib/workers/handlers/multi-shot-ref-collection.ts')

/** Counts how many times an override field is conditionally spread into a
 *  dispatch param object in the handler source. */
function countSpreads(src: string, field: string): number {
  const re = new RegExp(`${field} && ${field}\\.length > 0 \\? \\{ ${field} \\}`, 'g')
  return (src.match(re) || []).length
}

/** Counts dispatch sites that spread the shared Seedance-family base. */
function countFamilyBaseSpreads(src: string): number {
  return (src.match(/\.\.\.seedanceFamilyParams/g) || []).length
}

describe('multi-shot handler resolves character appearance once before dispatch', () => {
  it('passes overrides only to the canonical resolver and passes canonical projectData to family paths', () => {
    const canonicalBlock = handler.match(/canonicalizeEpisodeCharacterAppearances\(\{[\s\S]*?\n  \}\)/)?.[0] ?? ''
    const base = handler.match(/const seedanceFamilyParams = \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(canonicalBlock).toMatch(/characterOverrides/)
    expect(base).toMatch(/projectData/)
    expect(base).not.toMatch(/characterOverrides/)
    expect(base).toMatch(/locationOverrides && locationOverrides\.length > 0 \? \{ locationOverrides \}/)
  })

  it('all family paths and B path receive canonical projectData, never character appearance overrides', () => {
    expect(countFamilyBaseSpreads(handler)).toBe(4)
    expect(countSpreads(handler, 'characterOverrides')).toBe(0)
    expect(countSpreads(handler, 'locationOverrides')).toBe(2)
    const bPathBlock = handler.match(/runMultiShotBPath\(\{[\s\S]*?\n    \}\)/)?.[0] ?? ''
    expect(bPathBlock).toMatch(/projectData:/)
    expect(bPathBlock).not.toMatch(/characterOverrides/)
    expect(bPathBlock).toMatch(/locationOverrides && locationOverrides\.length > 0 \? \{ locationOverrides \}/)
  })
})

describe('every vendor path consumes only the canonical appearance roster', () => {
  const paths: Array<[string, string]> = [
    ['seedance', seedancePath],
    ['ark', arkPath],
    ['atlascloud', atlascloudPath],
    ['fal', falPath],
    ['b-path', bPath],
  ]

  for (const [name, src] of paths) {
    it(`${name}-path requires projectData and has no independent binding or character-override merge`, () => {
      expect(src).toMatch(/projectData:/)
      expect(src).not.toMatch(/characterOverrides\?:/)
      expect(src).not.toMatch(/episodeCharacter\.findMany/)
      expect(src).not.toMatch(/appearanceId:\s*\{\s*not:\s*null\s*\}/)
    })
  }

  it('shared collector ignores panel appearance hints and reads the canonical singleton', () => {
    expect(sharedCollector).toMatch(/const appearance = character\.appearances\?\.\[0\]/)
    expect(sharedCollector).not.toMatch(/changeReason.*ref\.appearance/)
    expect(sharedCollector).not.toMatch(/episodeBindings/)
  })
})

describe('atlascloud + fal honour per-call location overrides (no hardcoded empty map)', () => {
  it('atlascloud builds locOverrideById from params.locationOverrides', () => {
    expect(atlascloudPath).toMatch(/for \(const o of params\.locationOverrides \?\? \[\]\)/)
    expect(atlascloudPath).not.toMatch(/no per-call override surface yet/)
  })

  it('fal builds locOverrideById from params.locationOverrides', () => {
    expect(falPath).toMatch(/for \(const o of params\.locationOverrides \?\? \[\]\)/)
  })
})
