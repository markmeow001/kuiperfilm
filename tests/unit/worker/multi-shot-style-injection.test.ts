/**
 * Regression for Phase I (2026-05-20) — three multi-shot worker paths
 * must inject visual style anchors (styleAnchor + visualModifiers +
 * negativePrompt) when a project's visualStyleId is set.
 *
 * Pre-Phase-I status:
 *   - Kling B-path:      ✅ used buildVisualStylePrefix/Suffix/Negative
 *   - BobAPI seedance:   ❌ used Negative only; positive prompt skipped
 *                           styleAnchor + visualModifiers → all BobAPI
 *                           composite videos drifted toward the model's
 *                           training-set average regardless of project
 *                           style (e.g. 院線寫實 never reached the model
 *                           on the positive side)
 *   - AtlasCloud:        ❌ NONE — completely skipped style; explained
 *                           user-reported "CG感" complaint when running
 *                           Seedance 2.0 t2v on AtlasCloud
 *
 * This test pins the contract that ALL three paths now use the same
 * style-library helpers, so future refactors can't silently regress.
 * It's a code-shape test (grep-style) rather than a behavioral test:
 * the worker handlers are heavy to mock, but we can guarantee the
 * imports + helper invocations stay in place.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')

function readWorkerFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

describe('multi-shot worker paths use style-library helpers (Phase I)', () => {
  const klingBPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-b-path.ts')
  const bobapiPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-seedance-path.ts')
  const atlascloudPath = readWorkerFile('src/lib/workers/handlers/multi-shot-video-atlascloud-path.ts')

  it('Kling B-path imports + uses prefix/suffix/negative helpers', () => {
    expect(klingBPath).toMatch(/buildVisualStylePrefix/)
    expect(klingBPath).toMatch(/buildVisualStyleSuffix/)
    expect(klingBPath).toMatch(/buildVisualStyleNegative|resolveProjectVisualStyle/)
  })

  it('BobAPI seedance-path imports + uses prefix/suffix/negative helpers', () => {
    expect(bobapiPath).toMatch(/buildVisualStylePrefix/)
    expect(bobapiPath).toMatch(/buildVisualStyleSuffix/)
    expect(bobapiPath).toMatch(/buildVisualStyleNegative/)
    expect(bobapiPath).toMatch(/resolveProjectVisualStyle/)
  })

  it('AtlasCloud composite path imports + uses prefix/suffix/negative helpers', () => {
    expect(atlascloudPath).toMatch(/buildVisualStylePrefix/)
    expect(atlascloudPath).toMatch(/buildVisualStyleSuffix/)
    expect(atlascloudPath).toMatch(/buildVisualStyleNegative/)
    expect(atlascloudPath).toMatch(/resolveProjectVisualStyle/)
  })

  it('AtlasCloud path inlines AVOID:<negative> in the prompt (no native negative_prompt body field)', () => {
    // AtlasCloud Seedance 2.0 OpenAPI has no negative_prompt field; the
    // worker must inline the curated negative list as a text marker the
    // model parses. Without this the on-screen-text + CG-feel artifacts
    // come back. The marker is literal "AVOID:" so a future refactor
    // that swaps it (e.g. to "Negative prompt:") trips the regression.
    expect(atlascloudPath).toMatch(/AVOID:\s*\$\{composedNegative\}|AVOID: /)
  })

  it('BobAPI path wraps prompt with stylePrefix + suffix before sending to generator', () => {
    // Verifies the stylizedPrompt = [prefix, prompt, suffix] composition
    // is wired into the generator call. The literal `stylizedPrompt`
    // identifier in the generator.generate({prompt: …}) site is the
    // load-bearing piece — flipping back to `prompt` skips style.
    expect(bobapiPath).toMatch(/stylizedPrompt/)
    expect(bobapiPath).toMatch(/prompt:\s*stylizedPrompt/)
  })

  it('AtlasCloud path uses POSITIVE clean-frame directive (NOT inline AVOID with 字幕 keyword)', () => {
    // Phase R-1 (2026-05-22) — switched from "AVOID: 字幕..." inline
    // negative to positive aspirational phrasing. The previous AVOID
    // approach occasionally caused Seedance to RENDER the AVOID list
    // itself as on-screen text (pink-elephant failure: mentioning 字幕
    // primes the model to paint subtitles).
    //
    // New directive must:
    //   1. Describe the desired clean state positively (純電影/cinematic frame)
    //   2. NOT mention 字幕 / subtitles / watermark as bare keywords in
    //      an AVOID list — must wrap them in positive phrasing.
    //   3. Mention 浮水印 / logo / UI / text overlay (so the model knows
    //      what to omit, but framed as "the frame is clean of X").
    expect(atlascloudPath).toMatch(/CLEAN_FRAME_DIRECTIVE/)
    expect(atlascloudPath).toMatch(/純電影級實拍|無任何文字疊加/)
    // The legacy "AVOID: ${composedNegative}.`" string template must
    // NOT be present in the prompt assembly anymore. Style-library's
    // negativePrompt does ship in a separate styleNegativeFragment but
    // never as the bare "AVOID:" inline form.
    expect(atlascloudPath).not.toMatch(/AVOID: \$\{composedNegative\}/)
  })

  it('AtlasCloud describe...ForPrompt helpers branch on ModeKey (Phase L)', () => {
    // r2v MUST return empty so ref-map + reference_images carry identity;
    // a regression that flips r2v to inline full descriptions risks
    // text/image contradiction (catalog 黑髮 vs ref image 棕髮 etc.)
    // and crowds out the camera language we're trying to fit in.
    expect(atlascloudPath).toMatch(/if \(mode === 'r2v'\) return ''/)
    // i2v gets a short blurb (1 sentence, ≤80 chars)
    expect(atlascloudPath).toMatch(/mode === 'i2v' \? shortBlurb/)
    // shortBlurb helper exists
    expect(atlascloudPath).toMatch(/function shortBlurb/)
  })

  it('AtlasCloud buildAtlasCloudPrompt skips anchor lines entirely for r2v (Phase L)', () => {
    // The ref-map is the identity hook for r2v; emitting redundant
    // anchorLines like "角色「Karrug」：..." would either duplicate
    // (if description present) or just repeat the name (if absent),
    // both bloat the prompt without anchoring value.
    expect(atlascloudPath).toMatch(/if \(mode !== 'r2v'\)/)
  })
})
