'use client'

/**
 * Live Composite — save/open orchestration for project persistence.
 *
 * Save: upload locally-picked video/background (playground-ref namespace,
 * via the shared upload hook), rasterize each keyframe's AI base mask to a
 * PNG upload (cached per raster so re-saves don't re-upload), then POST /
 * PATCH the project with the vector timeline JSON.
 *
 * Open: GET detail → download + decode every base-mask PNG → rebuild the
 * in-memory keyframes. The caller applies the returned state; this hook
 * only owns progress/error/busy state (manual save/load — no autosave).
 */
import { useCallback, useRef, useState } from 'react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import type { LiveCompositeProjectSummary } from '@/app/api/live-composite/lib/projects-contract'
import { fetchPngAsMaskRaster, maskRasterToPngBlob } from './lib/mask-raster-png'
import {
  createLiveCompositeProject,
  fetchLiveCompositeProject,
  listLiveCompositeProjects,
  updateLiveCompositeProject,
} from './lib/project-api'
import { collectBaseMaskKeys, deserializeTimeline, serializeTimeline } from './lib/timeline-serialization'
import type { MaskKeyframe, MaskRaster } from './live-composite-types'

const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

export interface SaveProjectInput {
  projectId: string | null
  name: string
  videoFile: File | null
  videoKey: string | null
  videoName: string | null
  backgroundFile: File | null
  backgroundKey: string | null
  backgroundColor: string
  keyframes: MaskKeyframe[]
}

export interface SaveProjectResult {
  projectId: string
  videoKey: string | null
  backgroundKey: string | null
}

export interface OpenedProject {
  id: string
  name: string
  videoUrl: string | null
  videoKey: string | null
  videoName: string | null
  backgroundUrl: string | null
  backgroundKey: string | null
  backgroundColor: string
  keyframes: MaskKeyframe[]
}

export function useLiveCompositeProjects() {
  const upload = useUploadPlaygroundReference()
  // AI raster → uploaded PNG key. Keyed by raster identity: rasters are
  // immutable once created, so identity is a safe cache key across saves.
  const maskKeyByRasterRef = useRef(new WeakMap<MaskRaster, string>())
  const [projects, setProjects] = useState<LiveCompositeProjectSummary[]>([])
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listLiveCompositeProjects())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '合成專案清單載入失敗')
    }
  }, [])

  const uploadFile = useCallback(async (file: File, type: 'image' | 'video'): Promise<string> => {
    const cap = type === 'video' ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES
    if (file.size > cap) {
      const capMb = Math.round(cap / (1024 * 1024))
      throw new Error(`「${file.name}」超過 ${capMb}MB 上傳上限（${(file.size / (1024 * 1024)).toFixed(1)}MB），請先壓縮或裁剪`)
    }
    const result = await upload.mutateAsync({ file, type })
    return result.key
  }, [upload])

  const saveProject = useCallback(async (input: SaveProjectInput): Promise<SaveProjectResult> => {
    setError(null)
    try {
      let videoKey = input.videoKey
      if (!videoKey && input.videoFile) {
        setBusyMessage('正在上傳實拍影片…')
        videoKey = await uploadFile(input.videoFile, 'video')
      }

      let backgroundKey = input.backgroundKey
      if (!backgroundKey && input.backgroundFile) {
        setBusyMessage('正在上傳背景圖片…')
        backgroundKey = await uploadFile(input.backgroundFile, 'image')
      }

      const maskCache = maskKeyByRasterRef.current
      const pendingMasks = input.keyframes.filter(
        (keyframe) => keyframe.baseMask && !maskCache.has(keyframe.baseMask),
      )
      for (let index = 0; index < pendingMasks.length; index += 1) {
        const keyframe = pendingMasks[index]
        if (!keyframe.baseMask) continue
        setBusyMessage(`正在上傳 AI 遮罩（${index + 1} / ${pendingMasks.length}）…`)
        const blob = await maskRasterToPngBlob(keyframe.baseMask)
        const file = new File([blob], `mask-${keyframe.id}.png`, { type: 'image/png' })
        maskCache.set(keyframe.baseMask, await uploadFile(file, 'image'))
      }

      const timeline = serializeTimeline(input.keyframes, (keyframe) =>
        keyframe.baseMask ? maskCache.get(keyframe.baseMask) : undefined,
      )

      setBusyMessage('正在儲存合成專案…')
      const payload = {
        name: input.name.trim() || '未命名合成',
        videoKey,
        videoName: input.videoName,
        backgroundKey,
        backgroundColor: input.backgroundColor,
        timeline,
      }
      const saved = input.projectId
        ? await updateLiveCompositeProject(input.projectId, payload)
        : await createLiveCompositeProject({
            ...payload,
            videoKey: videoKey ?? undefined,
            videoName: input.videoName ?? undefined,
            backgroundKey: backgroundKey ?? undefined,
          })

      setBusyMessage(null)
      void refreshProjects()
      return { projectId: saved.id, videoKey, backgroundKey }
    } catch (err) {
      setBusyMessage(null)
      setError(err instanceof Error ? err.message : '合成專案儲存失敗')
      throw err
    }
  }, [refreshProjects, uploadFile])

  const openProject = useCallback(async (id: string): Promise<OpenedProject> => {
    setError(null)
    try {
      setBusyMessage('正在載入合成專案…')
      const detail = await fetchLiveCompositeProject(id)

      const maskCache = maskKeyByRasterRef.current
      const rasterByKey = new Map<string, MaskRaster>()
      const maskKeys = collectBaseMaskKeys(detail.timeline)
      for (let index = 0; index < maskKeys.length; index += 1) {
        const key = maskKeys[index]
        const url = detail.timeline.keyframes.find((keyframe) => keyframe.baseMaskKey === key)?.baseMaskUrl
        if (!url) throw new Error(`AI 遮罩 ${key} 缺少下載連結，無法載入`)
        setBusyMessage(`正在下載 AI 遮罩（${index + 1} / ${maskKeys.length}）…`)
        const raster = await fetchPngAsMaskRaster(url)
        rasterByKey.set(key, raster)
        maskCache.set(raster, key)
      }

      const keyframes = deserializeTimeline(detail.timeline, rasterByKey)
      setBusyMessage(null)
      return {
        id: detail.id,
        name: detail.name,
        videoUrl: detail.videoUrl,
        videoKey: detail.videoKey,
        videoName: detail.videoName,
        backgroundUrl: detail.backgroundUrl,
        backgroundKey: detail.backgroundKey,
        backgroundColor: detail.backgroundColor,
        keyframes,
      }
    } catch (err) {
      setBusyMessage(null)
      setError(err instanceof Error ? err.message : '合成專案載入失敗')
      throw err
    }
  }, [])

  return {
    projects,
    busyMessage,
    error,
    clearError: () => setError(null),
    refreshProjects,
    saveProject,
    openProject,
  }
}
