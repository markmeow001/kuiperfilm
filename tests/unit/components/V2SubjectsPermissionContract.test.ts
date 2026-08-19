import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
  'utf8',
)
const zhMessages = JSON.parse(readFileSync('messages/zh/v2Subjects.json', 'utf8')) as {
  card: { lockedTitle: string }
}
const enMessages = JSON.parse(readFileSync('messages/en/v2Subjects.json', 'utf8')) as {
  card: { lockedTitle: string; lockTitle: string }
}

describe('V2 subjects viewer permission contract', () => {
  it('removes every entity editor entry point when canEdit is false', () => {
    expect(source.match(/onOpenEditor: canEdit/g)).toHaveLength(3)
    expect(source).toMatch(
      /onOpenEditor: canEdit && \(\s*resolution\.status === 'resolved' \|\| resolution\.status === 'no-appearance'/,
    )
    expect(source).toContain('{canEdit && editingCharacterId ?')
    expect(source).toContain('{canEdit && editingLocationId ?')
    expect(source).toContain('{canEdit && editingPropId ?')
  })

  it('guards modal creation and mutation handlers with current access', () => {
    expect(source).toContain("{canEdit && manualAddOpen === 'character' ?")
    expect(source).toContain("{canEdit && manualAddOpen === 'scene' ?")
    expect(source).toContain("{canEdit && manualAddOpen === 'prop' ?")

    for (const handler of [
      'handleRegenChar',
      'handleRegenLoc',
      'handleSaveCharacterName',
      'handleSaveIntroduction',
      'handleUploadChar',
      'handleUploadLoc',
      'handleUploadProp',
      'handleDeleteCharacterFromModal',
      'handleDeletePropFromModal',
    ]) {
      expect(source).toMatch(new RegExp(`function ${handler}\\([^)]*\\) \\{\\n\\s+if \\(!canEdit\\) return`))
    }
  })

  it('角色定稿使用同步 endpoint，並以 characterId 隔離 pending 與 error', () => {
    expect(source).toContain('useFinalizeProjectCharacterVisual')
    expect(source).not.toContain('useConfirmProjectCharacterProfile')
    expect(source).toContain('finalizingCharacterIds.has(character.id)')
    expect(source).toContain('finalizeErrors.get(character.id)')
    expect(source).toContain('appearanceId: appearance.id')
  })

  it('誠實說明定稿是 project-level character state，不偽裝成逐造型核准', () => {
    expect(zhMessages.card.lockedTitle).toContain('專案層級')
    expect(zhMessages.card.lockedTitle).toContain('集數綁定')
    expect(enMessages.card.lockedTitle).toContain('project level')
    expect(enMessages.card.lockTitle).toContain('does not create an appearance-version approval')
  })

  it('集數造型背景更新期間封鎖舊 cache 的 mutation target', () => {
    expect(source).toContain('episodeBindingsQuery.isPending || episodeBindingsQuery.isFetching')
  })
})
