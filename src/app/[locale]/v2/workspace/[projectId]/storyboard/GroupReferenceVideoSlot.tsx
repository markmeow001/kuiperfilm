'use client'

/**
 * Phase 1 step 3 — per-group motion / camera reference video slot, hoisted
 * out of GroupCard.tsx. Prop-driven leaf component (props in, JSX out; only
 * its own upload/delete mutation hooks + refs), so the relocation is fully
 * tsc-verified with zero behaviour change. See groupcard-helpers.ts for the
 * size/duration gates and the client-side duration probe it relies on.
 */

import { useRef, type ChangeEvent } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  useUploadGroupReferenceVideo,
  useDeleteGroupReferenceVideo,
} from '@/lib/query/mutations/group-reference-video-mutations'
import {
  MAX_VIDEO_DURATION_SEC,
  MAX_VIDEO_SIZE_BYTES,
  ALLOWED_MIMES_DISPLAY,
  probeVideoDuration,
  type GroupReferenceVideoSlotProps,
} from './groupcard-helpers'

export function GroupReferenceVideoSlot({
  projectId,
  storyboardId,
  episodeId,
  referenceVideoUrl,
}: GroupReferenceVideoSlotProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const upload = useUploadGroupReferenceVideo(projectId)
  const remove = useDeleteGroupReferenceVideo(projectId)

  async function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    // Size gate (matches server) — faster feedback than waiting for network.
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      alert(`檔案 ${(file.size / 1024 / 1024).toFixed(1)} MB 超過 50 MB 上限`)
      return
    }
    // Duration gate (client-only).
    try {
      const dur = await probeVideoDuration(file)
      if (dur > MAX_VIDEO_DURATION_SEC + 0.5) {
        alert(`影片長度 ${dur.toFixed(1)}s 超過 ${MAX_VIDEO_DURATION_SEC}s 上限。請先剪短再上傳。`)
        return
      }
    } catch {
      // Duration unreadable → let the server take it; worst case it
      // works fine because we only enforce duration client-side.
    }

    upload.mutate(
      { storyboardId, file, episodeId },
      {
        onError: (err) => {
          alert(`上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  function handleRemove() {
    if (!window.confirm('確定要移除這個分鏡群的動作參考視頻?')) return
    remove.mutate(
      { storyboardId, episodeId },
      {
        onError: (err) => {
          alert(`移除失敗:${(err as Error)?.message ?? '未知錯誤'}`)
        },
      },
    )
  }

  const busy = upload.isPending || remove.isPending

  if (referenceVideoUrl) {
    return (
      <div
        className="flex items-center gap-2 whitespace-nowrap rounded-sm border border-violet-500/30 bg-violet-500/5 px-2 py-1"
        title={`動作參考視頻已綁定 — worker 會送進 R2V 模型 (≤${MAX_VIDEO_DURATION_SEC}s, ${ALLOWED_MIMES_DISPLAY})`}
      >
        <AppIcon name="play" className="h-3 w-3 text-violet-300" />
        <video
          src={referenceVideoUrl}
          controls
          muted
          playsInline
          preload="metadata"
          className="h-12 w-20 rounded-sm object-cover"
        />
        <span className="font-mono text-[11px] uppercase tracking-wider text-violet-300">
          動作參考
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          title="移除動作參考視頻"
          className="rounded-sm border border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-text-secondary transition-colors hover:border-rose-500/60 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {remove.isPending ? '移除中…' : '×'}
        </button>
      </div>
    )
  }

  return (
    <label
      className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider text-text-secondary"
      title={`上傳一段 ≤${MAX_VIDEO_DURATION_SEC}s 的動作 / 鏡頭參考視頻 (${ALLOWED_MIMES_DISPLAY}, ≤50MB)。所有 4 家 Seedance 都會把它送進 R2V endpoint。`}
    >
      <AppIcon name="upload" className="h-3 w-3" />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="rounded-sm border border-border-soft bg-raised px-2 py-0.5 font-mono text-[12px] text-text-secondary transition-colors hover:border-violet-500/60 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {upload.isPending ? '上傳中…' : '＋動作參考視頻'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handlePick}
      />
    </label>
  )
}
