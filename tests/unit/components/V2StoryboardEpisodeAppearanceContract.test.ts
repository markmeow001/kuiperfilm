import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const client = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx')
const inspector = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineInspector.tsx')
const groupCard = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/GroupCard.tsx')
const timeline = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardTimelineView.tsx')
const gallery = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGalleryView.tsx')
const groups = read('src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardGroupsView.tsx')

describe('V2 Storyboard episode appearance handoff contract', () => {
  it('[binding query is unresolved] -> never collapses cached or missing state into an empty binding list', () => {
    expect(client).not.toContain('const episodeBindings = episodeBindingsQuery.data ?? []')
    expect(client).toContain('episodeBindingsQuery.error || projectAssetsQuery.error')
    expect(client).toContain('episodeBindingsQuery.isPending || episodeBindingsQuery.isFetching')
    expect(client).toContain('<StoryboardEpisodeAppearanceNotice')
    expect(client).toContain('void episodeBindingsQuery.refetch()')
    expect(client).toContain('void projectAssetsQuery.refetch()')
  })

  it('[episode binds B] -> Timeline and Groups resolve the canonical episode appearance, never appearances[0]', () => {
    expect(inspector).not.toMatch(/appearances\[0\]/)
    expect(groupCard).not.toMatch(/appearances\[0\]/)
    expect(inspector).toContain('resolveActiveCharacterAppearance')
    expect(groupCard).toContain('resolveActiveCharacterAppearance')
    expect(client).toContain('characterRoster={storyboardAppearance.characterRoster}')
  })

  it('[appearance gate is blocked] -> every layout removes dependent generation and group-binding actions', () => {
    expect(client).toContain('if (!storyboardAppearance.canGenerate) return')
    expect(timeline).toContain('appearanceGenerationBlocked={props.appearanceGenerationBlocked}')
    expect(gallery).toContain('appearanceGenerationBlocked')
    expect(groups).toContain('appearanceGenerationBlocked')
    expect(groups).toContain('const canUseEpisodeAppearances = canEdit && !appearanceGenerationBlocked')
  })

  it('[group sends character overrides] -> payload derives appearance IDs from the canonical episode resolution', () => {
    expect(groupCard).toContain('canonicalAppearanceIdByCharacterId')
    expect(groupCard).toContain('appearanceId: canonicalAppearanceId')
    expect(groupCard).not.toContain('appearanceId === null ? { characterId } : { characterId, appearanceId }')
  })
})
