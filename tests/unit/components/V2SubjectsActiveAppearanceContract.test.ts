import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx',
  'utf8',
)
const panelSource = readFileSync(
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel.tsx',
  'utf8',
)
const recoverySource = readFileSync(
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearanceRecoveryModal.tsx',
  'utf8',
)

describe('V2 Subjects active episode appearance wiring', () => {
  it('[episode binds appearance B] -> every character image operation receives the resolved appearance, never appearances[0]', () => {
    expect(source).not.toMatch(/appearances\??\.\[0\]/)
    expect(source).not.toMatch(/appearances\[0\]/)

    expect(source).toContain('appearanceId: appearance.id, imageIndex: 0')
    expect(source).toContain('{ appearanceId: appearance.id }')
    expect(source).toContain('appearanceId: resolution.appearance.id')
    expect(source).toContain('pickCharacterAppearanceImage(appearance)')
    expect(source).toContain('arkTargetId: appearanceId || null')
  })

  it('[binding unresolved or viewer access] -> removes every character mutation callback', () => {
    for (const callback of [
      'onRegenerate',
      'onLock',
      'onUpload',
      'onEditDescription',
      'onDescriptionSave',
      'onRedescribe',
    ]) {
      expect(source).toMatch(
        new RegExp(`${callback}: canEdit[\\s\\S]{0,100}resolution\\.status === 'resolved'`),
      )
    }
    expect(source).toContain('characterMutationsBlocked')
    expect(source).toContain("getActiveAppearanceResolution(character).status !== 'resolved'")
    expect(source).toContain('episodeBindingsQuery.isPending || episodeBindingsQuery.isFetching')
  })

  it('[no appearance] -> permits only the appearance-creation recovery entry point', () => {
    expect(source).toContain(
      "resolution.status === 'resolved' || resolution.status === 'no-appearance'",
    )
    expect(source).toContain('<V2CharacterAppearanceRecoveryModal')
    expect(recoverySource).toContain('activeAppearanceId=""')
  })

  it('[edit modal opens] -> receives the current episode and exact resolved appearance', () => {
    expect(source).toContain('currentEpisodeId={currentEpisodeId}')
    expect(source).toContain('activeAppearance={ap}')
    expect(source).toContain('activeAppearanceSource={resolution.source}')
    expect(source).toContain('onRegenerate={() => handleRegenChar(c, ap)}')
    expect(source).toContain('onUploadFile={(file) => handleUploadChar(c, ap, file)}')
    expect(source).toContain('onRedescribe={() => handleRedescribe(ap)}')
  })

  it('[new appearance from an episode] -> forwards only the current episode id to the create contract', () => {
    expect(panelSource).toContain('currentEpisodeId: string | null')
    expect(panelSource).toContain('episodeId: currentEpisodeId ?? undefined')
  })
})
