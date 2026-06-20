/**
 * Phase 1 step 3 — pure, closure-independent pieces hoisted out of
 * GroupCard.tsx (same convention as storyboard-client-helpers.ts).
 *
 * Holds the time-range formatter and the per-group reference-video cluster
 * (size/duration gates, the props type, and the client-side duration probe).
 * Nothing here touches component state / closures / hooks, so the relocation
 * is fully verified by tsc with zero behaviour change.
 */

export function formatTimeRange(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
  return `${fmt(startSec)}-${fmt(endSec)}`
}

/**
 * Phase S (2026-05-27) — per-group motion / camera reference video.
 *
 * UI states:
 *   - Empty: a single "＋動作參考視頻" button. Click opens file picker.
 *   - Validating: client-side duration probe via HTML5 video.duration.
 *     Rejects > 15s before hitting the server. MIME/size also checked
 *     against the server's gate (50MB / mp4|mov|webm).
 *   - Uploaded: small preview thumbnail (<video> 60×60) + "× 移除" button.
 *
 * Why client-side duration probe: the server endpoint deliberately skips
 * ffprobe to keep deploy simple. Internal team threat model makes the
 * bypass acceptable; if a hostile user submits a 30s clip via curl, the
 * worker just sends a long reference to the model — costs a bit more
 * generation time but doesn't break anything.
 */
export const MAX_VIDEO_DURATION_SEC = 15
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024
export const ALLOWED_MIMES_DISPLAY = 'mp4 / mov / webm'

export interface GroupReferenceVideoSlotProps {
  projectId: string
  storyboardId: string
  episodeId: string
  referenceVideoUrl: string | null
}

export function probeVideoDuration(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => {
      const d = v.duration
      URL.revokeObjectURL(url)
      Number.isFinite(d) ? resolve(d) : reject(new Error('Could not read video duration'))
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video for duration probe'))
    }
    v.src = url
  })
}
