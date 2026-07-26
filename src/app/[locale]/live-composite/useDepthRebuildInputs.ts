'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DepthGuideRecordingCancelledError, type DepthGuideProgress } from './lib/depth-guide-recorder'
import { depthRebuildDurationSeconds } from './lib/depth-rebuild-workflow'
import {
  createDepthReferenceImage,
  revokeDepthReferenceImage,
  revokeLocalDepthGuide,
  type DepthGuideStageHandle,
  type DepthGuideStatus,
  type DepthRebuildCharacterReference,
  type DepthRebuildSceneReference,
  type LocalDepthGuide,
  type LocalDepthReferenceImage,
} from './depth-rebuild-assets'
import type { VideoMetadata } from './live-composite-types'
import type { RefObject } from 'react'

interface UseDepthRebuildInputsOptions {
  stageRef: RefObject<DepthGuideStageHandle | null>
  metadata: VideoMetadata | null
  videoHasAudio: boolean | null
  maxReferenceImages: number
  onError: (message: string | null) => void
}

function createEmptyCharacter(ordinal: number): DepthRebuildCharacterReference {
  return {
    id: `character-${ordinal}`,
    label: `新角色 ${ordinal}`,
    sourceBinding: '',
    brief: '',
    description: '',
    image: null,
  }
}

function revokeCharacterImages(characters: readonly DepthRebuildCharacterReference[]): void {
  for (const character of characters) revokeDepthReferenceImage(character.image)
}

function revokeSceneImages(scenes: readonly DepthRebuildSceneReference[]): void {
  for (const scene of scenes) revokeDepthReferenceImage(scene.image)
}

export function useDepthRebuildInputs({
  stageRef,
  metadata,
  videoHasAudio,
  maxReferenceImages,
  onError,
}: UseDepthRebuildInputsOptions) {
  const [depthGuide, setDepthGuide] = useState<LocalDepthGuide | null>(null)
  const [depthGuideStatus, setDepthGuideStatus] = useState<DepthGuideStatus>('idle')
  const [depthGuideProgress, setDepthGuideProgress] = useState<DepthGuideProgress | null>(null)
  const [characters, setCharacters] = useState<DepthRebuildCharacterReference[]>(() => [
    createEmptyCharacter(1),
  ])
  const [sceneReferences, setSceneReferences] = useState<DepthRebuildSceneReference[]>([])
  const [sceneBrief, setSceneBrief] = useState('')
  const [sceneDescription, setSceneDescription] = useState('')
  const depthCancelRequestedRef = useRef(false)
  const depthGenerationInFlightRef = useRef(false)
  const depthGuideRef = useRef<LocalDepthGuide | null>(null)
  const charactersRef = useRef<DepthRebuildCharacterReference[]>(characters)
  const sceneReferencesRef = useRef<DepthRebuildSceneReference[]>(sceneReferences)
  const nextCharacterOrdinalRef = useRef(2)
  const nextSceneOrdinalRef = useRef(1)

  const referenceImageCount = useMemo(
    () => characters.reduce((count, character) => count + (character.image ? 1 : 0), 0)
      + sceneReferences.length,
    [characters, sceneReferences],
  )

  useEffect(() => {
    depthGuideRef.current = depthGuide
  }, [depthGuide])

  useEffect(() => () => {
    stageRef.current?.cancelDepthGuideVideo()
    revokeLocalDepthGuide(depthGuideRef.current)
    revokeCharacterImages(charactersRef.current)
    revokeSceneImages(sceneReferencesRef.current)
  }, [stageRef])

  function updateCharacters(
    updater: (current: readonly DepthRebuildCharacterReference[]) => DepthRebuildCharacterReference[],
  ): void {
    const next = updater(charactersRef.current)
    charactersRef.current = next
    setCharacters(next)
  }

  function updateScenes(
    updater: (current: readonly DepthRebuildSceneReference[]) => DepthRebuildSceneReference[],
  ): void {
    const next = updater(sceneReferencesRef.current)
    sceneReferencesRef.current = next
    setSceneReferences(next)
  }

  function currentReferenceCount(): number {
    return charactersRef.current.reduce(
      (count, character) => count + (character.image ? 1 : 0),
      0,
    ) + sceneReferencesRef.current.length
  }

  function currentAllocatedSlotCount(): number {
    return charactersRef.current.length + sceneReferencesRef.current.length
  }

  function addCharacter(): void {
    if (currentAllocatedSlotCount() >= maxReferenceImages) {
      onError(`人物與場景共用 ${maxReferenceImages} 個參考位置；請先移除一張場景圖或一位角色`)
      return
    }
    const ordinal = nextCharacterOrdinalRef.current
    nextCharacterOrdinalRef.current += 1
    updateCharacters((current) => [...current, createEmptyCharacter(ordinal)])
    onError(null)
  }

  function removeCharacter(characterId: string): void {
    const target = charactersRef.current.find((character) => character.id === characterId)
    if (!target) return
    if (charactersRef.current.length === 1) {
      onError('至少保留一個新角色欄位')
      return
    }
    updateCharacters((current) => current.filter((character) => character.id !== characterId))
    revokeDepthReferenceImage(target.image)
    onError(null)
  }

  function patchCharacter(
    characterId: string,
    patch: Partial<Omit<DepthRebuildCharacterReference, 'id' | 'image'>>,
  ): void {
    updateCharacters((current) => current.map((character) => (
      character.id === characterId ? { ...character, ...patch } : character
    )))
  }

  function selectCharacterImage(characterId: string, file: File): void {
    const current = charactersRef.current.find((character) => character.id === characterId)
    if (!current) return
    if (!current.image && currentReferenceCount() >= maxReferenceImages) {
      onError(`人物與場景參考圖片合計最多 ${maxReferenceImages} 張`)
      return
    }
    onError(null)
    try {
      const nextImage = createDepthReferenceImage(file)
      updateCharacters((all) => all.map((character) => (
        character.id === characterId ? { ...character, image: nextImage } : character
      )))
      revokeDepthReferenceImage(current.image)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '角色圖片讀取失敗')
    }
  }

  function clearCharacterImage(characterId: string): void {
    const current = charactersRef.current.find((character) => character.id === characterId)
    if (!current?.image) return
    updateCharacters((all) => all.map((character) => (
      character.id === characterId ? { ...character, image: null } : character
    )))
    revokeDepthReferenceImage(current.image)
  }

  function rejectCharacterImage(characterId: string): void {
    clearCharacterImage(characterId)
    onError('角色圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
  }

  function addSceneImages(files: readonly File[]): void {
    if (files.length === 0) return
    // Every character card reserves one image slot even before its required
    // portrait is uploaded. This prevents a user from filling all nine slots
    // with scenes and getting stuck with an unfillable required character.
    const remaining = maxReferenceImages - currentAllocatedSlotCount()
    if (files.length > remaining) {
      onError(
        remaining > 0
          ? `人物與場景合計最多 ${maxReferenceImages} 張；已替角色保留位置，目前還能加入 ${remaining} 張場景圖`
          : `Seedance 的 ${maxReferenceImages} 個參考位置已分配完畢`,
      )
      return
    }

    const created: LocalDepthReferenceImage[] = []
    try {
      for (const file of files) created.push(createDepthReferenceImage(file))
    } catch (caught) {
      for (const image of created) revokeDepthReferenceImage(image)
      onError(caught instanceof Error ? caught.message : '場景圖片讀取失敗')
      return
    }

    const additions = created.map((image): DepthRebuildSceneReference => {
      const ordinal = nextSceneOrdinalRef.current
      nextSceneOrdinalRef.current += 1
      return {
        id: `scene-${ordinal}`,
        note: '',
        image,
      }
    })
    updateScenes((current) => [...current, ...additions])
    onError(null)
  }

  function removeSceneImage(sceneId: string): void {
    const target = sceneReferencesRef.current.find((scene) => scene.id === sceneId)
    if (!target) return
    updateScenes((current) => current.filter((scene) => scene.id !== sceneId))
    revokeDepthReferenceImage(target.image)
    onError(null)
  }

  function rejectSceneImage(sceneId: string): void {
    removeSceneImage(sceneId)
    onError('場景圖片無法解碼，請改用有效的 JPG、PNG 或 WebP')
  }

  function setSceneReferenceNote(sceneId: string, value: string): void {
    updateScenes((current) => current.map((scene) => (
      scene.id === sceneId ? { ...scene, note: value } : scene
    )))
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

  async function generateDepthGuide(): Promise<LocalDepthGuide | null> {
    if (depthGenerationInFlightRef.current) {
      onError('深度影片正在產生，請先等待完成或按「停止處理」')
      return null
    }
    if (!metadata) {
      onError('請先上傳原始表演影片')
      return null
    }
    try {
      depthRebuildDurationSeconds(metadata.duration)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '原片秒數無效')
      return null
    }
    const stage = stageRef.current
    if (!stage) {
      onError('影片預覽尚未準備完成，請稍後再試')
      return null
    }

    onError(null)
    setDepthGuideStatus('generating')
    setDepthGuideProgress(null)
    depthCancelRequestedRef.current = false
    depthGenerationInFlightRef.current = true
    try {
      const exported = await stage.exportDepthGuideVideo({
        // Audio probing is asynchronous and may still be unknown when the
        // user starts this local export. Keep the track unless the source is
        // positively known to be silent; the server strips it later when
        // sourceAudioMode="generate".
        includeAudio: videoHasAudio !== false,
        onProgress: setDepthGuideProgress,
      })
      if (depthCancelRequestedRef.current) return null
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
      return next
    } catch (caught) {
      if (caught instanceof DepthGuideRecordingCancelledError || depthCancelRequestedRef.current) {
        setDepthGuideStatus(depthGuideRef.current ? 'ready' : 'idle')
        onError(null)
        return null
      }
      setDepthGuideStatus('failed')
      onError(caught instanceof Error ? caught.message : '深度影片產生失敗')
      return null
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
    characters,
    sceneReferences,
    sceneBrief,
    sceneDescription,
    referenceImageCount,
    depthBusy: depthGuideStatus === 'generating',
    addCharacter,
    removeCharacter,
    setCharacterLabel: (characterId: string, value: string) => {
      patchCharacter(characterId, { label: value })
    },
    setCharacterSourceBinding: (characterId: string, value: string) => {
      patchCharacter(characterId, { sourceBinding: value })
    },
    setCharacterBrief: (characterId: string, value: string) => {
      patchCharacter(characterId, { brief: value })
    },
    setCharacterDescription: (characterId: string, value: string) => {
      patchCharacter(characterId, { description: value })
    },
    selectCharacterImage,
    rejectCharacterImage,
    clearCharacterImage,
    addSceneImages,
    removeSceneImage,
    rejectSceneImage,
    setSceneReferenceNote,
    setSceneBrief,
    setSceneDescription,
    generateDepthGuide,
    cancelDepthGuide,
    clearDepthGuide,
    resetDepthSource,
  }
}
