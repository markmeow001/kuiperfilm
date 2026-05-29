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

/** Counts how many times the handler spreads characterOverrides into a
 *  dispatch call. There are 5 vendor paths (seedance/ark/atlascloud/fal/
 *  b-path); every one must receive it. */
function countOverrideSpreads(src: string): number {
  return (src.match(/characterOverrides && characterOverrides\.length > 0 \? \{ characterOverrides \}/g) || []).length
}

describe('multi-shot handler forwards characterOverrides to ALL vendor paths (2026-05-28 regression)', () => {
  it('handler spreads characterOverrides into all 5 dispatch sites', () => {
    // seedance + ark + atlascloud + fal + b-path = 5. Before the fix this
    // was 3 (atlascloud + fal were missing) and the swap-costume override
    // never reached those two providers.
    expect(countOverrideSpreads(handler)).toBe(5)
  })

  it('handler spreads locationOverrides into atlascloud + fal too (parity)', () => {
    // seedance/ark/b-path already passed locationOverrides; atlascloud +
    // fal were the two gaps. 5 total once wired.
    const count = (handler.match(/locationOverrides && locationOverrides\.length > 0 \? \{ locationOverrides \}/g) || []).length
    expect(count).toBe(5)
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
