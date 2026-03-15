'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Character, Location, CharacterAppearance } from '@/types/project'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { SpotlightCharCard, SpotlightLocationCard } from './SpotlightCards'
import type { TaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'
import {
  setsEqual,
  parseAppearanceKey,
  parseLocationNames,
  fuzzyMatchLocationName,
  readTrimmedLabel,
} from './ScriptViewAssetsPanelHelpers'
import { CharacterEditorPopover } from './CharacterEditorPopover'
import { LocationEditorPopover } from './LocationEditorPopover'

interface Clip {
  id: string
  location?: string | null
}

interface ScriptViewAssetsPanelProps {
  clips: Clip[]
  assetViewMode: 'all' | string
  setAssetViewMode: (mode: 'all' | string) => void
  setSelectedClipId: (clipId: string) => void
  characters: Character[]
  locations: Location[]
  activeCharIds: string[]
  activeLocationIds: string[]
  selectedAppearanceKeys: Set<string>
  onUpdateClipAssets: (
    type: 'character' | 'location',
    action: 'add' | 'remove',
    id: string,
    optionLabel?: string,
  ) => Promise<void>
  onOpenAssetLibrary?: () => void
  assetsLoading: boolean
  assetsLoadingState: TaskPresentationState | null
  allAssetsHaveImages: boolean
  globalCharIds: string[]
  globalLocationIds: string[]
  missingAssetsCount: number
  onGenerateStoryboard?: () => void
  isSubmittingStoryboardBuild: boolean
  getSelectedAppearances: (char: Character) => CharacterAppearance[]
  tScript: (key: string, values?: Record<string, unknown>) => string
  tAssets: (key: string, values?: Record<string, unknown>) => string
  tNP: (key: string, values?: Record<string, unknown>) => string
  tCommon: (key: string, values?: Record<string, unknown>) => string
}
export default function ScriptViewAssetsPanel({
  clips,
  assetViewMode,
  setAssetViewMode,
  setSelectedClipId,
  characters,
  locations,
  activeCharIds,
  activeLocationIds,
  selectedAppearanceKeys,
  onUpdateClipAssets,
  onOpenAssetLibrary,
  assetsLoading,
  assetsLoadingState,
  allAssetsHaveImages,
  globalCharIds,
  globalLocationIds,
  missingAssetsCount,
  onGenerateStoryboard,
  isSubmittingStoryboardBuild,
  getSelectedAppearances,
  tScript,
  tAssets,
  tNP,
  tCommon,
}: ScriptViewAssetsPanelProps) {
  const [showAddChar, setShowAddChar] = useState(false)
  const [showAddLoc, setShowAddLoc] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [initialAppearanceKeys, setInitialAppearanceKeys] = useState<Set<string>>(new Set())
  const [pendingAppearanceKeys, setPendingAppearanceKeys] = useState<Set<string>>(new Set())
  const [pendingAppearanceLabels, setPendingAppearanceLabels] = useState<Record<string, string>>({})
  const [pendingLocationIds, setPendingLocationIds] = useState<Set<string>>(new Set())
  const [pendingLocationLabels, setPendingLocationLabels] = useState<Record<string, string>>({})
  const [initialLocationLabels, setInitialLocationLabels] = useState<Record<string, string>>({})
  const [isSavingCharacterSelection, setIsSavingCharacterSelection] = useState(false)
  const [isSavingLocationSelection, setIsSavingLocationSelection] = useState(false)
  const hasInitializedCharDraftRef = useRef(false)
  const hasInitializedLocDraftRef = useRef(false)
  const charEditorTriggerRef = useRef<HTMLButtonElement | null>(null)
  const charEditorPopoverRef = useRef<HTMLDivElement | null>(null)
  const locEditorTriggerRef = useRef<HTMLButtonElement | null>(null)
  const locEditorPopoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!showAddChar) {
      hasInitializedCharDraftRef.current = false
      return
    }
    if (hasInitializedCharDraftRef.current) return
    const nextKeys = new Set(selectedAppearanceKeys)
    const nextLabels: Record<string, string> = {}
    nextKeys.forEach((key) => {
      const parsed = parseAppearanceKey(key)
      if (parsed) {
        nextLabels[key] = parsed.appearanceName
      }
    })

    // 用当前右侧面板实际展示的"已选角色/形象"做兜底，确保编辑弹层能正确显示选中态
    activeCharIds.forEach((characterId) => {
      const character = characters.find((item) => item.id === characterId)
      if (!character) return
      const appearances = getSelectedAppearances(character)
      appearances.forEach((appearance) => {
        const appearanceName = appearance.changeReason || tAssets('character.primary')
        const appearanceKey = `${character.id}::${appearanceName}`
        nextKeys.add(appearanceKey)
        if (!nextLabels[appearanceKey]) {
          nextLabels[appearanceKey] = appearanceName
        }
      })
    })

    const baselineKeys = new Set(nextKeys)
    setInitialAppearanceKeys(baselineKeys)
    setPendingAppearanceKeys(baselineKeys)
    setPendingAppearanceLabels(nextLabels)
    hasInitializedCharDraftRef.current = true
  }, [activeCharIds, characters, getSelectedAppearances, selectedAppearanceKeys, showAddChar, tAssets])

  useEffect(() => {
    if (!showAddLoc) {
      hasInitializedLocDraftRef.current = false
      return
    }
    if (hasInitializedLocDraftRef.current) return
    const nextIds = new Set(activeLocationIds)
    const nextLabels: Record<string, string> = {}

    activeLocationIds.forEach((locationId) => {
      const location = locations.find((item) => item.id === locationId)
      if (location) nextLabels[locationId] = location.name
    })

    if (assetViewMode !== 'all') {
      const currentClip = clips.find((clip) => clip.id === assetViewMode)
      const rawLocationNames = parseLocationNames(currentClip?.location)
      activeLocationIds.forEach((locationId) => {
        const location = locations.find((item) => item.id === locationId)
        if (!location) return
        const matchedRawName = rawLocationNames.find((name) => fuzzyMatchLocationName(name, location.name))
        if (matchedRawName) {
          nextLabels[locationId] = matchedRawName
        }
      })
    }

    setPendingLocationIds(nextIds)
    setPendingLocationLabels(nextLabels)
    setInitialLocationLabels(nextLabels)
    hasInitializedLocDraftRef.current = true
  }, [activeLocationIds, assetViewMode, clips, locations, showAddLoc])

  useEffect(() => {
    if (!showAddChar && !showAddLoc) return

    const handlePointerDownOutside = (event: MouseEvent) => {
      const target = event.target as Node

      if (showAddChar) {
        const isInCharPopover = charEditorPopoverRef.current?.contains(target)
        const isInCharTrigger = charEditorTriggerRef.current?.contains(target)
        if (!isInCharPopover && !isInCharTrigger) {
          setShowAddChar(false)
        }
      }

      if (showAddLoc) {
        const isInLocPopover = locEditorPopoverRef.current?.contains(target)
        const isInLocTrigger = locEditorTriggerRef.current?.contains(target)
        if (!isInLocPopover && !isInLocTrigger) {
          setShowAddLoc(false)
        }
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showAddChar) setShowAddChar(false)
        if (showAddLoc) setShowAddLoc(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDownOutside, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showAddChar, showAddLoc])

  const isAllClipsMode = assetViewMode === 'all'

  const hasCharacterLabelChanges = !isAllClipsMode && Array.from(pendingAppearanceKeys).some((key) => {
    const parsed = parseAppearanceKey(key)
    if (!parsed) return false
    const nextLabel = readTrimmedLabel(pendingAppearanceLabels[key], parsed.appearanceName)
    return nextLabel !== parsed.appearanceName
  })

  const hasLocationLabelChanges = !isAllClipsMode && Array.from(pendingLocationIds).some((locationId) => {
    const location = locations.find((item) => item.id === locationId)
    if (!location) return false
    const baseLabel = initialLocationLabels[locationId] || location.name
    const nextLabel = readTrimmedLabel(pendingLocationLabels[locationId], location.name)
    return nextLabel !== baseLabel
  })

  const hasCharacterSelectionChanges = !setsEqual(initialAppearanceKeys, pendingAppearanceKeys) || hasCharacterLabelChanges
  const hasLocationSelectionChanges = !setsEqual(new Set(activeLocationIds), pendingLocationIds) || hasLocationLabelChanges

  const handleConfirmCharacterSelection = async () => {
    if (isSavingCharacterSelection) return
    setIsSavingCharacterSelection(true)
    try {
      const currentKeys = new Set(initialAppearanceKeys)
      const desiredKeys = new Set<string>()
      const desiredItems: Array<{ characterId: string; appearanceName: string; targetKey: string }> = []

      pendingAppearanceKeys.forEach((rawKey) => {
        const parsed = parseAppearanceKey(rawKey)
        if (!parsed) return
        const appearanceName = isAllClipsMode
          ? parsed.appearanceName
          : readTrimmedLabel(pendingAppearanceLabels[rawKey], parsed.appearanceName)
        const targetKey = `${parsed.characterId}::${appearanceName}`
        if (desiredKeys.has(targetKey)) return
        desiredKeys.add(targetKey)
        desiredItems.push({ characterId: parsed.characterId, appearanceName, targetKey })
      })

      for (const key of currentKeys) {
        if (desiredKeys.has(key)) continue
        const parsed = parseAppearanceKey(key)
        if (!parsed) continue
        await onUpdateClipAssets('character', 'remove', parsed.characterId, parsed.appearanceName)
      }

      for (const item of desiredItems) {
        if (currentKeys.has(item.targetKey)) continue
        await onUpdateClipAssets('character', 'add', item.characterId, item.appearanceName)
      }

      setShowAddChar(false)
    } finally {
      setIsSavingCharacterSelection(false)
    }
  }

  const handleConfirmLocationSelection = async () => {
    if (isSavingLocationSelection) return
    setIsSavingLocationSelection(true)
    try {
      const currentIds = new Set(activeLocationIds)

      for (const locationId of currentIds) {
        if (pendingLocationIds.has(locationId)) continue
        await onUpdateClipAssets('location', 'remove', locationId)
      }

      for (const locationId of pendingLocationIds) {
        const location = locations.find((item) => item.id === locationId)
        if (!location) continue

        const nextLabel = isAllClipsMode
          ? location.name
          : readTrimmedLabel(pendingLocationLabels[locationId], location.name)
        const baseLabel = initialLocationLabels[locationId] || location.name
        const changedLabel = currentIds.has(locationId) && nextLabel !== baseLabel

        if (changedLabel) {
          await onUpdateClipAssets('location', 'remove', locationId)
          await onUpdateClipAssets('location', 'add', locationId, nextLabel)
          continue
        }

        if (!currentIds.has(locationId)) {
          await onUpdateClipAssets('location', 'add', locationId, nextLabel)
        }
      }

      setShowAddLoc(false)
    } finally {
      setIsSavingLocationSelection(false)
    }
  }

  return (
    <div className="col-span-12 lg:col-span-4 flex flex-col min-h-[300px] lg:h-full gap-4">
      <div className="flex flex-col gap-2 px-2">
        <h2 className="text-xl font-bold text-[var(--glass-text-primary)] flex items-center gap-2">
          <span className="w-1.5 h-6 bg-[var(--glass-accent-from)] rounded-full" /> {tScript('inSceneAssets')}
        </h2>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <button
            onClick={() => setAssetViewMode('all')}
            className={`glass-btn-base px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all ${assetViewMode === 'all'
              ? 'glass-btn-primary'
              : 'glass-btn-secondary text-[var(--glass-text-secondary)]'
              }`}
          >
            {tScript('assetView.allClips')}
          </button>
          {clips.map((clip, idx) => (
            <button
              key={clip.id}
              onClick={() => {
                setAssetViewMode(clip.id)
                setSelectedClipId(clip.id)
              }}
              className={`glass-btn-base px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all ${assetViewMode === clip.id
                ? 'glass-btn-primary'
                : 'glass-btn-secondary text-[var(--glass-text-secondary)]'
                }`}
            >
              {tScript('segment.title', { index: idx + 1 })}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 glass-surface-modal overflow-y-auto p-4 custom-scrollbar flex flex-col gap-6">
        {assetsLoading && characters.length === 0 && locations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--glass-text-tertiary)] animate-pulse">
            <TaskStatusInline state={assetsLoadingState} />
          </div>
        )}

        <div className="relative">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[var(--glass-text-secondary)] flex items-center gap-2">
              {tScript('asset.activeCharacters')} ({characters.filter((c) => activeCharIds.includes(c.id)).reduce((sum, char) => sum + getSelectedAppearances(char).length, 0)})
            </h3>
            <button
              ref={charEditorTriggerRef}
              onClick={() => {
                setShowAddChar((prev) => !prev)
                setShowAddLoc(false)
              }}
              className="inline-flex h-8 w-8 items-center justify-center text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-info-fg)] transition-colors"
            >
              <AppIcon name="edit" className="h-4 w-4" />
            </button>
          </div>

          {showAddChar && mounted && createPortal(
            <CharacterEditorPopover
              isAllClipsMode={isAllClipsMode}
              characters={characters}
              pendingAppearanceKeys={pendingAppearanceKeys}
              pendingAppearanceLabels={pendingAppearanceLabels}
              isSavingCharacterSelection={isSavingCharacterSelection}
              hasCharacterSelectionChanges={hasCharacterSelectionChanges}
              setPendingAppearanceKeys={setPendingAppearanceKeys}
              setPendingAppearanceLabels={setPendingAppearanceLabels}
              onCancel={() => setShowAddChar(false)}
              onConfirm={() => void handleConfirmCharacterSelection()}
              tCommon={tCommon}
              tScript={tScript}
              tAssets={tAssets}
              popoverRef={charEditorPopoverRef}
            />,
            document.body,
          )}

          {activeCharIds.length === 0 ? (
            <div className="text-center text-[var(--glass-text-tertiary)] text-sm py-4">{tScript('screenplay.noCharacter')}</div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {characters
                .filter((c) => activeCharIds.includes(c.id))
                .flatMap((char) => {
                  const selectedApps = getSelectedAppearances(char)
                  if (selectedApps.length === 0) {
                    return (
                      <SpotlightCharCard
                        key={`${char.id}-missing`}
                        char={char}
                        appearance={undefined}
                        isActive={true}
                        onClick={() => { }}
                        onOpenAssetLibrary={onOpenAssetLibrary}
                        onRemove={() => void onUpdateClipAssets('character', 'remove', char.id, tScript('asset.defaultAppearance'))}
                      />
                    )
                  }
                  return selectedApps.map((appearance) => (
                    <SpotlightCharCard
                      key={`${char.id}-${appearance.id}`}
                      char={char}
                      appearance={appearance}
                      isActive={true}
                      onClick={() => { }}
                      onOpenAssetLibrary={onOpenAssetLibrary}
                      onRemove={() => void onUpdateClipAssets('character', 'remove', char.id, appearance.changeReason || tScript('asset.defaultAppearance'))}
                    />
                  ))
                })}
            </div>
          )}
        </div>

        <div className="relative">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-[var(--glass-text-secondary)]">{tScript('asset.activeLocations')} ({activeLocationIds.length})</h3>
            <button
              ref={locEditorTriggerRef}
              onClick={() => {
                setShowAddLoc((prev) => !prev)
                setShowAddChar(false)
              }}
              className="inline-flex h-8 w-8 items-center justify-center text-[var(--glass-text-secondary)] hover:text-[var(--glass-tone-info-fg)] transition-colors"
            >
              <AppIcon name="edit" className="h-4 w-4" />
            </button>
          </div>

          {showAddLoc && mounted && createPortal(
            <LocationEditorPopover
              isAllClipsMode={isAllClipsMode}
              locations={locations}
              pendingLocationIds={pendingLocationIds}
              pendingLocationLabels={pendingLocationLabels}
              isSavingLocationSelection={isSavingLocationSelection}
              hasLocationSelectionChanges={hasLocationSelectionChanges}
              setPendingLocationIds={setPendingLocationIds}
              setPendingLocationLabels={setPendingLocationLabels}
              onCancel={() => setShowAddLoc(false)}
              onConfirm={() => void handleConfirmLocationSelection()}
              tCommon={tCommon}
              tScript={tScript}
              popoverRef={locEditorPopoverRef}
            />,
            document.body,
          )}

          {activeLocationIds.length === 0 ? (
            <div className="text-center text-[var(--glass-text-tertiary)] text-sm py-4">{tScript('screenplay.noLocation')}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {locations.filter((l) => activeLocationIds.includes(l.id)).map((loc) => (
                <SpotlightLocationCard
                  key={loc.id}
                  location={loc}
                  isActive={true}
                  onClick={() => { }}
                  onOpenAssetLibrary={onOpenAssetLibrary}
                  onRemove={() => void onUpdateClipAssets('location', 'remove', loc.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 mb-4">
        {!allAssetsHaveImages && globalCharIds.length + globalLocationIds.length > 0 && (
          <div className="mb-3 p-4 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-base)] rounded-2xl shadow-sm">
            <p className="text-sm font-medium text-[var(--glass-text-primary)]">{tScript('generate.missingAssets', { count: missingAssetsCount })}</p>
            <p className="text-xs text-[var(--glass-text-tertiary)] mt-0.5">
              {tScript('generate.missingAssetsTip')}
              <button onClick={onOpenAssetLibrary} className="text-[var(--glass-tone-info-fg)] hover:underline mx-1">
                {tNP('buttons.assetLibrary')}
              </button>
              {tScript('generate.missingAssetsTipLink')}
            </p>
          </div>
        )}
        <button
          onClick={onGenerateStoryboard}
          disabled={isSubmittingStoryboardBuild || clips.length === 0 || !allAssetsHaveImages}
          className="w-full py-4 text-lg font-bold bg-[var(--glass-accent-from)] text-white rounded-2xl"
        >
          {isSubmittingStoryboardBuild ? tScript('generate.generating') : tScript('generate.startGenerate')}
        </button>
      </div>
    </div>
  )
}
