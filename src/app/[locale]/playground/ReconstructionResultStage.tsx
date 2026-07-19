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
  characterReferenceUrl: string | null
  sceneReferenceUrl: string | null
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
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_55%),rgba(255,255,255,0.015)]">
            {props.generatedUrl ? <video src={props.generatedUrl} controls playsInline className="max-h-full max-w-full" /> : props.generatedRun && props.generatedRun.status !== 'failed' ? <div className="animate-pulse text-sm text-cyan-300">正在保留運鏡、表演與時間關係…</div> : props.characterReferenceUrl ? (
              <div className="w-full max-w-lg p-5 text-center">
                <div className={`mx-auto grid max-w-sm gap-3 ${props.sceneReferenceUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <ReferencePreview src={props.characterReferenceUrl} label="新角色參考已上傳" />
                  {props.sceneReferenceUrl ? <ReferencePreview src={props.sceneReferenceUrl} label="新場景參考已上傳" /> : null}
                </div>
                <div className="mt-4 text-sm font-medium text-emerald-200">參考圖片已就緒</div>
                <p className="mt-1 text-xs leading-5 text-text-tertiary">這不是生成結果。完成鏡頭分析並建立定裝關鍵幀後，預覽會顯示在這裡。</p>
              </div>
            ) : <div className="max-w-md px-6 text-center text-sm leading-6 text-text-tertiary">上傳新角色圖片後，這裡會先顯示參考圖；完成設定後才會產生重建影片。</div>}
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

function ReferencePreview(props: { src: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-black/20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.src} alt={props.label} className="aspect-[4/5] w-full object-cover" />
      <div className="px-2 py-2 text-[11px] text-emerald-200">✓ {props.label}</div>
    </div>
  )
}
