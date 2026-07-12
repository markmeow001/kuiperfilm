'use client'

/**
 * Playground controller — all form state, derived model/resolution data, and
 * handlers for the Freedom-Mode playground, extracted so the Image and Video
 * studios (two distinct layouts, 2026-07-08 redesign) can share one source of
 * truth without prop-drilling 20+ values.
 *
 * V2PlaygroundClient calls this once and passes the returned object down as a
 * single `ctrl` prop; ImageStudio / VideoStudio / ResultLightbox consume it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { VIDEO_PROMPT_SOFT_LIMIT, compressVideoPrompt } from '@/lib/playground/video-prompt-compress'
import { variantKeyForMode, type VideoRefMode } from '@/lib/video-models/variant-for-mode'
import {
  KLING_O3_ASPECT_RATIO_VALUES, MAX_KLING_IMAGES, MAX_KLING_IMAGES_WITH_VIDEO,
  mergeNamedRefImagesIntoElements, useKlingElements, validateKlingElements,
} from './useKlingElements'
import { useUserModels, type UserModelOption } from '@/lib/query/hooks/useUserModels'
import {
  useUploadPlaygroundReference,
  useSubmitPlaygroundRun,
  usePlaygroundRuns,
  usePlaygroundCostEstimate,
  type PlaygroundRunRow,
} from '@/lib/query/mutations/playground-mutations'

export const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 直屏' },
  { value: '16:9', label: '16:9 橫屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3 經典' },
  { value: '3:4', label: '3:4 直幅' },
  { value: '4:5', label: '4:5 IG' },
]

export const MAX_REF_IMAGES = 9
export const MAX_REF_VIDEOS = 1 // ARK parity — see Phase S decision memory

export type OutputType = 'image' | 'video'

// AtlasCloud Seedance R2V accepts a reference video only when its own length
// is within [1.8s, 15.2s]; outside that it 400s with DurationTooLong. We use
// a slightly tighter [1.8, 15] window client-side so anything that passes here
// is safely inside the provider bound. See project memory (2026-07-09 r2v fix).
export const REF_VIDEO_MIN_SEC = 1.8
export const REF_VIDEO_MAX_SEC = 15

/** Read a local video File's duration (seconds) via a throwaway <video>. */
function readVideoDurationSec(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const d = video.duration
      URL.revokeObjectURL(url)
      resolve(d)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取影片時長'))
    }
    video.src = url
  })
}

/**
 * Build a same-origin download URL for a result. A direct `<a download>` to the
 * R2/COS URL is ignored cross-origin (the file just opens in a new tab), so we
 * route through /api/playground/download, which re-streams with
 * Content-Disposition: attachment → a real save-to-disk.
 */
export function playgroundDownloadHref(url: string, filename?: string): string {
  const params = new URLSearchParams({ url })
  if (filename) params.set('filename', filename)
  return `/api/playground/download?${params.toString()}`
}

export function usePlaygroundController() {
  const userModelsQuery = useUserModels()
  const upload = useUploadPlaygroundReference()
  const submit = useSubmitPlaygroundRun()
  const runsQuery = usePlaygroundRuns(null)
  // Kling O3 named subjects (人物/場景) — state + handlers live in their own
  // hook; kept across model switches so a switch doesn't wipe uploads.
  const kling = useKlingElements(upload)

  // Form state
  const [prompt, setPrompt] = useState('')
  const [refText, setRefText] = useState('')
  // Reference images may carry an optional NAME（命名）: non-Kling video
  // models get a textual 參考圖對應 map prepended by the worker; Kling O3
  // converts named images into single-image subjects. (2026-07-10)
  const [refImages, setRefImages] = useState<Array<{ key: string; signedUrl: string; name?: string }>>([])
  const [refVideo, setRefVideo] = useState<{ key: string; signedUrl: string } | null>(null)
  const [outputType, setOutputType] = useState<OutputType>('image')
  const [modelKey, setModelKey] = useState<string>('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [durationSec, setDurationSec] = useState<number>(5)
  const [resolution, setResolution] = useState<string>('720p')

  // Output / view state
  const [latestRun, setLatestRun] = useState<PlaygroundRunRow | null>(null)
  // Image studio: which run's detail modal is open (null = closed).
  const [lightboxRun, setLightboxRun] = useState<PlaygroundRunRow | null>(null)
  // Video studio: which run occupies the centre stage (null = newest).
  const [stageRun, setStageRun] = useState<PlaygroundRunRow | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [videoRefMode, setVideoRefMode] = useState<Extract<VideoRefMode, 'image' | 'omni'>>('image')

  const costEstimate = usePlaygroundCostEstimate({
    modelKey,
    outputType,
    ...(outputType === 'video' ? { durationSec, resolution } : {}),
  })

  // File picker + textarea refs
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  function insertReferenceToken(token: string) {
    const ta = promptRef.current
    if (!ta) {
      setPrompt((prev) => (prev ? `${prev} ${token}` : token))
      return
    }
    const start = ta.selectionStart ?? prompt.length
    const end = ta.selectionEnd ?? prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const needLeadingSpace = before.length > 0 && !/\s$/.test(before)
    const needTrailingSpace = after.length > 0 && !/^\s/.test(after)
    const insert = `${needLeadingSpace ? ' ' : ''}${token}${needTrailingSpace ? ' ' : ''}`
    setPrompt(before + insert + after)
    setTimeout(() => {
      ta.focus()
      const caretPos = start + insert.length
      ta.setSelectionRange(caretPos, caretPos)
    }, 0)
  }

  const imageModels = useMemo<UserModelOption[]>(() => userModelsQuery.data?.image ?? [], [userModelsQuery.data])
  const videoModels = useMemo<UserModelOption[]>(() => userModelsQuery.data?.video ?? [], [userModelsQuery.data])
  const activeModels = outputType === 'image' ? imageModels : videoModels

  useEffect(() => {
    if (activeModels.length === 0) {
      if (modelKey) setModelKey('')
      return
    }
    const found = activeModels.find((m) => m.value === modelKey)
    if (!found) setModelKey(activeModels[0].value)
  }, [activeModels, modelKey])

  const selectedVideoModel = activeModels.find((m) => m.value === modelKey)
  // Kling O3 = the only family with named-subject (elements) binding.
  const isKlingO3Model = outputType === 'video' && /::kling-o3-/.test(modelKey)
  // Kling O3 schema: plain images ≤7 (≤4 with a reference video); other
  // models keep the global 9 cap. Enforced at pick-time so the failure is
  // pre-submit, not an async worker error. (2026-07-10 review MEDIUM-4)
  const refImagesCap = isKlingO3Model
    ? (refVideo ? MAX_KLING_IMAGES_WITH_VIDEO : MAX_KLING_IMAGES)
    : MAX_REF_IMAGES
  // Clamp aspect ratio to the Kling enum when switching onto a Kling model
  // with a non-supported pick (e.g. 4:3) still selected.
  useEffect(() => {
    if (isKlingO3Model && !(KLING_O3_ASPECT_RATIO_VALUES as readonly string[]).includes(aspectRatio)) {
      setAspectRatio('16:9')
    }
  }, [isKlingO3Model, aspectRatio])
  const resolutionOptions: string[] =
    (outputType === 'video' && selectedVideoModel?.capabilities?.video?.resolutionOptions) || []
  const showResolutionPicker = resolutionOptions.length > 1
  useEffect(() => {
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions.includes('720p') ? '720p' : resolutionOptions[0])
    }
  }, [resolutionOptions, resolution])

  // Promote worker status changes into the tracked run (poll every 3s while
  // pending/running rows exist). Keeps the in-progress placeholder + video
  // stage live without a manual refresh.
  useEffect(() => {
    if (!latestRun) return
    if (latestRun.status === 'succeeded' || latestRun.status === 'failed') return
    const updated = runsQuery.data?.runs?.find((r) => r.id === latestRun.id)
    if (updated && updated.status !== latestRun.status) {
      setLatestRun(updated)
      if (updated.outputType === 'video') setStageRun(updated)
    } else if (updated && updated.status === 'succeeded' && (!latestRun.resultUrls?.[0] || latestRun.resultUrls?.[0] !== updated.resultUrls?.[0])) {
      setLatestRun(updated)
      if (updated.outputType === 'video') setStageRun(updated)
    }
  }, [runsQuery.data, latestRun])

  // ── Handlers ──────────────────────────────────────────────────────

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (refImages.length >= refImagesCap) {
      alert(`參考圖最多 ${refImagesCap} 張${isKlingO3Model && refVideo ? '（Kling O3 有參考影片時上限 4）' : ''}`)
      return
    }
    try {
      const result = await upload.mutateAsync({ file, type: 'image' })
      setRefImages((prev) => [...prev, { key: result.key, signedUrl: result.signedUrl }])
    } catch (err) {
      alert(`圖片上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  async function handleVideoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (refVideo) {
      alert('參考影片目前只能 1 支。請先移除再上傳新的。')
      return
    }
    // Kling O3: binding a reference video drops the plain-image cap to 4
    // (schema rule). Adding the video AFTER 5-7 images used to slip past
    // the reactive cap and fail async in the worker — block up front.
    // (2026-07-12 review MEDIUM)
    if (isKlingO3Model && refImages.length > MAX_KLING_IMAGES_WITH_VIDEO) {
      alert(
        `Kling O3 綁參考影片時參考圖最多 ${MAX_KLING_IMAGES_WITH_VIDEO} 張（目前 ${refImages.length} 張）。` +
        '請先移除多的參考圖再上傳影片。',
      )
      return
    }
    // Guard the reference video's own length up-front — AtlasCloud R2V rejects
    // clips outside 1.8–15s with a 400, wasting an upload + a billing freeze.
    // Fail fast with a clear message instead. Unreadable metadata → let it
    // through; the worker-side REFERENCE_VIDEO_TOO_LONG normalize is the backstop.
    try {
      const dur = await readVideoDurationSec(file)
      if (Number.isFinite(dur) && (dur > REF_VIDEO_MAX_SEC || dur < REF_VIDEO_MIN_SEC)) {
        alert(
          `參考影片長度為 ${dur.toFixed(1)} 秒,需介於 ${REF_VIDEO_MIN_SEC}–${REF_VIDEO_MAX_SEC} 秒之間` +
          `(R2V 動作參考限制)。請換一支較短的影片,或先裁剪到 ${REF_VIDEO_MAX_SEC} 秒內再上傳。`,
        )
        return
      }
    } catch {
      // metadata unreadable — proceed; provider + worker normalize will catch it
    }
    try {
      const result = await upload.mutateAsync({ file, type: 'video' })
      setRefVideo({ key: result.key, signedUrl: result.signedUrl })
    } catch (err) {
      alert(`影片上傳失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  function removeRefImage(idx: number) {
    setRefImages((prev) => prev.filter((_, i) => i !== idx))
  }

  function setRefImageName(key: string, name: string) {
    setRefImages((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)))
  }

  function removeRefVideo() {
    setRefVideo(null)
  }

  async function handleRun(overrideModelKey?: string, promptOverride?: string) {
    // promptOverride lets the lightbox re-run a finished run's OWN prompt
    // without waiting for a setPrompt() state commit (the stale-closure bug).
    const basePrompt = (promptOverride ?? prompt).trim()
    if (!basePrompt) {
      alert('請先輸入提示詞')
      return
    }
    if (outputType === 'image' && basePrompt.length > 4000) {
      alert(`提示詞過長（${basePrompt.length}/4000 字符），請精簡後再生成`)
      return
    }
    const useModelKey = overrideModelKey ?? modelKey
    if (!useModelKey) {
      alert('請先選擇模型')
      return
    }
    let effectivePrompt = basePrompt
    if (outputType === 'video' && effectivePrompt.length > VIDEO_PROMPT_SOFT_LIMIT) {
      setCompressing(true)
      try {
        effectivePrompt = await compressVideoPrompt(effectivePrompt)
      } catch (err) {
        alert(`提示詞過長（${basePrompt.length} 字符）且自動壓縮失敗：${(err as Error)?.message ?? '未知錯誤'}`)
        return
      } finally {
        setCompressing(false)
      }
    }
    if (overrideModelKey && overrideModelKey !== modelKey) {
      setModelKey(overrideModelKey)
    }
    // Kling O3 named subjects — explicit 主體 cards merged with NAMED plain
    // reference images (each becomes a single-image subject). Validate
    // before submit so failures are instant (route re-validates).
    const isKlingKey = /::kling-o3-/.test(useModelKey)
    let klingSubmitElements: Array<{ name: string; imageKeys: string[] }> = []
    let klingPlainImageKeys: string[] = refImages.map((r) => r.key)
    if (isKlingKey) {
      const merged = mergeNamedRefImagesIntoElements(
        kling.elements.map((el) => ({ name: el.name, imageKeys: el.images.map((im) => im.key) })),
        refImages,
      )
      if (merged.error) {
        alert(merged.error)
        return
      }
      klingSubmitElements = merged.elements
      klingPlainImageKeys = merged.plainImageKeys
      if (klingSubmitElements.length > 0) {
        const drafts = klingSubmitElements.map((el) => ({
          id: el.name, name: el.name,
          images: el.imageKeys.map((k) => ({ key: k, signedUrl: '' })),
        }))
        const { error, unmentioned } = validateKlingElements(drafts, effectivePrompt)
        if (error) {
          alert(error)
          return
        }
        // Soft nudge: unreferenced subjects still bind, just weaker —
        // confirm rather than block.
        if (unmentioned.length > 0) {
          const ok = confirm(
            `提示詞裡沒有提到：${unmentioned.join('、')}。\n` +
            '在 prompt 裡直接打主體名字綁定效果最好。仍要送出嗎？',
          )
          if (!ok) return
        }
      }
    }
    // Kling + ZERO bindings + a prompt full of @tokens = a storyboard-carried
    // prompt the user expects to bind (2026-07-11 user report: elements=0
    // silently shipped as loose images). Warn before wasting a paid run —
    // @tokens mean nothing to Kling; only named subjects bind.
    // Boundary-anchored so emails/handles mid-word don't false-positive
    // (2026-07-12 review LOW): @ must follow start-of-string, whitespace,
    // or CJK punctuation to count as a subject token.
    if (isKlingKey && klingSubmitElements.length === 0 && /(^|[\s，、。：:；;（(「【])@[^\s@，、。.,]{1,20}/.test(effectivePrompt)) {
      const ok = confirm(
        '提示詞裡有 @名字，但目前沒有綁定任何主體 —— Kling 不認 @token，' +
        '參考圖只會當「鬆散參考」使用。\n\n' +
        '建議：在參考圖下方「命名」欄填上名字（或用主體綁定區建主體）再送出。\n\n' +
        '仍要直接送出嗎？',
      )
      if (!ok) return
    }
    const submitKlingElements = isKlingKey && klingSubmitElements.length > 0
    // Non-Kling video with named images → worker prepends the 參考圖對應
    // textual map (Seedance-class has no API-level named binding).
    const referenceImageNames = refImages.map((r) => r.name?.trim() || null)
    const hasNamedImages = referenceImageNames.some(Boolean)
    // Kling O3 keys skip the t2v/i2v/r2v sibling remap — the family has a
    // single r2v endpoint and the dash regex would otherwise hunt for a
    // nonexistent kling-o3-*-i2v sibling.
    const effectiveModelKey = outputType === 'video' && refImages.length > 0 && !isKlingKey
      ? variantKeyForMode(useModelKey, videoRefMode, videoModels.map((m) => m.value))
      : useModelKey
    try {
      const result = await submit.mutateAsync({
        prompt: effectivePrompt,
        // Kling: named images ride the elements payload instead (else the
        // same image would count twice — once bound, once plain).
        referenceImages: isKlingKey ? klingPlainImageKeys : refImages.map((r) => r.key),
        referenceVideos: refVideo ? [refVideo.key] : [],
        referenceText: refText.trim() || undefined,
        outputType,
        modelKey: effectiveModelKey,
        aspectRatio,
        ...(outputType === 'video' ? { durationSec } : {}),
        ...(showResolutionPicker ? { resolution } : {}),
        ...(submitKlingElements ? { elements: klingSubmitElements } : {}),
        ...(!isKlingKey && outputType === 'video' && hasNamedImages
          ? { referenceImageNames }
          : {}),
      })
      const row: PlaygroundRunRow = {
        id: result.run.id,
        prompt: effectivePrompt,
        outputType: result.run.outputType as OutputType,
        modelKey: result.run.modelKey,
        status: result.run.status as PlaygroundRunRow['status'],
        resultUrls: [result.run.resultUrl],
        errorMessage: null,
        createdAt: result.run.createdAt,
        completedAt: result.run.completedAt,
      }
      setLatestRun(row)
      // Video: fresh run takes the centre stage immediately so the user
      // watches it generate. Image: close any open lightbox; the placeholder
      // appears in the gallery.
      if (row.outputType === 'video') setStageRun(row)
      else setLightboxRun(null)
    } catch (err) {
      alert(`生成失敗:${(err as Error)?.message ?? '未知錯誤'}`)
    }
  }

  /** Copy a run's prompt to the clipboard (used by the lightbox / detail rail). */
  async function copyPrompt(text: string | undefined | null) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setPromptCopied(true)
      setTimeout(() => setPromptCopied(false), 1500)
    } catch (err) {
      alert(`複製失敗:${(err as Error)?.message ?? '瀏覽器不允許存取剪貼簿'}`)
    }
  }

  /** Pull a run's prompt back into the composer for editing + re-run. */
  function editPrompt(text: string | undefined | null) {
    if (!text) return
    setPrompt(text)
    setLightboxRun(null)
    setTimeout(() => {
      promptRef.current?.focus()
      promptRef.current?.setSelectionRange(text.length, text.length)
    }, 0)
  }

  function resetForm() {
    setPrompt('')
    setRefText('')
    setRefImages([])
    setRefVideo(null)
    kling.clearElements()
  }

  /**
   * Reuse a finished run's image output as the reference for the next
   * generation. The run route accepts an https storage URL as a reference
   * (see reference-guard: signatures can't be forged, so it's read-safe), so
   * we pass the result URL straight through — no re-upload, no CORS, no key.
   * `asVideo` flips to the Video studio for image-to-video (i2v).
   */
  function applyRunAsReference(run: PlaygroundRunRow, opts?: { asVideo?: boolean }) {
    const url = run.resultUrls?.[0]
    if (!url) {
      alert('此結果沒有可用的圖片,無法作為參考')
      return
    }
    setRefImages([{ key: url, signedUrl: url }])
    setRefVideo(null)
    if (opts?.asVideo) {
      setOutputType('video')
      setVideoRefMode('image')
    }
    setLightboxRun(null)
  }

  const isBusy = upload.isPending || submit.isPending || compressing
  const refCount = refImages.length + (refVideo ? 1 : 0)
  const isGenerating = latestRun?.status === 'pending' || latestRun?.status === 'running'
  const allRuns = runsQuery.data?.runs ?? []
  const imageRuns = allRuns.filter((r) => r.outputType === 'image')
  const videoRuns = allRuns.filter((r) => r.outputType === 'video')
  // Video centre stage: explicit selection, else the tracked run, else newest.
  const effectiveStageRun: PlaygroundRunRow | null =
    stageRun ?? (latestRun?.outputType === 'video' ? latestRun : null) ?? videoRuns[0] ?? null

  return {
    // queries / mutations
    submit,
    upload,
    costEstimate,
    // form state
    prompt, setPrompt,
    refText, setRefText,
    refImages, refVideo,
    elements: kling.elements, isKlingO3Model,
    outputType, setOutputType,
    modelKey, setModelKey,
    aspectRatio, setAspectRatio,
    durationSec, setDurationSec,
    resolution, setResolution,
    videoRefMode, setVideoRefMode,
    // view state
    latestRun,
    lightboxRun, setLightboxRun,
    stageRun: effectiveStageRun, setStageRun,
    promptCopied,
    compressing,
    // refs
    imageInputRef, videoInputRef, promptRef,
    // derived
    imageModels, videoModels, activeModels, selectedVideoModel,
    resolutionOptions, showResolutionPicker, refImagesCap,
    isBusy, refCount, isGenerating,
    allRuns, imageRuns, videoRuns,
    // handlers
    insertReferenceToken,
    handleImagePick, handleVideoPick, removeRefImage, removeRefVideo, setRefImageName,
    addElement: kling.addElement,
    removeElement: kling.removeElement,
    setElementName: kling.setElementName,
    handleElementImagePick: kling.handleElementImagePick,
    removeElementImage: kling.removeElementImage,
    handleRun, copyPrompt, editPrompt, resetForm, applyRunAsReference,
  }
}

export type PlaygroundController = ReturnType<typeof usePlaygroundController>
export type PlaygroundRun = PlaygroundRunRow
