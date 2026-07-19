'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { buildReconstructionKeyframePrompt, buildReconstructionPrompt } from '@/lib/playground/reconstruction-prompt'
import { getReconstructionStageAvailability } from '@/lib/playground/reconstruction-stage'
import type {
  ReconstructionAnalysisResult,
  ReconstructionAudioMode,
  ReconstructionCreativeBrief,
  ReconstructionDialogueLine,
  ReconstructionReferenceBinding,
  ReconstructionVideoMetadata,
} from '@/lib/playground/reconstruction-contract'
import { useAnalyzePlaygroundVideo, useSubmitPlaygroundRun } from '@/lib/query/mutations/playground-mutations'
import { waitForTaskResult } from '@/lib/task/client'
import type { PlaygroundController } from './usePlaygroundController'
import { REF_VIDEO_MAX_SEC, REF_VIDEO_MIN_SEC } from './usePlaygroundController'
import {
  ReconstructionGenerationControls,
  ReconstructionPromptReview,
  type ReconstructionReferenceAsset,
} from './ReconstructionGenerationControls'
import { ReconstructionBriefForm } from './ReconstructionBriefForm'
import { ReconstructionResultStage } from './ReconstructionResultStage'

interface ReconstructionStudioProps {
  ctrl: PlaygroundController
  locale: string
}

const DEFAULT_BRIEF: ReconstructionCreativeBrief = {
  era: '',
  location: '',
  story: '',
  characterDesign: '',
  wardrobe: '',
  mood: '',
  weatherAndTime: '',
  backgroundMotion: '',
  replacePeople: true,
}

function nearestAspectRatio(width: number, height: number): string {
  if (!width || !height) return '16:9'
  const ratio = width / height
  if (ratio > 1.55) return '16:9'
  if (ratio < 0.75) return '9:16'
  return '1:1'
}

function readLocalMetadata(file: File): Promise<ReconstructionVideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const durationSec = video.duration
      const width = video.videoWidth
      const height = video.videoHeight
      URL.revokeObjectURL(url)
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        reject(new Error('無法讀取影片長度'))
        return
      }
      resolve({ durationSec, width, height, fps: null, hasAudio: true })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取影片資料'))
    }
    video.src = url
  })
}

export function ReconstructionStudio({ ctrl, locale }: ReconstructionStudioProps) {
  const {
    modelKey: controllerModelKey,
    setModelKey: setControllerModelKey,
    setOutputType: setControllerOutputType,
    setVideoRefMode: setControllerVideoRefMode,
  } = ctrl
  const inputRef = useRef<HTMLInputElement | null>(null)
  const referencePreviewUrlsRef = useRef(new Set<string>())
  const analyze = useAnalyzePlaygroundVideo()
  const keyframeSubmit = useSubmitPlaygroundRun()
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<ReconstructionVideoMetadata | null>(null)
  const [analysisResult, setAnalysisResult] = useState<ReconstructionAnalysisResult | null>(null)
  const [brief, setBrief] = useState<ReconstructionCreativeBrief>(DEFAULT_BRIEF)
  const [dialogue, setDialogue] = useState<ReconstructionDialogueLine[]>([])
  const [audioMode, setAudioMode] = useState<ReconstructionAudioMode>('preserve-original')
  const [durationMode, setDurationMode] = useState('source')
  const [selectedModelKey, setSelectedModelKey] = useState('')
  const [characterReference, setCharacterReference] = useState<ReconstructionReferenceAsset | null>(null)
  const [sceneReference, setSceneReference] = useState<ReconstructionReferenceAsset | null>(null)
  const [targetKeyframe, setTargetKeyframe] = useState<ReconstructionReferenceAsset | null>(null)
  const [targetKeyframeFingerprint, setTargetKeyframeFingerprint] = useState<string | null>(null)
  const [isGeneratingKeyframe, setIsGeneratingKeyframe] = useState(false)
  const [promptPreview, setPromptPreview] = useState('')
  const [promptFingerprint, setPromptFingerprint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reconstructionRunId, setReconstructionRunId] = useState<string | null>(null)

  const reconstructionModels = useMemo(() => (
    ctrl.videoModels.filter((model) => /^atlascloud::seedance-2\.0-(?:fast-)?r2v$/.test(model.value))
  ), [ctrl.videoModels])
  const defaultModel = reconstructionModels.find((model) => model.value === 'atlascloud::seedance-2.0-r2v')
    ?? reconstructionModels[0]
  const effectiveModelKey = reconstructionModels.some((model) => model.value === selectedModelKey)
    ? selectedModelKey
    : (defaultModel?.value ?? '')
  const outputDurationSec = durationMode === 'source'
    ? Math.max(4, Math.min(15, Math.round(metadata?.durationSec ?? 5)))
    : Number(durationMode)
  const keyframeModels = useMemo(() => ctrl.imageModels.filter((model) => (
    /^atlascloud::(?:gpt-image-[12]|nano-banana(?:-pro|-2)?|grok-imagine-image(?:-quality)?)$/.test(model.value)
  )), [ctrl.imageModels])
  const keyframeModel = [
    'atlascloud::nano-banana-2',
    'atlascloud::gpt-image-2',
    'atlascloud::nano-banana-pro',
    'atlascloud::grok-imagine-image-quality',
    'atlascloud::gpt-image-1',
    'atlascloud::nano-banana',
    'atlascloud::grok-imagine-image',
  ].map((key) => keyframeModels.find((model) => model.value === key)).find(Boolean) ?? keyframeModels[0] ?? null
  const keyframeInputFingerprint = useMemo(() => JSON.stringify({
    sourceFrameKey: analysisResult?.sourceFrame.key ?? null,
    characterKey: characterReference?.key ?? null,
    sceneKey: sceneReference?.key ?? null,
    brief,
    imageModelKey: keyframeModel?.value ?? null,
  }), [analysisResult?.sourceFrame.key, characterReference?.key, sceneReference?.key, brief, keyframeModel?.value])
  const keyframeIsStale = Boolean(targetKeyframe && targetKeyframeFingerprint !== keyframeInputFingerprint)
  const referenceBindings = useMemo<ReconstructionReferenceBinding[]>(() => targetKeyframe ? [{
    imageIndex: 1,
    name: '已確認的角色與場景定裝關鍵幀',
    role: 'keyframe',
  }] : [], [targetKeyframe])
  const currentFingerprint = useMemo(() => JSON.stringify({
    analysisResult,
    metadata,
    brief,
    dialogue,
    audioMode,
    durationMode,
    outputDurationSec,
    effectiveModelKey,
    targetKeyframeKey: targetKeyframe?.key ?? null,
    targetKeyframeFingerprint,
  }), [analysisResult, metadata, brief, dialogue, audioMode, durationMode, outputDurationSec, effectiveModelKey, targetKeyframe?.key, targetKeyframeFingerprint])
  const promptIsStale = promptFingerprint !== null && promptFingerprint !== currentFingerprint
  const stageAvailability = getReconstructionStageAvailability({
    hasVideo: Boolean(ctrl.refVideo),
    hasAnalysis: Boolean(analysisResult?.sourceFrame),
    hasCharacterReference: Boolean(characterReference),
    hasKeyframeModel: Boolean(keyframeModel),
  })

  useEffect(() => {
    setControllerOutputType('video')
    setControllerVideoRefMode('omni')
    if (effectiveModelKey && controllerModelKey !== effectiveModelKey) {
      setControllerModelKey(effectiveModelKey)
    }
  }, [effectiveModelKey, controllerModelKey, setControllerModelKey, setControllerOutputType, setControllerVideoRefMode])

  useEffect(() => () => {
    referencePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    referencePreviewUrlsRef.current.clear()
  }, [])
  const generatedRun = ctrl.latestRun?.outputType === 'video' && ctrl.latestRun.id === reconstructionRunId
    ? ctrl.latestRun
    : null
  const generatedUrl = generatedRun?.status === 'succeeded' ? generatedRun.resultUrls?.[0] : null

  async function selectSource(file: File) {
    setError(null)
    try {
      const local = await readLocalMetadata(file)
      if (local.durationSec < REF_VIDEO_MIN_SEC || local.durationSec > REF_VIDEO_MAX_SEC) {
        throw new Error(`影片需介於 ${REF_VIDEO_MIN_SEC}–${REF_VIDEO_MAX_SEC} 秒，目前為 ${local.durationSec.toFixed(1)} 秒`)
      }
      const uploaded = await ctrl.upload.mutateAsync({ file, type: 'video' })
      ctrl.applyUploadedVideoReference({ key: uploaded.key, signedUrl: uploaded.signedUrl })
      const sourceDuration = Math.max(4, Math.min(15, Math.round(local.durationSec)))
      ctrl.setDurationSec(sourceDuration)
      if (effectiveModelKey) ctrl.setModelKey(effectiveModelKey)
      ctrl.setAspectRatio(nearestAspectRatio(local.width, local.height))
      setSourceName(file.name)
      setMetadata(local)
      setAnalysisResult(null)
      setDialogue([])
      setAudioMode(local.durationSec < 4 ? 'generate' : 'preserve-original')
      setDurationMode(local.durationSec < 4 ? '4' : 'source')
      setTargetKeyframe(null)
      setTargetKeyframeFingerprint(null)
      setPromptPreview('')
      setPromptFingerprint(null)
      setReconstructionRunId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '影片上傳失敗')
    }
  }

  async function analyzeSource() {
    if (!ctrl.refVideo) return
    setError(null)
    try {
      const result = await analyze.mutateAsync({ videoKey: ctrl.refVideo.key, locale })
      setAnalysisResult(result)
      setTargetKeyframe(null)
      setTargetKeyframeFingerprint(null)
      setMetadata(result.metadata)
      ctrl.setDurationSec(Math.max(4, Math.min(15, Math.round(result.metadata.durationSec))))
      ctrl.setAspectRatio(nearestAspectRatio(result.metadata.width, result.metadata.height))
      if (!result.metadata.hasAudio || result.metadata.durationSec < 4) setAudioMode('generate')
      if (result.metadata.durationSec < 4) setDurationMode('4')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '鏡頭分析失敗')
    }
  }

  function addDialogue() {
    const endSec = metadata?.durationSec ?? 5
    setDialogue((current) => [...current, {
      id: crypto.randomUUID(),
      speaker: `角色 ${current.length + 1}`,
      startSec: 0,
      endSec,
      text: '',
      emotion: '',
    }])
  }

  function updateDialogue(id: string, patch: Partial<ReconstructionDialogueLine>) {
    setDialogue((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  function selectModel(modelKey: string) {
    setSelectedModelKey(modelKey)
    ctrl.setModelKey(modelKey)
    ctrl.setOutputType('video')
    ctrl.setVideoRefMode('omni')
  }

  function selectDuration(mode: string) {
    setDurationMode(mode)
    const nextDuration = mode === 'source'
      ? Math.max(4, Math.min(15, Math.round(metadata?.durationSec ?? 5)))
      : Number(mode)
    ctrl.setDurationSec(nextDuration)
  }

  async function uploadReference(role: 'character' | 'environment', file: File) {
    setError(null)
    const previewUrl = URL.createObjectURL(file)
    referencePreviewUrlsRef.current.add(previewUrl)
    try {
      const uploaded = await ctrl.upload.mutateAsync({ file, type: 'image' })
      const asset = { key: uploaded.key, signedUrl: uploaded.signedUrl, previewUrl }
      const previousAsset = role === 'character' ? characterReference : sceneReference
      if (previousAsset?.previewUrl) {
        URL.revokeObjectURL(previousAsset.previewUrl)
        referencePreviewUrlsRef.current.delete(previousAsset.previewUrl)
      }
      if (role === 'character') setCharacterReference(asset)
      else setSceneReference(asset)
    } catch (caught) {
      URL.revokeObjectURL(previewUrl)
      referencePreviewUrlsRef.current.delete(previewUrl)
      setError(caught instanceof Error ? caught.message : '參考圖片上傳失敗')
    }
  }

  function removeReference(role: 'character' | 'environment') {
    const currentAsset = role === 'character' ? characterReference : sceneReference
    if (currentAsset?.previewUrl) {
      URL.revokeObjectURL(currentAsset.previewUrl)
      referencePreviewUrlsRef.current.delete(currentAsset.previewUrl)
    }
    if (role === 'character') setCharacterReference(null)
    else setSceneReference(null)
  }

  async function generateTargetKeyframe() {
    if (!analysisResult?.sourceFrame) {
      setError('請先完成原片分析，系統才能取得動作關鍵幀')
      return
    }
    if (!characterReference) {
      setError('請先上傳要套用的新角色圖片')
      return
    }
    const required = [brief.era, brief.location, brief.story, brief.characterDesign, brief.wardrobe, brief.mood, brief.weatherAndTime]
    if (required.some((value) => !value.trim())) {
      setError('請先補齊年代、場景、故事、人物、服裝、時間與影像氣氛，再建立定裝關鍵幀')
      return
    }
    if (!keyframeModel) {
      setError('目前帳號尚未啟用可接收參考圖的 AtlasCloud 圖片模型')
      return
    }

    setError(null)
    setIsGeneratingKeyframe(true)
    try {
      const prompt = buildReconstructionKeyframePrompt({
        analysis: analysisResult.analysis,
        creative: brief,
        hasSceneReference: Boolean(sceneReference),
      })
      const submitted = await keyframeSubmit.mutateAsync({
        prompt,
        referenceImages: [
          analysisResult.sourceFrame.key,
          characterReference.key,
          ...(sceneReference ? [sceneReference.key] : []),
        ],
        outputType: 'image',
        modelKey: keyframeModel.value,
        aspectRatio: nearestAspectRatio(analysisResult.metadata.width, analysisResult.metadata.height),
      })
      const taskResult = await waitForTaskResult(submitted.run.id, {
        intervalMs: 1500,
        timeoutMs: 15 * 60 * 1000,
      })
      const rawKey = Array.isArray(taskResult.resultUrls) && typeof taskResult.resultUrls[0] === 'string'
        ? taskResult.resultUrls[0]
        : null
      if (!rawKey) throw new Error('定裝關鍵幀任務沒有回傳圖片')

      const response = await fetch(`/api/playground/runs/${submitted.run.id}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as { run?: { resultUrls?: string[] | null } } | null
      const signedUrl = payload?.run?.resultUrls?.[0]
      if (!response.ok || !signedUrl) throw new Error('定裝關鍵幀已產生，但無法取得預覽網址')
      setTargetKeyframe({ key: rawKey, signedUrl })
      setTargetKeyframeFingerprint(keyframeInputFingerprint)
      setPromptPreview('')
      setPromptFingerprint(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '定裝關鍵幀生成失敗')
    } finally {
      setIsGeneratingKeyframe(false)
    }
  }

  function validateConfiguration(): string | null {
    if (!analysisResult || !metadata || !ctrl.refVideo) return '請先上傳並完成鏡頭分析'
    if (!effectiveModelKey) return '目前帳號尚未啟用 AtlasCloud Seedance 2.0 R2V，請先到設定中心啟用'
    const required = [brief.era, brief.location, brief.story, brief.characterDesign, brief.wardrobe, brief.mood, brief.weatherAndTime, brief.backgroundMotion]
    if (required.some((value) => !value.trim())) return '重建設定不可留白，請補齊年代、場景、人物與動態背景描述'
    const invalidLine = dialogue.find((line) => !line.text.trim() || line.startSec < 0 || line.endSec <= line.startSec || line.endSec > metadata.durationSec + 0.1)
    if (invalidLine) return '對白內容與時間碼需完整，且不得超過原片長度'
    if (audioMode === 'preserve-original' && durationMode !== 'source') return '保留原始對白音軌時，輸出秒數必須選擇「跟隨原片」'
    if (!Number.isInteger(outputDurationSec) || outputDurationSec < 4 || outputDurationSec > 15) return '輸出秒數需介於 4–15 秒'
    if (!characterReference) return '請先上傳要套用的新角色圖片'
    if (!targetKeyframe) return '請先建立並確認定裝關鍵幀，再生成完整影片'
    if (keyframeIsStale) return '角色、場景或重建設定已變更，請重新建立定裝關鍵幀'
    return null
  }

  function buildPromptPreview() {
    const validationError = validateConfiguration()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!analysisResult || !metadata) return
    const prompt = buildReconstructionPrompt({
      analysis: analysisResult.analysis,
      metadata,
      creative: brief,
      dialogue,
      audioMode,
      strategy: 'keyframe-guided',
      references: referenceBindings,
      outputDurationSec: durationMode === 'source' ? metadata.durationSec : outputDurationSec,
    })
    if (prompt.length > 6000) {
      setError(`重建提示詞為 ${prompt.length} 字，超過 6000 字上限；請縮短創作設定或對白`)
      return
    }
    setError(null)
    setPromptPreview(prompt)
    setPromptFingerprint(currentFingerprint)
    ctrl.setPrompt(prompt)
  }

  async function generate() {
    const validationError = validateConfiguration()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!promptPreview.trim()) {
      setError('請先產出並檢查 Prompt，再確認生成')
      return
    }
    if (promptIsStale) {
      setError('設定已變更，請重新產出 Prompt 後再生成')
      return
    }
    if (promptPreview.length > 6000) {
      setError(`重建提示詞為 ${promptPreview.length} 字，超過 6000 字上限；請精簡後再生成`)
      return
    }
    ctrl.setPrompt(promptPreview)
    ctrl.setModelKey(effectiveModelKey)
    ctrl.setOutputType('video')
    ctrl.setVideoRefMode('omni')
    ctrl.setSoundOn(audioMode === 'generate')
    setError(null)
    const run = await ctrl.handleRun(effectiveModelKey, promptPreview, {
      preserveSourceAudio: audioMode === 'preserve-original',
      preservePromptVerbatim: true,
      // The signed result URL proves this keyframe came through the caller's
      // completed task while avoiding authorization of arbitrary run keys.
      referenceImages: targetKeyframe ? [{ key: targetKeyframe.signedUrl, name: '已確認的角色與場景定裝關鍵幀' }] : [],
    })
    if (run) setReconstructionRunId(run.id)
  }

  return (
    <main className="flex min-h-0 flex-1 overflow-hidden bg-[#07090c]">
      <section className="w-[430px] shrink-0 overflow-y-auto border-r border-white/[0.08] bg-[#090b0f] p-5">
        <div className="mb-5">
          <div className="font-mono text-[10px] tracking-[0.22em] text-cyan-400">LIVE ACTION RECONSTRUCTION</div>
          <h2 className="mt-2 font-serif-cn text-xl font-semibold text-white">實拍重建</h2>
          <p className="mt-2 text-sm leading-6 text-text-tertiary">保留演員表演、原始運鏡與對白節奏，完整改造人物造型與動態環境。</p>
        </div>

        <div className="mb-5 grid grid-cols-5 gap-1.5 text-center text-[11px]">
          {['影片', '設定', '分析', '定裝', '生成'].map((label, index) => {
            const reached = index === 0
              ? Boolean(ctrl.refVideo)
              : index === 1
                ? stageAvailability.showSetup
                : index === 2
                  ? Boolean(analysisResult)
                : index === 3
                  ? Boolean(targetKeyframe && !keyframeIsStale)
                  : Boolean(generatedRun)
            return <div key={label} className={`rounded-lg border px-2 py-2 ${reached ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'border-white/[0.08] text-text-tertiary'}`}>{index + 1} {label}</div>
          })}
        </div>

        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void selectSource(file)
        }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={ctrl.upload.isPending || analyze.isPending || ctrl.isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-50">
          <AppIcon name="upload" className="h-4 w-4" />
          {sourceName ? `更換影片 · ${sourceName}` : '上傳實拍影片（1.8–15 秒，≤150MB）'}
        </button>

        {ctrl.refVideo ? (
          <div className="mt-3 space-y-2">
            <button type="button" onClick={() => void analyzeSource()} disabled={analyze.isPending || ctrl.isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 disabled:opacity-50">
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {analyze.isPending ? 'AI 正在分析運鏡與表演…' : analysisResult ? '重新分析鏡頭（會產生費用）' : '需要時再分析鏡頭（會產生費用）'}
            </button>
            {!analysisResult ? <p className="text-[11px] leading-5 text-text-tertiary">可先填設定、上傳角色與場景圖片，不會產生 AI 分析費；建立定裝關鍵幀前再分析即可。</p> : null}
          </div>
        ) : null}

        {stageAvailability.showSetup ? (
          <div className="mt-5 space-y-5">
            {analysisResult ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-5 text-text-secondary">
                <div className="mb-1 text-cyan-300">分析摘要</div>
                {analysisResult.analysis.summary}
                <div className="mt-2 text-text-tertiary">運鏡：{analysisResult.analysis.camera.movement}</div>
              </div>
            ) : null}

            <ReconstructionBriefForm
              brief={brief}
              onBriefChange={setBrief}
              dialogue={dialogue}
              onAddDialogue={addDialogue}
              onUpdateDialogue={updateDialogue}
              onRemoveDialogue={(id) => setDialogue((current) => current.filter((item) => item.id !== id))}
              audioMode={audioMode}
              onAudioModeChange={setAudioMode}
              hasAudio={Boolean(metadata?.hasAudio)}
            />

            <ReconstructionGenerationControls
              models={reconstructionModels}
              modelKey={effectiveModelKey}
              onModelChange={selectModel}
              durationMode={durationMode}
              sourceDurationSec={metadata?.durationSec ?? 5}
              onDurationChange={selectDuration}
              sourceFrameUrl={analysisResult?.sourceFrame.signedUrl ?? null}
              analysisReady={Boolean(analysisResult?.sourceFrame)}
              characterReference={characterReference}
              sceneReference={sceneReference}
              onReferencePick={uploadReference}
              onRemoveReference={removeReference}
              targetKeyframe={targetKeyframe}
              keyframeIsStale={keyframeIsStale}
              keyframeModelLabel={keyframeModel?.label ?? null}
              onGenerateKeyframe={() => void generateTargetKeyframe()}
              canGenerateKeyframe={stageAvailability.canGenerateKeyframe}
              isGeneratingKeyframe={isGeneratingKeyframe}
              isBusy={ctrl.isBusy || ctrl.isGenerating || isGeneratingKeyframe}
              estimatedUsd={ctrl.costEstimate.data?.amountUsd ?? null}
            />

            {analysisResult ? (
              <ReconstructionPromptReview
                prompt={promptPreview}
                isStale={promptIsStale}
                isBusy={ctrl.isBusy || isGeneratingKeyframe}
                isGenerating={ctrl.isGenerating}
                onBuild={buildPromptPreview}
                onPromptChange={(prompt) => {
                  setPromptPreview(prompt)
                  ctrl.setPrompt(prompt)
                }}
                onGenerate={() => void generate()}
              />
            ) : null}

            {error ? <div role="alert" className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}
          </div>
        ) : error ? <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}
      </section>

      <ReconstructionResultStage
        locale={locale}
        sourceVideoUrl={ctrl.refVideo?.signedUrl ?? null}
        sourceDurationSec={metadata?.durationSec ?? null}
        sourceWidth={metadata?.width ?? null}
        sourceHeight={metadata?.height ?? null}
        generatedRun={generatedRun}
        generatedUrl={generatedUrl ?? null}
        characterReferenceUrl={characterReference?.previewUrl ?? characterReference?.signedUrl ?? null}
        sceneReferenceUrl={sceneReference?.previewUrl ?? sceneReference?.signedUrl ?? null}
      />
    </main>
  )
}
