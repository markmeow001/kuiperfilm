'use client'

/**
 * Stage 1 chip rail for the multi-shot B-path bindings.
 *
 * Given the most-recent multi-shot taskId for a group, this component
 * polls task.result.bindings via `useMultiShotTask` and renders a
 * Seedance-style chip strip showing which character appearance and
 * which scene view the worker actually anchored against (Tencent
 * SubjectInfos.N). Read-only in Stage 1 — Stage 2 will turn each
 * chip into an editable affordance that pushes overrides into the
 * next regenerate call.
 *
 * Empty / pre-completion states are intentionally muted so the rail
 * doesn't shout when the user hasn't done anything yet.
 */

import { AppIcon } from '@/components/ui/icons'
import { useMultiShotTask } from '@/lib/query/hooks/useMultiShotTask'

interface MultiShotBindingsRailProps {
  taskId: string | null | undefined
  groupLabel?: string | null
}

export function MultiShotBindingsRail({ taskId, groupLabel }: MultiShotBindingsRailProps) {
  const { data, isLoading } = useMultiShotTask(taskId)

  if (!taskId) return null

  const status = data?.status ?? null
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  const bindings = data?.result?.bindings ?? null
  const characters = bindings?.characters ?? []
  const scenes = bindings?.scenes ?? []
  const hasContent = characters.length > 0 || scenes.length > 0

  return (
    <div className="rounded-sm border border-amber-900/15 bg-stone-900/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-500/70">
          <AppIcon name="sparklesAlt" className="h-3 w-3" />
          多鏡頭綁定
          {groupLabel ? (
            <span className="text-stone-500">· {groupLabel}</span>
          ) : null}
        </div>
        <div className="font-mono text-[9px] tracking-wider">
          {status === 'completed' ? (
            <span className="text-emerald-400/80">已完成</span>
          ) : status === 'failed' ? (
            <span className="text-rose-400/80">失敗</span>
          ) : status === 'queued' || status === 'processing' ? (
            <span className="animate-pulse text-amber-400/80">生成中</span>
          ) : isLoading ? (
            <span className="text-stone-500">載入中</span>
          ) : (
            <span className="text-stone-500">—</span>
          )}
        </div>
      </div>

      {!isTerminal && !hasContent ? (
        <div className="font-serif-cn text-[11px] italic text-stone-500">
          視頻生成完成後會顯示這個多鏡頭實際綁定的角色造型與場景視角。
        </div>
      ) : null}

      {status === 'failed' ? (
        <div className="rounded-sm border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 font-serif-cn text-[11px] text-rose-300">
          {data?.error?.message || data?.errorMessage || '視頻生成失敗 — 重試後綁定才會更新'}
        </div>
      ) : null}

      {hasContent ? (
        <div className="space-y-2">
          {characters.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-stone-500">
                Cast · {characters.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c) => (
                  <div
                    key={c.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/30 bg-stone-950/40 py-0.5 pl-0.5 pr-2"
                    title={`${c.name} · ${c.appearanceLabel ?? '默認造型'}`}
                  >
                    <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span className="font-serif-cn text-[10px] text-stone-200">
                      {c.name}
                    </span>
                    <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                      {c.appearanceLabel ?? '默認造型'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {scenes.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-stone-500">
                Scenes · {scenes.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scenes.map((s) => (
                  <div
                    key={s.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-900/30 bg-stone-950/40 py-0.5 pl-0.5 pr-2"
                    title={`${s.name} · ${s.viewName ?? '主視角'}`}
                  >
                    <div className="relative h-5 w-8 overflow-hidden rounded-sm bg-stone-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.imageUrl}
                        alt={s.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span className="font-serif-cn text-[10px] text-stone-200">
                      {s.name}
                    </span>
                    <span className="font-mono text-[9px] tracking-wider text-amber-500/70">
                      {s.viewName ?? '主視角'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
