'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { usePlaygroundCostEstimate, usePlaygroundRuns, useSubmitPlaygroundRun } from '@/lib/query/mutations/playground-mutations'
import { closestBackgroundAspectRatio, downloadGeneratedBackground } from './lib/background-generation'
import type { VideoMetadata } from './live-composite-types'

interface BackgroundGeneratorPanelProps {
  metadata: VideoMetadata | null
  disabled: boolean
  onGenerated: (file: File) => void
}

export function BackgroundGeneratorPanel({ metadata, disabled, onGenerated }: BackgroundGeneratorPanelProps) {
  const modelsQuery = useUserModels()
  const submit = useSubmitPlaygroundRun()
  const runsQuery = usePlaygroundRuns(null, 50)
  const [prompt, setPrompt] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [runId, setRunId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const applyingRunRef = useRef<string | null>(null)
  const appliedRunIdsRef = useRef(new Set<string>())
  const onGeneratedRef = useRef(onGenerated)
  const imageModels = useMemo(() => modelsQuery.data?.image ?? [], [modelsQuery.data])
  const run = runId ? runsQuery.data?.runs.find((candidate) => candidate.id === runId) ?? null : null
  const aspectRatio = closestBackgroundAspectRatio(metadata?.width, metadata?.height)
  const estimate = usePlaygroundCostEstimate({ modelKey, outputType: 'image' })
  const busy = submit.isPending || run?.status === 'pending' || run?.status === 'running' || applying

  useEffect(() => {
    onGeneratedRef.current = onGenerated
  }, [onGenerated])

  useEffect(() => {
    if (imageModels.length === 0) {
      setModelKey('')
      return
    }
    if (!imageModels.some((model) => model.value === modelKey)) setModelKey(imageModels[0].value)
  }, [imageModels, modelKey])

  useEffect(() => {
    if (!runId || !run) return
    if (run.status === 'failed') {
      setMessage(run.errorMessage || 'AI 背景生成失敗')
      return
    }
    const resultUrl = run.resultUrls?.[0]
    if (run.status === 'succeeded' && !resultUrl) {
      setMessage('AI 背景任務已完成，但沒有回傳圖片。')
      return
    }
    if (run.status !== 'succeeded' || !resultUrl || applyingRunRef.current === runId || appliedRunIdsRef.current.has(runId)) return
    applyingRunRef.current = runId
    setApplying(true)
    const controller = new AbortController()
    let active = true
    void downloadGeneratedBackground(resultUrl, controller.signal)
      .then((file) => {
        if (!active) return
        appliedRunIdsRef.current.add(runId)
        onGeneratedRef.current(file)
        setMessage('背景已生成並套用；儲存專案時會一併保存。')
      })
      .catch((error: unknown) => {
        if (!active) return
        setMessage(error instanceof Error ? error.message : '生成背景套用失敗')
      })
      .finally(() => {
        if (applyingRunRef.current === runId) applyingRunRef.current = null
        if (active) setApplying(false)
      })
    return () => {
      active = false
      controller.abort()
      if (applyingRunRef.current === runId) applyingRunRef.current = null
    }
  }, [run, runId])

  const generate = async () => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      setMessage('請先描述要生成的背景。')
      return
    }
    if (!modelKey) {
      setMessage('目前沒有已啟用的圖片生成模型，請先到設定中心啟用。')
      return
    }
    setMessage('正在建立 AI 背景生成任務…')
    try {
      const result = await submit.mutateAsync({
        prompt: `${trimmedPrompt}\n只生成乾淨的場景背景，不要人物、文字、浮水印或邊框。`,
        outputType: 'image',
        modelKey,
        aspectRatio,
      })
      setRunId(result.run.id)
      setMessage('背景生成中；完成後會自動套用。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 背景生成任務建立失敗')
    }
  }

  const costLabel = estimate.data?.amountUsd == null ? '費用依模型' : `預估 US$${estimate.data.amountUsd.toFixed(3)}`

  return (
    <section className="border-b border-white/10 px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">AI 生成背景</div>
        <span className="font-mono text-[10px] text-stone-600">{aspectRatio}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-stone-500">描述空景；完成後會直接成為目前合成背景，不會改動原始影片。</p>
      <textarea
        aria-label="AI 背景描述"
        value={prompt}
        disabled={disabled || busy}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="例如：深夜東京巷口，雨後濕地反射霓虹，電影感，無人物"
        className="mt-3 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-stone-200 outline-none placeholder:text-stone-700 focus:border-cyan-400/40 disabled:opacity-50"
      />
      <select
        aria-label="AI 背景模型"
        value={modelKey}
        disabled={disabled || busy || imageModels.length === 0}
        onChange={(event) => setModelKey(event.target.value)}
        className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-stone-300"
      >
        {imageModels.length === 0 ? <option value="">沒有已啟用模型</option> : imageModels.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
      </select>
      <button
        type="button"
        disabled={disabled || busy || !modelKey}
        onClick={() => void generate()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-medium text-stone-950 hover:bg-cyan-300 disabled:opacity-40"
      >
        <AppIcon name="sparkles" className="h-4 w-4" />{busy ? '生成背景中…' : '生成並套用背景'}
      </button>
      <div className="mt-2 flex items-start justify-between gap-3 text-[10px] leading-4 text-stone-600"><span role="status">{message}</span><span className="shrink-0">{costLabel}</span></div>
    </section>
  )
}
