import { describe, expect, it } from 'vitest'
import {
  buildProjectGraphProjection,
  paginateProjectGraphEpisodes,
} from '@/lib/project-graph/projection'
import type {
  ProjectGraphSource,
  ProjectGraphSourceEpisode,
} from '@/lib/project-graph/types'

const date = (day: number): Date => new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`)

function episode(
  input: Partial<ProjectGraphSourceEpisode> & Pick<ProjectGraphSourceEpisode, 'id'>,
): ProjectGraphSourceEpisode {
  return {
    id: input.id,
    episodeNumber: input.episodeNumber ?? 1,
    name: input.name ?? input.id,
    updatedAt: input.updatedAt ?? date(1),
    clips: input.clips ?? [],
  }
}

function source(episodes: readonly ProjectGraphSourceEpisode[]): ProjectGraphSource {
  return {
    project: {
      id: 'project-1',
      name: 'Project One',
      updatedAt: date(1),
    },
    episodes,
  }
}

describe('buildProjectGraphProjection', () => {
  it('projects domain nodes with actual Prisma source types and only real FK edges', () => {
    const graph = buildProjectGraphProjection(
      source([
        episode({
          id: 'episode-1',
          episodeNumber: 1,
          clips: [
            {
              id: 'clip-1',
              summary: 'Opening scene',
              start: 0,
              updatedAt: date(2),
              storyboard: {
                id: 'storyboard-1',
                episodeId: 'episode-1',
                panelCount: 1,
                updatedAt: date(3),
                panels: [
                  {
                    id: 'panel-1',
                    panelIndex: 0,
                    panelNumber: 1,
                    shotType: 'medium',
                    imageMediaId: 'media-image-1',
                    videoMediaId: null,
                    characters: null,
                    location: null,
                    updatedAt: date(4),
                  },
                ],
              },
            },
          ],
        }),
      ]),
    )

    expect(graph.nodes.map(({ kind, sourceType }) => ({ kind, sourceType }))).toEqual([
      { kind: 'project', sourceType: 'Project' },
      { kind: 'episode', sourceType: 'NovelPromotionEpisode' },
      { kind: 'scene', sourceType: 'NovelPromotionClip' },
      { kind: 'storyboard', sourceType: 'NovelPromotionStoryboard' },
      { kind: 'shot', sourceType: 'NovelPromotionPanel' },
    ])
    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: 'project:project-1',
        to: 'episode:episode-1',
        sourceRelation:
          'NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId',
      }),
      expect.objectContaining({
        from: 'episode:episode-1',
        to: 'scene:clip-1',
        sourceRelation: 'NovelPromotionClip.episodeId',
      }),
      expect.objectContaining({
        from: 'scene:clip-1',
        to: 'storyboard:storyboard-1',
        sourceRelation: 'NovelPromotionStoryboard.clipId',
      }),
      expect.objectContaining({
        from: 'storyboard:storyboard-1',
        to: 'shot:panel-1',
        sourceRelation: 'NovelPromotionPanel.storyboardId',
      }),
    ])
    const storyboardNode = graph.nodes.find((node) => node.kind === 'storyboard')
    expect(storyboardNode?.label).toBe('Opening scene')
    expect(storyboardNode?.label).not.toContain('storyboard-1')
  })

  it('sorts episodes, clips, and panels deterministically without mutating input', () => {
    const episodes = [
      episode({ id: 'episode-b', episodeNumber: 2 }),
      episode({
        id: 'episode-a',
        episodeNumber: 1,
        clips: [
          {
            id: 'clip-z',
            summary: 'Later',
            start: 20,
            updatedAt: date(2),
            storyboard: null,
          },
          {
            id: 'clip-a',
            summary: 'Earlier',
            start: 10,
            updatedAt: date(2),
            storyboard: {
              id: 'storyboard-a',
              episodeId: 'episode-a',
              panelCount: 2,
              updatedAt: date(2),
              panels: [
                {
                  id: 'panel-b',
                  panelIndex: 1,
                  panelNumber: 2,
                  shotType: null,
                  imageMediaId: null,
                  videoMediaId: null,
                  characters: null,
                  location: null,
                  updatedAt: date(2),
                },
                {
                  id: 'panel-a',
                  panelIndex: 0,
                  panelNumber: 1,
                  shotType: null,
                  imageMediaId: null,
                  videoMediaId: null,
                  characters: null,
                  location: null,
                  updatedAt: date(2),
                },
              ],
            },
          },
        ],
      }),
    ]
    const before = JSON.stringify(episodes)

    const graph = buildProjectGraphProjection(source(episodes))

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'project:project-1',
      'episode:episode-a',
      'scene:clip-a',
      'storyboard:storyboard-a',
      'shot:panel-a',
      'shot:panel-b',
      'scene:clip-z',
      'episode:episode-b',
    ])
    expect(JSON.stringify(episodes)).toBe(before)
  })

  it('warns only when legacy media lacks a MediaObject pointer and text refs remain unresolved', () => {
    const graph = buildProjectGraphProjection(
      source([
        episode({
          id: 'episode-1',
          clips: [
            {
              id: 'clip-1',
              summary: 'Scene',
              updatedAt: date(1),
              storyboard: {
                id: 'storyboard-1',
                episodeId: 'episode-1',
                panelCount: 2,
                updatedAt: date(1),
                panels: [
                  {
                    id: 'panel-warning',
                    panelIndex: 0,
                    panelNumber: 1,
                    shotType: null,
                    imageUrl: 'https://legacy/image.png',
                    imageMediaId: null,
                    videoUrl: 'https://legacy/video.mp4',
                    videoMediaId: null,
                    characters: '["A"]',
                    location: 'Studio',
                    updatedAt: date(1),
                  },
                  {
                    id: 'panel-clean',
                    panelIndex: 1,
                    panelNumber: 2,
                    shotType: null,
                    imageUrl: 'https://legacy/image-2.png',
                    imageMediaId: 'media-image-2',
                    videoUrl: '   ',
                    videoMediaId: null,
                    characters: '  ',
                    location: null,
                    updatedAt: date(1),
                  },
                ],
              },
            },
          ],
        }),
      ]),
    )

    expect(graph.warnings.map(({ sourceId, field, code }) => ({ sourceId, field, code }))).toEqual([
      {
        sourceId: 'panel-warning',
        field: 'imageMediaId',
        code: 'MISSING_MEDIA_OBJECT_POINTER',
      },
      {
        sourceId: 'panel-warning',
        field: 'videoMediaId',
        code: 'MISSING_MEDIA_OBJECT_POINTER',
      },
      {
        sourceId: 'panel-warning',
        field: 'characters',
        code: 'UNRESOLVED_TEXT_REFERENCE',
      },
      {
        sourceId: 'panel-warning',
        field: 'location',
        code: 'UNRESOLVED_TEXT_REFERENCE',
      },
    ])
  })

  it('does not expand shots when the storyboard episode conflicts with its parent clip', () => {
    const graph = buildProjectGraphProjection(
      source([
        episode({
          id: 'episode-1',
          clips: [
            {
              id: 'clip-1',
              summary: 'Scene',
              updatedAt: date(1),
              storyboard: {
                id: 'storyboard-mismatch',
                episodeId: 'episode-other-project',
                panelCount: 1,
                updatedAt: date(1),
                panels: [
                  {
                    id: 'panel-must-not-expand',
                    panelIndex: 0,
                    panelNumber: 1,
                    shotType: null,
                    imageMediaId: null,
                    videoMediaId: null,
                    characters: null,
                    location: null,
                    updatedAt: date(1),
                  },
                ],
              },
            },
          ],
        }),
      ]),
    )

    expect(graph.nodes.some((node) => node.id === 'shot:panel-must-not-expand')).toBe(false)
    expect(graph.warnings).toContainEqual(expect.objectContaining({
      code: 'STORYBOARD_EPISODE_MISMATCH',
      nodeId: 'storyboard:storyboard-mismatch',
      sourceType: 'NovelPromotionStoryboard',
      field: 'episodeId',
    }))
  })
})

describe('paginateProjectGraphEpisodes', () => {
  const episodes = [
    episode({ id: 'episode-3', episodeNumber: 3 }),
    episode({ id: 'episode-1', episodeNumber: 1 }),
    episode({ id: 'episode-2', episodeNumber: 2 }),
  ]

  it('uses a stable episode cursor and reports the next page', () => {
    const first = paginateProjectGraphEpisodes(episodes, { limit: 2 })
    const second = paginateProjectGraphEpisodes(episodes, {
      cursor: first.pageInfo.endCursor,
      limit: 2,
    })

    expect(first.episodes.map(({ id }) => id)).toEqual(['episode-1', 'episode-2'])
    expect(first.pageInfo).toEqual({
      limit: 2,
      totalEpisodes: 3,
      endCursor: 'episode-2',
      hasNextPage: true,
    })
    expect(second.episodes.map(({ id }) => id)).toEqual(['episode-3'])
    expect(second.pageInfo.hasNextPage).toBe(false)
  })

  it('rejects an invalid cursor or non-positive/non-integer limit', () => {
    expect(() =>
      paginateProjectGraphEpisodes(episodes, { cursor: 'missing' }),
    ).toThrow('cursor')
    expect(() => paginateProjectGraphEpisodes(episodes, { limit: 0 })).toThrow(
      'positive integer',
    )
    expect(() => paginateProjectGraphEpisodes(episodes, { limit: 1.5 })).toThrow(
      'positive integer',
    )
  })
})
