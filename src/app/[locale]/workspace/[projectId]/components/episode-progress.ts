/**
 * Phase 11.1: 純函式工具 — 計算劇集進度
 *
 * 純函式（無副作用 / 無 IO），方便測試與 server-side 呼叫。
 * 不可改 mutate 任何傳入物件，只回新物件。
 */

export interface EpisodeProgressInput {
  clips: ReadonlyArray<{ screenplay: string | null }>
  storyboards: ReadonlyArray<{
    panels: ReadonlyArray<{ imageUrl: string | null; videoUrl: string | null }>
  }>
}

export interface EpisodeProgress {
  scriptDone: number
  scriptTotal: number
  storyboardDone: number
  storyboardTotal: number
  videoDone: number
  videoTotal: number
}

function isNonEmptyString(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 計算劇集 3 個 stage 的 done/total。
 *
 * - scriptTotal = clips.length, scriptDone = clips with non-empty screenplay
 * - storyboardTotal = sum of all panels across storyboards
 * - storyboardDone = panels with non-empty imageUrl
 * - videoTotal = same as storyboardTotal
 * - videoDone = panels with non-empty videoUrl
 */
export function computeEpisodeProgress(input: EpisodeProgressInput): EpisodeProgress {
  const scriptTotal = input.clips.length
  const scriptDone = input.clips.reduce(
    (count, clip) => (isNonEmptyString(clip.screenplay) ? count + 1 : count),
    0,
  )

  let panelTotal = 0
  let imageDone = 0
  let videoDone = 0

  for (const storyboard of input.storyboards) {
    for (const panel of storyboard.panels) {
      panelTotal += 1
      if (isNonEmptyString(panel.imageUrl)) imageDone += 1
      if (isNonEmptyString(panel.videoUrl)) videoDone += 1
    }
  }

  return {
    scriptDone,
    scriptTotal,
    storyboardDone: imageDone,
    storyboardTotal: panelTotal,
    videoDone,
    videoTotal: panelTotal,
  }
}
