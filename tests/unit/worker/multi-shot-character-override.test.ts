/**
 * Regression for 2026-05-28 — per-call character appearance overrides
 * ("swap costume" from the bindings rail) must reach EVERY multi-shot
 * vendor path, and each path must merge the override so it wins over the
 * episode binding.
 *
 * The bug: user switched William De Ville to his 半裸覆蓋紋身 appearance in
 * the bindings rail, but the generated video kept rendering the default
 * full-suit appearance. Two independent holes caused it:
 *
 *   1. multi-shot-video-handler.ts dispatched to the AtlasCloud and fal
 *      paths WITHOUT spreading `characterOverrides` (seedance / ark /
 *      b-path did). A prior fix (f7f463e) added the receiving param +
 *      merge to atlascloud-path but the handler never sent it → dead code.
 *   2. fal-path had no `characterOverrides` param at all, and both fal +
 *      atlascloud hardcoded an empty `locOverrideById` so location view
 *      overrides were silently dropped too.
 *
 * This is a code-shape (grep-style) test mirroring multi-shot-style-
 * injection.test.ts — the worker handlers are heavy to mock, but the
 * load-bearing wiring (handler spreads + path param + merge loops) can be
 * pinned so a future refactor can't silently regress the override.
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

describe('multi-shot handler forwards characterOverrides to ALL vendor paths (2026-05-28 regression)', () => {
  // Phase 1.5C — the 4 Seedance-family paths (seedance/ark/atlascloud/fal)
  // now inherit overrides via the shared `seedanceFamilyParams` base built
  // once; b-path keeps its own spread. So the guard is: (a) the shared base
  // carries the overrides, (b) all 4 family dispatches spread that base, and
  // (c) b-path carries the overrides itself. Net effect = all 5 paths get
  // overrides, same as the original 5-literal-spread version.
  it('shared seedanceFamilyParams base carries characterOverrides + locationOverrides', () => {
    const base = handler.match(/const seedanceFamilyParams = \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(base).toMatch(/characterOverrides && characterOverrides\.length > 0 \? \{ characterOverrides \}/)
    expect(base).toMatch(/locationOverrides && locationOverrides\.length > 0 \? \{ locationOverrides \}/)
  })

  it('all 4 Seedance-family dispatches spread the shared base, and b-path carries overrides itself', () => {
    // 4 family dispatches inherit overrides via ...seedanceFamilyParams.
    expect(countFamilyBaseSpreads(handler)).toBe(4)
    // Two literal override spreads remain in the file: one in the shared
    // base, one in the b-path dispatch (separate param shape). The b-path
    // block must still carry them directly.
    expect(countSpreads(handler, 'characterOverrides')).toBe(2)
    expect(countSpreads(handler, 'locationOverrides')).toBe(2)
    const bPathBlock = handler.match(/runMultiShotBPath\(\{[\s\S]*?\n    \}\)/)?.[0] ?? ''
    expect(bPathBlock).toMatch(/characterOverrides && characterOverrides\.length > 0 \? \{ characterOverrides \}/)
    expect(bPathBlock).toMatch(/locationOverrides && locationOverrides\.length > 0 \? \{ locationOverrides \}/)
  })
})

describe('every vendor path accepts characterOverrides and merges it (override wins)', () => {
  const paths: Array<[string, string]> = [
    ['seedance', seedancePath],
    ['ark', arkPath],
    ['atlascloud', atlascloudPath],
    ['fal', falPath],
    ['b-path', bPath],
  ]

  for (const [name, src] of paths) {
    it(`${name}-path declares the characterOverrides param`, () => {
      expect(src).toMatch(/characterOverrides\?:\s*Array<\{\s*characterId: string; appearanceId\?: string\s*\}>/)
    })

    it(`${name}-path merges per-call appearance override (set wins over episode binding)`, () => {
      // The load-bearing loop: for (const o of ... characterOverrides ...)
      // { ... .set(o.characterId, o.appearanceId) }. Different paths name
      // the target map episodeBindings or charOverrideById — both end up
      // winning in collectCharacterRefs. We just pin that the override
      // appearanceId is written into a map keyed by characterId.
      expect(src).toMatch(/for \(const o of (params\.)?characterOverrides \?\? \[\]\)/)
      expect(src).toMatch(/\.set\(o\.characterId, o\.appearanceId\)/)
    })
  }
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
