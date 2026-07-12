/**
 * Playground video worker — reference-image list dispatch rule
 * (2026-07-12 review HIGH-A).
 *
 * AtlasCloud seedance r2v and fal seedance r2v consume the FULL ordered
 * list via referenceImages and never merge the imageUrl arg back in, so
 * the old unconditional slice(1) silently dropped the user's first upload
 * AND shifted the 參考圖對應 name map by one. taijiai/BobAPI re-adds
 * imageUrl as slot 1 and must keep the lead-split.
 *
 * Code-shape test (the handler's BullMQ/prisma/COS deps are infeasible to
 * mock in a unit suite — same convention as multi-shot-atlascloud-duration).
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../src/lib/workers/handlers/playground-video.ts'),
  'utf8',
)

describe('playground-video reference list dispatch', () => {
  it('full-list rule covers atlascloud AND fal model keys', () => {
    expect(SRC).toMatch(/passFullImageList = \/\^\(atlascloud\|fal\)::\//)
  })

  it('full-list vendors get the WHOLE signedImageUrls (no slice)', () => {
    expect(SRC).toMatch(/passFullImageList\s*\n?\s*\? \(signedImageUrls\.length > 0\s*\n?\s*\? \{ referenceImages: signedImageUrls as unknown as string \}/)
  })

  it('other vendors keep the lead-split slice(1)', () => {
    expect(SRC).toMatch(/signedImageUrls\.slice\(1\) as unknown as string/)
  })

  it('the 參考圖對應 map is built from the full upload-ordered names array', () => {
    // Names index against upload order; correctness depends on full-list
    // vendors receiving the same order (locked above).
    expect(SRC).toMatch(/buildRefImageMapSection\(refImageNames\)/)
  })
})
