'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import { buildReconstructionPrompt } from '@/lib/playground/reconstruction-prompt'
import type {
  ReconstructionAnalysisResult,
  ReconstructionAudioMode,
  ReconstructionCreativeBrief,
  ReconstructionDialogueLine,
  ReconstructionVideoMetadata,
} from '@/lib/playground/reconstruction-contract'
import { useAnalyzePlaygroundVideo } from '@/lib/query/mutations/playground-mutations'
import type { PlaygroundController } from './usePlaygroundController'
import { REF_VIDEO_MAX_SEC, REF_VIDEO_MIN_SEC } from './usePlaygroundController'

interface ReconstructionStudioProps {
  ctrl: PlaygroundController
  locale: string
}

const DEFAULT_BRIEF: ReconstructionCreativeBrief = {
  era: '1930 年代民國',
  location: '上海法租界街道與老式商行',
  story: '人物在動盪年代執行一場帶有危機感的秘密行動',
  characterDesign: '電影寫實的民國人物，真實皮膚、自然五官與符合年代的髮型',
  wardrobe: '考據準確的民國服裝、鞋履、髮妝與配件，布料隨動作自然擺動',
  mood: '寫實電影質感，克制、緊張、有敘事性的光影',
  weatherAndTime: '陰天午後，空氣略帶霧氣',
  backgroundMotion: '路人、旗幟、車輛、煙霧與光影保持細微且連續的運動，絕非靜態照片',
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

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  const className = 'w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400/60'
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-text-secondary">{props.label}</span>
      {props.multiline ? (
        <textarea className={`${className} min-h-20 resize-y`} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input className={className} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      )}
    </label>
  )
}

export function ReconstructionStudio({ ctrl, locale }: ReconstructionStudioProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const analyze = useAnalyzePlaygroundVideo()
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<ReconstructionVideoMetadata | null>(null)
  const [analysisResult, setAnalysisResult] = useState<ReconstructionAnalysisResult | null>(null)
  const [brief, setBrief] = useState<ReconstructionCreativeBrief>(DEFAULT_BRIEF)
  const [dialogue, setDialogue] = useState<ReconstructionDialogueLine[]>([])
  const [audioMode, setAudioMode] = useState<ReconstructionAudioMode>('preserve-original')
  const [error, setError] = useState<string | null>(null)
  const [reconstructionRunId, setReconstructionRunId] = useState<string | null>(null)

  const seedanceModel = useMemo(() => (
    ctrl.videoModels.find((model) => model.value === 'atlascloud::seedance-2.0-r2v')
    ?? ctrl.videoModels.find((model) => /^atlascloud::seedance-2\.0-(?:fast-)?r2v$/.test(model.value))
  ), [ctrl.videoModels])
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
      ctrl.setDurationSec(Math.max(4, Math.min(15, Math.round(local.durationSec))))
      ctrl.setAspectRatio(nearestAspectRatio(local.width, local.height))
      setSourceName(file.name)
      setMetadata(local)
      setAnalysisResult(null)
      setDialogue([])
      setAudioMode('preserve-original')
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
      setMetadata(result.metadata)
      ctrl.setDurationSec(Math.max(4, Math.min(15, Math.round(result.metadata.durationSec))))
      ctrl.setAspectRatio(nearestAspectRatio(result.metadata.width, result.metadata.height))
      if (!result.metadata.hasAudio) setAudioMode('generate')
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

  async function generate() {
    if (!analysisResult || !metadata || !ctrl.refVideo) {
      setError('請先上傳並完成鏡頭分析')
      return
    }
    if (!seedanceModel) {
      setError('目前帳號尚未啟用 AtlasCloud Seedance 2.0 R2V，請先到設定中心啟用')
      return
    }
    const required = [brief.era, brief.location, brief.story, brief.characterDesign, brief.wardrobe, brief.mood, brief.weatherAndTime, brief.backgroundMotion]
    if (required.some((value) => !value.trim())) {
      setError('重建設定不可留白，請補齊年代、場景、人物與動態背景描述')
      return
    }
    const invalidLine = dialogue.find((line) => !line.text.trim() || line.startSec < 0 || line.endSec <= line.startSec || line.endSec > metadata.durationSec + 0.1)
    if (invalidLine) {
      setError('對白內容與時間碼需完整，且不得超過原片長度')
      return
    }
    const prompt = buildReconstructionPrompt({
      analysis: analysisResult.analysis,
      metadata,
      creative: brief,
      dialogue,
      audioMode,
    })
    if (prompt.length > 6000) {
      setError(`重建提示詞為 ${prompt.length} 字，超過 6000 字上限；請縮短創作設定或對白`)
      return
    }
    ctrl.setPrompt(prompt)
    ctrl.setModelKey(seedanceModel.value)
    ctrl.setOutputType('video')
    ctrl.setVideoRefMode('omni')
    ctrl.setSoundOn(audioMode === 'generate')
    setError(null)
    const run = await ctrl.handleRun(seedanceModel.value, prompt, {
      preserveSourceAudio: audioMode === 'preserve-original',
      preservePromptVerbatim: true,
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

        <div className="mb-5 grid grid-cols-4 gap-2 text-center text-xs">
          {['影片', '分析', '設定', '生成'].map((label, index) => {
            const reached = index === 0 ? Boolean(ctrl.refVideo) : index === 1 ? Boolean(analysisResult) : index === 2 ? Boolean(analysisResult) : Boolean(generatedRun)
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
          <button type="button" onClick={() => void analyzeSource()} disabled={analyze.isPending || ctrl.isGenerating} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 disabled:opacity-50">
            <AppIcon name="sparklesAlt" className="h-4 w-4" />
            {analyze.isPending ? 'AI 正在分析運鏡與表演…' : analysisResult ? '重新分析鏡頭' : 'AI 分析鏡頭'}
          </button>
        ) : null}

        {analysisResult ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-5 text-text-secondary">
              <div className="mb-1 text-cyan-300">分析摘要</div>
              {analysisResult.analysis.summary}
              <div className="mt-2 text-text-tertiary">運鏡：{analysisResult.analysis.camera.movement}</div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium text-white">重建設定</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="年代" value={brief.era} onChange={(era) => setBrief((current) => ({ ...current, era }))} />
                <Field label="時間／天氣" value={brief.weatherAndTime} onChange={(weatherAndTime) => setBrief((current) => ({ ...current, weatherAndTime }))} />
              </div>
              <Field label="新場景" value={brief.location} onChange={(location) => setBrief((current) => ({ ...current, location }))} />
              <Field label="故事情境" value={brief.story} multiline onChange={(story) => setBrief((current) => ({ ...current, story }))} />
              <Field label="新人物設計" value={brief.characterDesign} multiline onChange={(characterDesign) => setBrief((current) => ({ ...current, characterDesign }))} />
              <Field label="服裝／髮妝／特效妝" value={brief.wardrobe} multiline onChange={(wardrobe) => setBrief((current) => ({ ...current, wardrobe }))} />
              <Field label="影像氣氛" value={brief.mood} onChange={(mood) => setBrief((current) => ({ ...current, mood }))} />
              <Field label="背景如何持續運動" value={brief.backgroundMotion} multiline onChange={(backgroundMotion) => setBrief((current) => ({ ...current, backgroundMotion }))} />
              <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={brief.replacePeople} onChange={(event) => setBrief((current) => ({ ...current, replacePeople: event.target.checked }))} className="accent-cyan-400" />完整替換原演員外觀，只保留表情、情緒與動作</label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="text-sm font-medium text-white">對白契約</div><button type="button" onClick={addDialogue} className="text-xs text-cyan-300 hover:text-cyan-200">＋ 新增對白</button></div>
              <p className="text-xs leading-5 text-text-tertiary">AI 不會從抽幀猜台詞。可輸入逐句對白供模型理解；選擇保留原音時，輸出會重新封裝原片音軌，確保台詞不被改寫。</p>
              {dialogue.map((line) => (
                <div key={line.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
                  <div className="grid grid-cols-[1fr_72px_72px_auto] gap-2">
                    <input aria-label="說話者" value={line.speaker} onChange={(event) => updateDialogue(line.id, { speaker: event.target.value })} className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
                    <input aria-label="開始秒數" type="number" min="0" step="0.1" value={line.startSec} onChange={(event) => updateDialogue(line.id, { startSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
                    <input aria-label="結束秒數" type="number" min="0" step="0.1" value={line.endSec} onChange={(event) => updateDialogue(line.id, { endSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
                    <button type="button" aria-label="刪除對白" onClick={() => setDialogue((current) => current.filter((item) => item.id !== line.id))} className="text-text-tertiary hover:text-red-300">×</button>
                  </div>
                  <textarea aria-label="對白內容" placeholder="逐字輸入原本對白" value={line.text} onChange={(event) => updateDialogue(line.id, { text: event.target.value })} className="min-h-16 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm" />
                  <input aria-label="說話情緒" placeholder="情緒與語氣，例如：壓低聲音、焦急但克制" value={line.emotion} onChange={(event) => updateDialogue(line.id, { emotion: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={!metadata?.hasAudio} onClick={() => setAudioMode('preserve-original')} className={`rounded-xl border px-3 py-2.5 text-xs ${audioMode === 'preserve-original' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-text-tertiary'} disabled:opacity-40`}>保留原始對白音軌</button>
                <button type="button" onClick={() => setAudioMode('generate')} className={`rounded-xl border px-3 py-2.5 text-xs ${audioMode === 'generate' ? 'border-violet-400/50 bg-violet-400/10 text-violet-200' : 'border-white/10 text-text-tertiary'}`}>讓模型生成聲音</button>
              </div>
            </div>

            {error ? <div role="alert" className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}
            <button type="button" onClick={() => void generate()} disabled={ctrl.isBusy || ctrl.isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-400 px-4 py-3.5 text-sm font-semibold text-black disabled:opacity-50">
              <AppIcon name="sparkles" className="h-4 w-4" />
              {ctrl.isGenerating ? 'Seedance 2.0 重建中…' : '生成實拍重建影片'}
            </button>
          </div>
        ) : error ? <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}
      </section>

      <section className="flex min-w-0 flex-1 flex-col p-5">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/[0.08] bg-black/30 p-3">
            <div className="mb-3 flex items-center justify-between text-sm"><span className="text-white">原始表演參考</span>{metadata ? <span className="font-mono text-xs text-text-tertiary">{metadata.durationSec.toFixed(1)}s · {metadata.width}×{metadata.height}</span> : null}</div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
              {ctrl.refVideo ? <video src={ctrl.refVideo.signedUrl} controls playsInline className="max-h-full max-w-full" /> : <div className="text-center text-sm text-text-tertiary">上傳影片後，這裡會顯示原始鏡頭</div>}
            </div>
          </div>
          <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/[0.08] bg-black/30 p-3">
            <div className="mb-3 flex items-center justify-between text-sm"><span className="text-white">重建結果</span><span className="text-xs text-text-tertiary">AtlasCloud · Seedance 2.0 R2V</span></div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
              {generatedUrl ? <video src={generatedUrl} controls playsInline className="max-h-full max-w-full" /> : generatedRun && generatedRun.status !== 'failed' ? <div className="animate-pulse text-sm text-cyan-300">正在保留運鏡、表演與時間關係…</div> : <div className="max-w-md text-center text-sm leading-6 text-text-tertiary">AI 分析不是最後輸出。完成設定後，系統會把鏡頭語言、演員表演、逐句對白、新人物與動態背景整理成固定契約再送給模型。</div>}
            </div>
          </div>
        </div>
        {generatedUrl && generatedRun ? (
          <div className="mt-4 flex items-center justify-end gap-3">
            <Link href={`/${locale}/live-composite?sourceRunId=${encodeURIComponent(generatedRun.id)}`} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-text-secondary hover:border-cyan-400/40 hover:text-white">送到專業合成修邊</Link>
            <a href={generatedUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black">開啟結果</a>
          </div>
        ) : null}
      </section>
    </main>
  )
}
