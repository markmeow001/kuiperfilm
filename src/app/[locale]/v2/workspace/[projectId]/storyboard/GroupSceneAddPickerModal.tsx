'use client'

/**
 * Phase V (2026-05-28) — Pick a location from the project roster to
 * apply to the current group's panel.location.
 *
 * Mirrors LocationViewPickerModal's layout but lists the UNUSED
 * roster (locations not already in groupScenes) so users can freely
 * add any project scene to this group — the missing counterpart to
 * the × remove button on the chip.
 */

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface LocationImageLike {
  id: string
  imageIndex?: number
  imageUrl?: string | null
}

interface LocationOption {
  id: string
  name: string
  images?: LocationImageLike[]
}

interface GroupSceneAddPickerModalProps {
  open: boolean
  onClose: () => void
  candidates: LocationOption[]
  onSelect: (locationId: string) => void
}

export function GroupSceneAddPickerModal({
  open,
  onClose,
  candidates,
  onSelect,
}: GroupSceneAddPickerModalProps) {
  const [query, setQuery] = useState<string>('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const lower = query.trim().toLowerCase()
  const filtered = lower
    ? candidates.filter((l) => l.name.toLowerCase().includes(lower))
    : candidates

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-sm border border-emerald-900/30 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-emerald-900/20 bg-stone-950/40 px-5 py-3">
          <div>
            <div className="font-mono text-[14px] uppercase tracking-wider text-emerald-500/70">
              加场景
            </div>
            <div className="mt-0.5 font-serif-cn text-[14px] text-stone-400">
              从专案场景库中选一个加进这组
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 transition-colors hover:text-stone-200"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-stone-800/60 bg-stone-950/30 px-5 py-2.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索场景..."
            autoFocus
            className="w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-1.5 font-serif-cn text-[14px] text-stone-200 outline-none placeholder:text-stone-600 focus:border-emerald-500/40"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <p className="py-6 text-center font-serif-cn text-sm italic text-stone-500">
              {candidates.length === 0
                ? '该专案所有场景已加入这组'
                : '没有匹配的场景'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((l) => {
                const primary =
                  l.images?.find((i) => (i.imageIndex ?? 0) === 0) ??
                  l.images?.[0] ??
                  null
                const avatar = primary?.imageUrl ?? null
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(l.id)}
                      className="flex w-full items-center gap-3 rounded-sm border border-transparent bg-stone-950/30 px-3 py-2 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10"
                    >
                      <div className="relative h-9 w-14 flex-shrink-0 overflow-hidden rounded-sm bg-stone-800">
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar}
                            alt={l.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <AppIcon
                            name="image"
                            className="m-auto h-4 w-4 text-stone-600"
                          />
                        )}
                      </div>
                      <span className="flex-1 text-left font-serif-cn text-[14px] text-stone-200">
                        {l.name}
                      </span>
                      <span className="font-mono text-[12px] uppercase tracking-wider text-emerald-500/60">
                        + 加入
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
