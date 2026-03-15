'use client'

import type { Location } from '@/types/project'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { getSelectedLocationImage } from './SpotlightCards'

interface LocationEditorPopoverProps {
  isAllClipsMode: boolean
  locations: Location[]
  pendingLocationIds: Set<string>
  pendingLocationLabels: Record<string, string>
  isSavingLocationSelection: boolean
  hasLocationSelectionChanges: boolean
  setPendingLocationIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setPendingLocationLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onCancel: () => void
  onConfirm: () => void
  tCommon: (key: string, values?: Record<string, unknown>) => string
  tScript: (key: string, values?: Record<string, unknown>) => string
  popoverRef: React.RefObject<HTMLDivElement | null>
}

export function LocationEditorPopover({
  isAllClipsMode,
  locations,
  pendingLocationIds,
  pendingLocationLabels,
  isSavingLocationSelection,
  hasLocationSelectionChanges,
  setPendingLocationIds,
  setPendingLocationLabels,
  onCancel,
  onConfirm,
  tCommon,
  tScript,
  popoverRef,
}: LocationEditorPopoverProps) {
  return (
    <div
      ref={popoverRef}
      className="fixed right-4 bottom-4 z-[80] glass-surface-modal w-[min(24rem,calc(100vw-2rem))] h-[min(560px,calc(100vh-2rem))] p-3 animate-fadeIn flex flex-col shadow-2xl"
    >
      <div className="shrink-0 text-xs text-[var(--glass-text-tertiary)]">
        {tCommon('edit')} · {tScript('asset.activeLocations')}
      </div>
      <div className="mt-3 flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
        {isAllClipsMode && (
          <div className="mb-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]/40 p-2 text-[11px] text-[var(--glass-text-tertiary)]">
            当前为"全部片段"视图，场景文案要求仅在单片段视图可编辑
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {locations.map((location) => {
            const isSelected = pendingLocationIds.has(location.id)
            const previewImage = getSelectedLocationImage(location)?.imageUrl || null
            return (
              <div key={location.id} className="space-y-1">
                <button
                  onClick={() => {
                    setPendingLocationIds((prev) => {
                      const next = new Set(prev)
                      if (isSelected) {
                        next.delete(location.id)
                      } else {
                        next.add(location.id)
                      }
                      return next
                    })
                    setPendingLocationLabels((prev) => {
                      const next = { ...prev }
                      if (isSelected) {
                        delete next[location.id]
                      } else if (!next[location.id]) {
                        next[location.id] = location.name
                      }
                      return next
                    })
                  }}
                  className={`relative w-full overflow-hidden rounded-lg border-2 text-left transition-colors ${isSelected ? 'border-[var(--glass-stroke-success)]' : 'border-transparent hover:border-[var(--glass-stroke-focus)]'}`}
                >
                  <div className="aspect-video bg-[var(--glass-bg-muted)]">
                    {previewImage ? (
                      <MediaImageWithLoading
                        src={previewImage}
                        alt={location.name}
                        containerClassName="h-full w-full"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="truncate px-2 py-1 text-xs font-medium text-[var(--glass-text-secondary)]">
                    {location.name}
                  </div>
                  {isSelected && (
                    <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-tone-success-fg)] text-white shadow-md">
                      <AppIcon name="checkMicro" className="h-3 w-3" />
                    </span>
                  )}
                </button>
                {isSelected && (
                  <input
                    value={pendingLocationLabels[location.id] || location.name}
                    disabled={isAllClipsMode}
                    onChange={(event) => {
                      const value = event.target.value
                      setPendingLocationLabels((prev) => ({ ...prev, [location.id]: value }))
                    }}
                    className="w-full rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1 text-xs text-[var(--glass-text-secondary)] outline-none focus:border-[var(--glass-stroke-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--glass-stroke-base)] pt-3">
        <button
          onClick={onCancel}
          disabled={isSavingLocationSelection}
          className="glass-btn-base glass-btn-secondary rounded-lg px-3 py-1.5 text-xs text-[var(--glass-text-secondary)]"
        >
          {tCommon('cancel')}
        </button>
        <button
          onClick={onConfirm}
          disabled={isSavingLocationSelection || !hasLocationSelectionChanges}
          className="glass-btn-base glass-btn-primary rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tCommon('confirm')}
        </button>
      </div>
    </div>
  )
}
