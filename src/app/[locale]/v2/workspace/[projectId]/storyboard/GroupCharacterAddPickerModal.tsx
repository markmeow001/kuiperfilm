'use client'

/**
 * Phase V (2026-05-28) — Pick a character from the project roster to
 * append into the current group's panel.characters.
 *
 * Mirrors CharacterAppearancePickerModal's layout but lists the
 * UNUSED roster (characters not already in groupCast) so users can
 * freely add any project character to this group — the missing
 * counterpart to the × remove button on the chip.
 */

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface AppearanceLike {
  id: string
  imageUrl?: string | null
}

interface CharacterOption {
  id: string
  name: string
  appearances?: AppearanceLike[]
}

interface GroupCharacterAddPickerModalProps {
  open: boolean
  onClose: () => void
  candidates: CharacterOption[]
  onSelect: (characterId: string) => void
}

export function GroupCharacterAddPickerModal({
  open,
  onClose,
  candidates,
  onSelect,
}: GroupCharacterAddPickerModalProps) {
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
    ? candidates.filter((c) => c.name.toLowerCase().includes(lower))
    : candidates

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
              加角色
            </div>
            <div className="mt-0.5 font-serif-cn text-[14px] text-text-secondary">
              从专案角色库中选一位加进这组
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

        <div className="border-b border-border-soft/60 bg-canvas/30 px-5 py-2.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色..."
            autoFocus
            className="w-full rounded-sm border border-border-soft bg-raised px-3 py-1.5 font-serif-cn text-[14px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary-500/40"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <p className="py-6 text-center font-serif-cn text-sm italic text-text-tertiary">
              {candidates.length === 0
                ? '该专案所有角色已加入这组'
                : '没有匹配的角色'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((c) => {
                const avatar = c.appearances?.[0]?.imageUrl ?? null
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="flex w-full items-center gap-3 rounded-sm border border-transparent bg-canvas/30 px-3 py-2 transition-colors hover:border-primary-500/40 hover:bg-primary-500/10"
                    >
                      <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-overlay">
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar}
                            alt={c.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <AppIcon
                            name="user"
                            className="m-auto h-4 w-4 text-text-tertiary"
                          />
                        )}
                      </div>
                      <span className="flex-1 text-left font-serif-cn text-[14px] text-text-primary">
                        {c.name}
                      </span>
                      <span className="font-mono text-[12px] uppercase tracking-wider text-primary-500/60">
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
