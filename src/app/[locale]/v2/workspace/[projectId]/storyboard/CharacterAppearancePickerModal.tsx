'use client'

/**
 * Phase 12.5.4 commit 3 — appearance picker for the multi-shot
 * chip rail.
 *
 * The user clicks a character chip ("CATHERINE 默認造型") and this
 * modal lists every CharacterAppearance with a thumbnail + label
 * (CharacterAppearance.changeReason), letting them pick which
 * appearance to anchor SubjectInfos.N to for the next regenerate.
 *
 * Selection is returned via `onSelect(appearanceId | null)` —
 * passing `null` reverts to the default (worker picks main
 * appearance).
 */

import { useEffect } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface AppearanceLike {
  id: string
  appearanceIndex?: number
  changeReason?: string | null
  description?: string | null
  imageUrl?: string | null
}

interface CharacterLike {
  id: string
  name: string
  appearances?: AppearanceLike[]
}

interface CharacterAppearancePickerModalProps {
  open: boolean
  onClose: () => void
  character: CharacterLike | null
  currentAppearanceId: string | null
  onSelect: (appearanceId: string | null) => void
}

export function CharacterAppearancePickerModal({
  open,
  onClose,
  character,
  currentAppearanceId,
  onSelect,
}: CharacterAppearancePickerModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !character) return null
  const appearances = character.appearances ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-sm border border-amber-900/30 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-amber-900/20 bg-stone-950/40 px-5 py-3">
          <div>
            <div className="font-mono text-[14px] uppercase tracking-wider text-amber-500/70">
              換造型
            </div>
            <div className="mt-0.5 font-fraunces text-base italic text-amber-300">
              {character.name}
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

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {appearances.length === 0 ? (
            <p className="font-serif-cn text-sm italic text-stone-500">
              這個角色目前只有一個造型 — 沒有其他 appearance 可選。先到「劇本拆解」分頁加入新造型。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {appearances.map((a, idx) => {
                const label = a.changeReason || `造型 ${idx + 1}`
                const isCurrent = a.id === currentAppearanceId
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onSelect(a.id)
                      onClose()
                    }}
                    className={`group relative overflow-hidden rounded-sm border text-left transition-all ${
                      isCurrent
                        ? 'border-amber-500/60 ring-2 ring-amber-500/30'
                        : 'border-stone-800 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="relative aspect-[3/4] overflow-hidden bg-stone-950">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.imageUrl}
                          alt={label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-stone-600">
                          <AppIcon name="image" className="h-6 w-6" />
                        </div>
                      )}
                      {isCurrent ? (
                        <div className="absolute right-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-stone-950">
                          當前
                        </div>
                      ) : null}
                    </div>
                    <div className="bg-stone-900/80 px-2 py-1.5">
                      <div className="font-serif-cn text-xs text-stone-200">{label}</div>
                      {a.description ? (
                        <div className="mt-0.5 line-clamp-1 font-mono text-[12px] tracking-wider text-stone-500">
                          {a.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-amber-900/20 bg-stone-950/40 px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              onClose()
            }}
            className="font-mono text-[14px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
          >
            還原預設(讓 worker 自己挑主造型)
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-800 px-3 py-1 font-mono text-[14px] tracking-wider text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  )
}
