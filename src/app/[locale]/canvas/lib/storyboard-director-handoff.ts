import type { CanvasStoryboardShot } from './canvas-types'

const MAX_BLOCKING_BRIEF_CHARS = 800

export function buildStoryboardBlockingBrief(shots: CanvasStoryboardShot[]): string {
  return shots
    .map((shot) => {
      const framing = [shot.shotSize, shot.cameraMove].filter(Boolean).join(' / ')
      return `镜 ${shot.shotNumber}${framing ? `（${framing}）` : ''}：${shot.description.trim()}`
    })
    .join('\n')
    .slice(0, MAX_BLOCKING_BRIEF_CHARS)
}
