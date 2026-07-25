'use client'

import { AppIcon } from '@/components/ui/icons'

export interface DepthSignalRailProps {
  sourceUrl: string | null
  depthUrl: string | null
  resultUrl: string | null
  depthDownloadName?: string
  resultDownloadName?: string
}

interface SignalStageProps {
  number: string
  eyebrow: string
  title: string
  description: string
  url: string | null
  tone: 'source' | 'depth' | 'result'
  downloadName?: string
}

function SignalStage({ number, eyebrow, title, description, url, tone, downloadName }: SignalStageProps) {
  const toneClass = tone === 'depth'
    ? 'border-cyan-300/30 text-cyan-200'
    : tone === 'result'
      ? 'border-violet-300/30 text-violet-200'
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
      <div className={`relative aspect-video overflow-hidden rounded-lg border bg-[#0d1218] ${toneClass.split(' ')[0]}`}>
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
        <a href={url} download={downloadName} className="mt-2 inline-flex items-center gap-1.5 text-xs text-stone-400 underline decoration-stone-700 underline-offset-4 hover:text-white">
          <AppIcon name="download" className="h-3.5 w-3.5" />
          下載{title}
        </a>
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
}: DepthSignalRailProps) {
  return (
    <section className="border-t border-white/10 bg-[#080b0f] px-4 py-4" aria-labelledby="depth-signal-heading">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-cyan-300">Signal path</div>
          <h2 id="depth-signal-heading" className="mt-1 text-sm font-semibold text-stone-100">原始表演 → 深度引導 → AI 重建</h2>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-stone-500">比對走位、輪廓與鏡頭節奏；深度畫面不是最後輸出。</p>
      </div>

      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        <SignalStage number="01" eyebrow="Motion" title="原始表演" description="上傳原片後顯示。" url={sourceUrl} tone="source" />
        <AppIcon name="arrowRight" className="mt-[4.75rem] h-4 w-4 shrink-0 text-stone-700" aria-hidden="true" />
        <SignalStage number="02" eyebrow="Geometry" title="深度影片" description="本機產生後顯示黑白空間引導。" url={depthUrl} tone="depth" downloadName={depthUrl ? depthDownloadName : undefined} />
        <AppIcon name="arrowRight" className="mt-[4.75rem] h-4 w-4 shrink-0 text-stone-700" aria-hidden="true" />
        <SignalStage number="03" eyebrow="Synthesis" title="AI 重建" description="確認費用並完成生成後顯示。" url={resultUrl} tone="result" downloadName={resultUrl ? resultDownloadName : undefined} />
      </div>
    </section>
  )
}
