'use client'

import type { DepthRebuildReferenceMappingView } from './depth-rebuild-ui-types'

interface DepthReferenceBudgetProps {
  characterCount: number
  sceneCount: number
  used: number
  reserved: number
  max: number
  mappings: readonly DepthRebuildReferenceMappingView[]
}

export function DepthReferenceBudget({
  characterCount,
  sceneCount,
  used,
  reserved,
  max,
  mappings,
}: DepthReferenceBudgetProps) {
  return (
    <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-cyan-100">Seedance 參考片匣</p>
          <p className="mt-1 text-[11px] text-stone-500">
            人物 {characterCount} 張 · 場景 {sceneCount} 張
          </p>
          {reserved > used ? (
            <p className="mt-1 text-[10px] text-amber-200/70">
              另為 {reserved - used} 位待上傳角色預留位置
            </p>
          ) : null}
        </div>
        <span className={`font-mono text-sm ${used >= max ? 'text-amber-200' : 'text-cyan-200'}`}>
          {used}/{max}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-9 gap-1" aria-label={`已使用 ${used} / ${max} 張參考圖片`}>
        {Array.from({ length: max }, (_, index) => {
          const mapping = index < mappings.length ? mappings[index] : undefined
          const kind = mapping?.kind ?? 'empty'
          const pending = Boolean(mapping && !mapping.ready)
          return (
            <span
              key={`reference-slot-${index + 1}`}
              title={`image ${index + 1}${
                kind === 'empty'
                  ? '（空位）'
                  : kind === 'character'
                    ? pending ? '（人物待上傳）' : '（人物）'
                    : '（場景）'
              }`}
              className={`h-5 rounded-[3px] border ${
                kind === 'character' && pending
                  ? 'border-dashed border-cyan-200/45 bg-cyan-300/[0.08]'
                  : kind === 'character'
                  ? 'border-cyan-200/55 bg-cyan-300/35'
                  : kind === 'scene'
                    ? 'border-stone-400/45 bg-stone-300/20'
                    : 'border-white/10 bg-black/25'
              }`}
            />
          )
        })}
      </div>

      {mappings.length > 0 ? (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3">
          {mappings.map((mapping) => (
            <div key={mapping.id} className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-stone-500">{mapping.token}</span>
              <span className={mapping.kind === 'character' ? 'text-cyan-200' : 'text-stone-300'}>
                →
              </span>
              <span className={`truncate ${mapping.ready ? 'text-stone-300' : 'text-stone-500'}`}>
                {mapping.label}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 border-t border-white/10 pt-3 text-[11px] text-stone-500">
          上傳圖片後，這裡會顯示 image 1–9 的實際順序。
        </p>
      )}
    </div>
  )
}
