'use client'

import { useEffect, useRef, useState } from 'react'
import { DepthGuideRecordingCancelledError, type DepthGuideProgress } from './lib/depth-guide-recorder'
import { depthRebuildDurationSeconds } from './lib/depth-rebuild-workflow'
import {
  createDepthReferenceImage,
  revokeDepthReferenceImage,
  revokeLocalDepthGuide,
  type DepthGuideStageHandle,
  type DepthGuideStatus,
  type LocalDepthGuide,
  type LocalDepthReferenceImage,
} from './depth-rebuild-assets'
import type { VideoMetadata } from './live-composite-types'
import type { RefObject } from 'react'

interface UseDepthRebuildInputsOptions {
  stageRef: RefObject<DepthGuideStageHandle | null>
  metadata: VideoMetadata | null
  videoHasAudio: boolean | null
  onError: (message: string | null) => void
}

export function useDepthRebuildInputs({
  stageRef,
  metadata,
  videoHasAudio,
  onError,
}: UseDepthRebuildInputsOptions) {
  const [depthGuide, setDepthGuide] = useState<LocalDepthGuide | null>(null)
  const [depthGuideStatus, setDepthGuideStatus] = useState<DepthGuideStatus>('idle')
  const [depthGuideProgress, setDepthGuideProgress] = useState<DepthGuideProgress | null>(null)
  const [characterImage, setCharacterImage] = useState<LocalDepthReferenceImage | null>(null)
  const [sceneImage, setSceneImage] = useState<LocalDepthReferenceImage | null>(null)
  const [characterDescription, setCharacterDescription] = useState('')
  const [sceneDescription, setSceneDescription] = useState('')
  const depthCancelRequestedRef = useRef(false)
  const depthGenerationInFlightRef = useRef(false)
  const depthGuideRef = useRef<LocalDepthGuide | null>(null)
  const characterImageRef = useRef<LocalDepthReferenceImage | null>(null)
  const sceneImageRef = useRef<LocalDepthReferenceImage | null>(null)

  useEffect(() => {
    depthGuideRef.current = depthGuide
  }, [depthGuide])
  useEffect(() => {
    characterImageRef.current = characterImage
  }, [characterImage])
  useEffect(() => {
    sceneImageRef.current = sceneImage
  }, [sceneImage])
  useEffect(() => () => {
    stageRef.current?.cancelDepthGuideVideo()
    revokeLocalDepthGuide(depthGuideRef.current)
    revokeDepthReferenceImage(characterImageRef.current)
    revokeDepthReferenceImage(sceneImageRef.current)
  }, [stageRef])

  function selectCharacterImage(file: File): void {
    onError(null)
    try {
      const next = createDepthReferenceImage(file)
      revokeDepthReferenceImage(characterImageRef.current)
      characterImageRef.current = next
      setCharacterImage(next)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '角色圖片讀取失敗')
    }
  }

  function clearCharacterImage(): void {
    revokeDepthReferenceImage(characterImageRef.current)
    characterImageRef.current = null
    setCharacterImage(null)
  }

  function rejectCharacterImage(): void {
    clearCharacterImage()
    onError('角色圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
  }

  function selectSceneImage(file: File): void {
    onError(null)
    try {
      const next = createDepthReferenceImage(file)
      revokeDepthReferenceImage(sceneImageRef.current)
      sceneImageRef.current = next
      setSceneImage(next)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '場景圖片讀取失敗')
    }
  }

  function clearSceneImage(): void {
    revokeDepthReferenceImage(sceneImageRef.current)
    sceneImageRef.current = null
    setSceneImage(null)
  }

  function rejectSceneImage(): void {
    clearSceneImage()
    onError('場景圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
  }

  function clearDepthGuide(): void {
    revokeLocalDepthGuide(depthGuideRef.current)
    depthGuideRef.current = null
    setDepthGuide(null)
    setDepthGuideProgress(null)
    setDepthGuideStatus('idle')
  }

  function cancelDepthGuide(): void {
    if (!depthGenerationInFlightRef.current) return
    depthCancelRequestedRef.current = true
    stageRef.current?.cancelDepthGuideVideo()
  }

  async function generateDepthGuide(): Promise<void> {
    if (depthGenerationInFlightRef.current) {
      onError('深度影片正在產生，請先等待完成或按「停止處理」')
      return
    }
    if (!metadata) {
      onError('請先上傳原始表演影片')
      return
    }
    try {
      depthRebuildDurationSeconds(metadata.duration)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '原片秒數無效')
      return
    }
    const stage = stageRef.current
    if (!stage) {
      onError('影片預覽尚未準備完成，請稍後再試')
      return
    }

    onError(null)
    setDepthGuideStatus('generating')
    setDepthGuideProgress(null)
    depthCancelRequestedRef.current = false
    depthGenerationInFlightRef.current = true
    try {
      const exported = await stage.exportDepthGuideVideo({
        includeAudio: videoHasAudio === true,
        onProgress: setDepthGuideProgress,
      })
      if (depthCancelRequestedRef.current) return
      const extension = exported.extension.replace(/^\./, '') || 'webm'
      const file = new File(
        [exported.blob],
        `depth-guide-${Date.now()}.${extension}`,
        { type: exported.mimeType },
      )
      const next: LocalDepthGuide = {
        file,
        previewUrl: URL.createObjectURL(file),
        depthFrameCount: exported.depthFrameCount,
        effectiveDepthFps: exported.effectiveDepthFps,
        sufficient: exported.sufficient,
      }
      revokeLocalDepthGuide(depthGuideRef.current)
      depthGuideRef.current = next
      setDepthGuide(next)
      setDepthGuideStatus('ready')
      if (!exported.sufficient) {
        onError(
          `深度影片有效幀率只有 ${exported.effectiveDepthFps.toFixed(1)} fps，低於生成品質門檻；請重新產生`,
        )
      }
    } catch (caught) {
      if (caught instanceof DepthGuideRecordingCancelledError || depthCancelRequestedRef.current) {
        setDepthGuideStatus(depthGuideRef.current ? 'ready' : 'idle')
        onError(null)
        return
      }
      setDepthGuideStatus('failed')
      onError(caught instanceof Error ? caught.message : '深度影片產生失敗')
    } finally {
      depthCancelRequestedRef.current = false
      depthGenerationInFlightRef.current = false
    }
  }

  function resetDepthSource(): void {
    if (depthGenerationInFlightRef.current) cancelDepthGuide()
    clearDepthGuide()
  }

  return {
    depthGuide,
    depthGuideStatus,
    depthGuideProgress,
    characterImage,
    sceneImage,
    characterDescription,
    sceneDescription,
    depthBusy: depthGuideStatus === 'generating',
    setCharacterDescription,
    setSceneDescription,
    selectCharacterImage,
    rejectCharacterImage,
    clearCharacterImage,
    selectSceneImage,
    rejectSceneImage,
    clearSceneImage,
    generateDepthGuide,
    cancelDepthGuide,
    clearDepthGuide,
    resetDepthSource,
  }
}
