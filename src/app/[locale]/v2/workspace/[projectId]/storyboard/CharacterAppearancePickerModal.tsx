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
      className="kuiper-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="kuiper-modal-surface w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-primary-900/20 bg-canvas/40 px-5 py-3">
          <div>
            <div className="font-mono text-[14px] uppercase tracking-wider text-primary-500/70">
              換造型
            </div>
            <div className="mt-0.5 font-fraunces text-base italic text-primary-300">
              {character.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-tertiary transition-colors hover:text-text-primary"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {appearances.length === 0 ? (
            <p className="font-serif-cn text-sm italic text-text-tertiary">
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
                        ? 'border-primary-500/60 ring-2 ring-primary-500/30'
                        : 'border-border-soft hover:border-primary-500/40'
                    }`}
                  >
                    <div className="relative aspect-[3/4] overflow-hidden bg-canvas">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.imageUrl}
                          alt={label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-text-tertiary">
                          <AppIcon name="image" className="h-6 w-6" />
                        </div>
                      )}
                      {isCurrent ? (
                        <div className="absolute right-1.5 top-1.5 rounded bg-primary-500/90 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-canvas">
                          當前
                        </div>
                      ) : null}
                    </div>
                    <div className="bg-raised/80 px-2 py-1.5">
                      <div className="font-serif-cn text-xs text-text-primary">{label}</div>
                      {a.description ? (
                        <div className="mt-0.5 line-clamp-1 font-mono text-[12px] tracking-wider text-text-tertiary">
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

        <footer className="flex items-center justify-between border-t border-primary-900/20 bg-canvas/40 px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              onClose()
            }}
            className="font-mono text-[14px] tracking-wider text-text-tertiary transition-colors hover:text-primary-400"
          >
            還原預設(讓 worker 自己挑主造型)
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-soft px-3 py-1 font-mono text-[14px] tracking-wider text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  )
}
