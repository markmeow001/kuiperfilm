'use client'

import Link from 'next/link'
import type { PlaygroundRun } from './usePlaygroundController'

interface ReconstructionResultStageProps {
  locale: string
  sourceVideoUrl: string | null
  sourceDurationSec: number | null
  sourceWidth: number | null
  sourceHeight: number | null
  generatedRun: PlaygroundRun | null
  generatedUrl: string | null
}

export function ReconstructionResultStage(props: ReconstructionResultStageProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col p-5">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/[0.08] bg-black/30 p-3">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-white">原始表演參考</span>
            {props.sourceDurationSec !== null && props.sourceWidth !== null && props.sourceHeight !== null ? (
              <span className="font-mono text-xs text-text-tertiary">{props.sourceDurationSec.toFixed(1)}s · {props.sourceWidth}×{props.sourceHeight}</span>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
            {props.sourceVideoUrl ? <video src={props.sourceVideoUrl} controls playsInline className="max-h-full max-w-full" /> : <div className="text-center text-sm text-text-tertiary">上傳影片後，這裡會顯示原始鏡頭</div>}
          </div>
        </div>
        <div className="flex min-h-[320px] flex-col rounded-2xl border border-white/[0.08] bg-black/30 p-3">
          <div className="mb-3 flex items-center justify-between text-sm"><span className="text-white">重建結果</span><span className="text-xs text-text-tertiary">AtlasCloud · Seedance 2.0 R2V</span></div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
            {props.generatedUrl ? <video src={props.generatedUrl} controls playsInline className="max-h-full max-w-full" /> : props.generatedRun && props.generatedRun.status !== 'failed' ? <div className="animate-pulse text-sm text-cyan-300">正在保留運鏡、表演與時間關係…</div> : <div className="max-w-md text-center text-sm leading-6 text-text-tertiary">AI 分析不是最後輸出。完成設定後，系統會把鏡頭語言、演員表演、逐句對白、新人物與動態背景整理成固定契約再送給模型。</div>}
          </div>
        </div>
      </div>
      {props.generatedUrl && props.generatedRun ? (
        <div className="mt-4 flex items-center justify-end gap-3">
          <Link href={`/${props.locale}/live-composite?sourceRunId=${encodeURIComponent(props.generatedRun.id)}`} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-text-secondary hover:border-cyan-400/40 hover:text-white">送到專業合成修邊</Link>
          <a href={props.generatedUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black">開啟結果</a>
        </div>
      ) : null}
    </section>
  )
}
