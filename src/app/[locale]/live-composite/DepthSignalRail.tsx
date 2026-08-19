'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import styles from './LiveCompositeShell.module.css'

/** 深度影片是 MediaRecorder WebM；此鈕走伺服器 ffmpeg 轉檔給本機播放器。 */
function DepthMp4DownloadButton({ file }: { file: File }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function downloadMp4(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/live-composite/depth-guide/mp4', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'video/webm' },
        body: file,
      })
      if (!response.ok) {
        let message = `轉檔失敗（HTTP ${response.status}）`
        try {
          const parsed = await response.json() as { error?: { message?: string } }
          if (parsed?.error?.message) message = parsed.error.message
        } catch { /* 回應不是 JSON 時沿用預設訊息 */ }
        throw new Error(message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'depth-guide.mp4'
        anchor.click()
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '轉檔失敗，請稍後重試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => { void downloadMp4() }}
        disabled={busy}
        className={styles.signalAction}
      >
        <AppIcon name="download" className="h-3.5 w-3.5" />
        {busy ? '轉檔中…' : '下載 MP4'}
      </button>
      {error ? <span role="alert" className="text-xs text-rose-300">{error}</span> : null}
    </span>
  )
}

export interface DepthSignalRailProps {
  sourceUrl: string | null
  depthUrl: string | null
  resultUrl: string | null
  depthDownloadName?: string
  resultDownloadName?: string
  /** 本機深度影片檔（WebM）；提供時顯示「下載 MP4」伺服器轉檔按鈕。 */
  depthFile?: File | null
}

interface SignalStageProps {
  number: string
  eyebrow: string
  title: string
  description: string
  url: string | null
  tone: 'source' | 'depth' | 'result'
  downloadName?: string
  extraAction?: React.ReactNode
}

function SignalStage({ number, eyebrow, title, description, url, tone, downloadName, extraAction }: SignalStageProps) {
  const toneClass = tone === 'depth'
    ? 'border-cyan-300/30 text-cyan-200'
    : tone === 'result'
      ? 'border-cyan-300/45 text-cyan-100'
      : 'border-white/15 text-stone-300'

  return (
    <article className="min-w-[220px] flex-1">
      <div className="mb-2 flex items-center gap-2">
        <span className={`grid h-6 w-6 place-items-center rounded-full border font-mono text-xs ${toneClass}`}>{number}</span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.12em] text-stone-600">{eyebrow}</div>
          <h3 className="truncate text-sm font-medium text-stone-200">{title}</h3>
        </div>
      </div>
      <div className={`relative aspect-video overflow-hidden rounded-lg border bg-[var(--darkroom-inset)] ${toneClass.split(' ')[0]}`}>
        {url ? (
          <video src={url} controls playsInline preload="metadata" className="h-full w-full bg-black object-contain" aria-label={`${title}預覽`} />
        ) : (
          <div className="absolute inset-0 grid place-items-center overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-30"
              style={{ backgroundImage: 'linear-gradient(135deg, transparent 25%, rgba(255,255,255,0.045) 25%, rgba(255,255,255,0.045) 50%, transparent 50%, transparent 75%, rgba(255,255,255,0.045) 75%)', backgroundSize: '16px 16px' }}
            />
            <span className="relative px-4 text-center text-xs leading-5 text-stone-600">{description}</span>
          </div>
        )}
      </div>
      {url && downloadName ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <a href={url} download={downloadName} className={styles.signalAction}>
            <AppIcon name="download" className="h-3.5 w-3.5" />
            下載{title}
          </a>
          {extraAction}
        </div>
      ) : url ? (
        <p className="mt-2 text-xs leading-5 text-stone-600">{description}</p>
      ) : null}
    </article>
  )
}

export function DepthSignalRail({
  sourceUrl,
  depthUrl,
  resultUrl,
  depthDownloadName = 'depth-guide.webm',
  resultDownloadName = 'ai-rebuild.mp4',
  depthFile = null,
}: DepthSignalRailProps) {
  return (
    <section className={styles.signalRail} aria-labelledby="depth-signal-heading">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium tracking-[0.16em] text-cyan-300">訊號流程</div>
          <h2 id="depth-signal-heading" className="mt-1 text-sm font-semibold text-stone-100">原始表演 → 深度引導 → AI 重建</h2>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-stone-500">比對走位、輪廓與鏡頭節奏；深度畫面不是最後輸出。</p>
      </div>

      <div className={styles.signalScroller}>
        <SignalStage number="01" eyebrow="動態" title="原始表演" description="上傳原片後顯示。" url={sourceUrl} tone="source" />
        <AppIcon name="arrowRight" className="mt-[4.75rem] h-4 w-4 shrink-0 text-stone-700" aria-hidden="true" />
        <SignalStage
          number="02"
          eyebrow="幾何"
          title="深度影片"
          description="本機產生後顯示黑白空間引導。"
          url={depthUrl}
          tone="depth"
          downloadName={depthUrl ? depthDownloadName : undefined}
          extraAction={depthUrl && depthFile ? <DepthMp4DownloadButton file={depthFile} /> : null}
        />
        <AppIcon name="arrowRight" className="mt-[4.75rem] h-4 w-4 shrink-0 text-stone-700" aria-hidden="true" />
        <SignalStage number="03" eyebrow="合成" title="AI 重建" description="確認費用並完成生成後顯示。" url={resultUrl} tone="result" downloadName={resultUrl ? resultDownloadName : undefined} />
      </div>
    </section>
  )
}
