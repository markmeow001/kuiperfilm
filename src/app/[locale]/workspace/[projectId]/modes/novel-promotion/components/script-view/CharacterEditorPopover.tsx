'use client'

import type { Character } from '@/types/project'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { getAppearancePreviewUrl } from './ScriptViewAssetsPanelHelpers'

interface CharacterEditorPopoverProps {
  isAllClipsMode: boolean
  characters: Character[]
  pendingAppearanceKeys: Set<string>
  pendingAppearanceLabels: Record<string, string>
  isSavingCharacterSelection: boolean
  hasCharacterSelectionChanges: boolean
  setPendingAppearanceKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setPendingAppearanceLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onCancel: () => void
  onConfirm: () => void
  tCommon: (key: string, values?: Record<string, unknown>) => string
  tScript: (key: string, values?: Record<string, unknown>) => string
  tAssets: (key: string, values?: Record<string, unknown>) => string
  popoverRef: React.RefObject<HTMLDivElement | null>
}

export function CharacterEditorPopover({
  isAllClipsMode,
  characters,
  pendingAppearanceKeys,
  pendingAppearanceLabels,
  isSavingCharacterSelection,
  hasCharacterSelectionChanges,
  setPendingAppearanceKeys,
  setPendingAppearanceLabels,
  onCancel,
  onConfirm,
  tCommon,
  tScript,
  tAssets,
  popoverRef,
}: CharacterEditorPopoverProps) {
  return (
    <div
      ref={popoverRef}
      className="fixed right-4 bottom-4 z-[80] glass-surface-modal w-[min(24rem,calc(100vw-2rem))] h-[min(560px,calc(100vh-2rem))] p-3 animate-fadeIn flex flex-col shadow-2xl"
    >
      <div className="shrink-0 text-xs text-[var(--glass-text-tertiary)]">
        {tCommon('edit')} · {tScript('asset.activeCharacters')}
      </div>
      <div className="mt-3 flex-1 min-h-0 space-y-4 overflow-y-auto pr-1 custom-scrollbar">
        {isAllClipsMode && (
          <div className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]/40 p-2 text-[11px] text-[var(--glass-text-tertiary)]">
            当前为"全部片段"视图，文案要求仅在单片段视图可编辑
          </div>
        )}
        {characters.map((c) => {
          const appearances = c.appearances || []
          const sortedAppearances = [...appearances].sort((a, b) => a.appearanceIndex - b.appearanceIndex)
          return (
            <div key={c.id} className="space-y-2">
              <div className="text-xs font-semibold text-[var(--glass-text-primary)]">{c.name}</div>
              <div className="grid grid-cols-3 gap-2">
                {sortedAppearances.map((appearance) => {
                  const currentAppearanceName = appearance.changeReason || tAssets('character.primary')
                  const appearanceKey = `${c.id}::${currentAppearanceName}`
                  const isThisAppearanceSelected = pendingAppearanceKeys.has(appearanceKey)
                  const previewUrl = getAppearancePreviewUrl(appearance)
                  return (
                    <div key={`${c.id}-${appearance.appearanceIndex}`} className="space-y-1">
                      <button
                        onClick={() => {
                          setPendingAppearanceKeys((prev) => {
                            const next = new Set(prev)
                            if (isThisAppearanceSelected) {
                              next.delete(appearanceKey)
                            } else {
                              next.add(appearanceKey)
                            }
                            return next
                          })
                          setPendingAppearanceLabels((prev) => {
                            const next = { ...prev }
                            if (isThisAppearanceSelected) {
                              delete next[appearanceKey]
                            } else if (!next[appearanceKey]) {
                              next[appearanceKey] = currentAppearanceName
                            }
                            return next
                          })
                        }}
                        className={`relative w-full rounded-lg overflow-hidden border-2 ${isThisAppearanceSelected ? 'border-[var(--glass-stroke-success)]' : 'border-transparent hover:border-[var(--glass-stroke-focus)]'}`}
                      >
                        <div className="aspect-square bg-[var(--glass-bg-muted)]">
                          {previewUrl ? (
                            <MediaImageWithLoading
                              src={previewUrl}
                              alt={`${c.name}-${currentAppearanceName}`}
                              containerClassName="h-full w-full"
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                        </div>
                        {isThisAppearanceSelected && (
                          <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--glass-tone-success-fg)] text-white shadow-md">
                            <AppIcon name="checkMicro" className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                      {isThisAppearanceSelected && (
                        <input
                          value={pendingAppearanceLabels[appearanceKey] || currentAppearanceName}
                          disabled={isAllClipsMode}
                          onChange={(event) => {
                            const value = event.target.value
                            setPendingAppearanceLabels((prev) => ({ ...prev, [appearanceKey]: value }))
                          }}
                          className="w-full rounded border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1 text-xs text-[var(--glass-text-secondary)] outline-none focus:border-[var(--glass-stroke-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--glass-stroke-base)] pt-3">
        <button
          onClick={onCancel}
          disabled={isSavingCharacterSelection}
          className="glass-btn-base glass-btn-secondary rounded-lg px-3 py-1.5 text-xs text-[var(--glass-text-secondary)]"
        >
          {tCommon('cancel')}
        </button>
        <button
          onClick={onConfirm}
          disabled={isSavingCharacterSelection || !hasCharacterSelectionChanges}
          className="glass-btn-base glass-btn-primary rounded-lg px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tCommon('confirm')}
        </button>
      </div>
    </div>
  )
}
