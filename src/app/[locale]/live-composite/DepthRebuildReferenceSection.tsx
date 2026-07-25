'use client'

import { AppIcon } from '@/components/ui/icons'
import { DepthCharacterReferenceCard } from './DepthCharacterReferenceCard'
import { DepthReferenceBudget } from './DepthReferenceBudget'
import { DepthSceneReferenceGallery } from './DepthSceneReferenceGallery'
import type {
  DepthRebuildCharacterView,
  DepthRebuildReferenceMappingView,
  DepthRebuildSceneView,
} from './depth-rebuild-ui-types'

interface DepthRebuildReferenceSectionProps {
  characters: readonly DepthRebuildCharacterView[]
  scenes: readonly DepthRebuildSceneView[]
  sceneBrief: string
  sceneDescription: string
  used: number
  max: number
  assistTarget: string | null
  controlsDisabled: boolean
  onAddCharacter: () => void
  onRemoveCharacter: (characterId: string) => void
  onCharacterSelect: (characterId: string, file: File) => void
  onCharacterPreviewError: (characterId: string) => void
  onRemoveCharacterImage: (characterId: string) => void
  onCharacterLabelChange: (characterId: string, value: string) => void
  onCharacterSourceBindingChange: (characterId: string, value: string) => void
  onCharacterBriefChange: (characterId: string, value: string) => void
  onCharacterDescriptionChange: (characterId: string, value: string) => void
  onAssistCharacter: (characterId: string) => void
  onAddSceneImages: (files: readonly File[]) => void
  onRemoveSceneImage: (sceneId: string) => void
  onScenePreviewError: (sceneId: string) => void
  onSceneNoteChange: (sceneId: string, value: string) => void
  onSceneBriefChange: (value: string) => void
  onSceneDescriptionChange: (value: string) => void
  onAssistScene: () => void
}

export function DepthRebuildReferenceSection({
  characters,
  scenes,
  sceneBrief,
  sceneDescription,
  used,
  max,
  assistTarget,
  controlsDisabled,
  onAddCharacter,
  onRemoveCharacter,
  onCharacterSelect,
  onCharacterPreviewError,
  onRemoveCharacterImage,
  onCharacterLabelChange,
  onCharacterSourceBindingChange,
  onCharacterBriefChange,
  onCharacterDescriptionChange,
  onAssistCharacter,
  onAddSceneImages,
  onRemoveSceneImage,
  onScenePreviewError,
  onSceneNoteChange,
  onSceneBriefChange,
  onSceneDescriptionChange,
  onAssistScene,
}: DepthRebuildReferenceSectionProps) {
  const characterImageCount = characters.filter((character) => character.reference).length
  const mappings: DepthRebuildReferenceMappingView[] = []
  let imageOrdinal = 1
  for (const character of characters) {
    mappings.push({
      id: `map-character-${character.id}`,
      token: `image ${imageOrdinal}`,
      label: `${character.label || '未命名角色'} → ${character.sourceBinding || '尚未指定原片人物'}${
        character.reference ? '' : '（待上傳）'
      }`,
      kind: 'character',
      ready: Boolean(character.reference),
    })
    imageOrdinal += 1
  }
  for (const [index, scene] of scenes.entries()) {
    mappings.push({
      id: `map-scene-${scene.id}`,
      token: `image ${imageOrdinal}`,
      label: scene.note.trim() || `場景參考 ${index + 1}`,
      kind: 'scene',
      ready: true,
    })
    imageOrdinal += 1
  }
  const reserved = characters.length + scenes.length
  const limitReached = reserved >= max

  return (
    <div className="space-y-4">
      <DepthReferenceBudget
        characterCount={characterImageCount}
        sceneCount={scenes.length}
        used={used}
        reserved={reserved}
        max={max}
        mappings={mappings}
      />

      <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.035] px-3 py-2 text-[11px] leading-5 text-amber-100/75">
        多人是依 image 順序與「要替換原片中的誰」做文字對應；Seedance 沒有硬性人物追蹤，交疊或快速交叉時仍可能混淆。
      </div>

      <div className="space-y-3">
        {characters.map((character, index) => (
          <DepthCharacterReferenceCard
            key={character.id}
            character={character}
            ordinal={index + 1}
            canRemove={characters.length > 1}
            controlsDisabled={controlsDisabled}
            assistBusy={assistTarget === `character:${character.id}`}
            onSelectImage={(file) => onCharacterSelect(character.id, file)}
            onPreviewError={() => onCharacterPreviewError(character.id)}
            onRemoveImage={() => onRemoveCharacterImage(character.id)}
            onRemoveCharacter={() => onRemoveCharacter(character.id)}
            onLabelChange={(value) => onCharacterLabelChange(character.id, value)}
            onSourceBindingChange={(value) => onCharacterSourceBindingChange(character.id, value)}
            onBriefChange={(value) => onCharacterBriefChange(character.id, value)}
            onDescriptionChange={(value) => onCharacterDescriptionChange(character.id, value)}
            onAssist={() => onAssistCharacter(character.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAddCharacter}
        disabled={controlsDisabled || limitReached || characters.length >= max}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.045] text-sm text-cyan-100 hover:bg-cyan-300/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-stone-600"
      >
        <AppIcon name="plus" className="h-4 w-4" />
        新增另一位角色
      </button>

      <DepthSceneReferenceGallery
        scenes={scenes}
        brief={sceneBrief}
        description={sceneDescription}
        uploadDisabled={limitReached}
        controlsDisabled={controlsDisabled}
        assistBusy={assistTarget === 'scene'}
        onAddImages={onAddSceneImages}
        onRemoveImage={onRemoveSceneImage}
        onPreviewError={onScenePreviewError}
        onNoteChange={onSceneNoteChange}
        onBriefChange={onSceneBriefChange}
        onDescriptionChange={onSceneDescriptionChange}
        onAssist={onAssistScene}
      />

      {limitReached ? (
        <p role="status" className="text-center text-xs text-amber-200">
          {max} 個參考位置已分配完畢；待上傳的角色圖仍可補上，要新增其他素材請先移除一個角色或場景。
        </p>
      ) : null}
    </div>
  )
}
