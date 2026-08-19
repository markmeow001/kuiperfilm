import {
  PROJECT_GRAPH_DEFAULT_EPISODE_LIMIT,
  PROJECT_GRAPH_MAX_EPISODE_LIMIT,
  PROJECT_GRAPH_SCHEMA_VERSION,
  type ProjectGraphEdge,
  type ProjectGraphEdgeRelation,
  type ProjectGraphNode,
  type ProjectGraphNodeKind,
  type ProjectGraphPageInfo,
  type ProjectGraphProjection,
  type ProjectGraphProjectionOptions,
  type ProjectGraphSource,
  type ProjectGraphSourceEpisode,
  type ProjectGraphSourceRelation,
  type ProjectGraphWarning,
  type ProjectGraphWarningField,
} from './types'

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const hasText = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0

const nodeId = (kind: ProjectGraphNodeKind, sourceId: string): string =>
  `${kind}:${sourceId}`

const edge = (
  relation: ProjectGraphEdgeRelation,
  sourceRelation: ProjectGraphSourceRelation,
  from: string,
  to: string,
): ProjectGraphEdge => ({
  id: `${relation}:${from}:${to}`,
  from,
  to,
  relation,
  sourceRelation,
})

const normalizedLimit = (limit: number | undefined): number => {
  if (limit === undefined) return PROJECT_GRAPH_DEFAULT_EPISODE_LIMIT
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('Project graph limit must be a positive integer')
  }
  return Math.min(limit, PROJECT_GRAPH_MAX_EPISODE_LIMIT)
}

const sortedEpisodes = (
  episodes: readonly ProjectGraphSourceEpisode[],
): ProjectGraphSourceEpisode[] =>
  [...episodes].sort(
    (left, right) =>
      left.episodeNumber - right.episodeNumber || compareText(left.id, right.id),
  )

export interface PaginatedProjectGraphEpisodes {
  episodes: ProjectGraphSourceEpisode[]
  pageInfo: ProjectGraphPageInfo
}

export function paginateProjectGraphEpisodes(
  episodes: readonly ProjectGraphSourceEpisode[],
  options: ProjectGraphProjectionOptions = {},
): PaginatedProjectGraphEpisodes {
  const sorted = sortedEpisodes(episodes)
  const limit = normalizedLimit(options.limit)
  let startIndex = 0

  if (options.cursor) {
    const cursorIndex = sorted.findIndex((episode) => episode.id === options.cursor)
    if (cursorIndex < 0) {
      throw new RangeError('Project graph cursor does not match an episode')
    }
    startIndex = cursorIndex + 1
  }

  const page = sorted.slice(startIndex, startIndex + limit)
  const lastEpisode = page.at(-1)

  return {
    episodes: page,
    pageInfo: {
      limit,
      totalEpisodes: sorted.length,
      endCursor: lastEpisode?.id ?? null,
      hasNextPage: startIndex + page.length < sorted.length,
    },
  }
}

const warning = (
  sourceType: ProjectGraphWarning['sourceType'],
  kind: 'shot' | 'storyboard',
  sourceId: string,
  field: ProjectGraphWarningField,
  code: ProjectGraphWarning['code'],
  message: string,
): ProjectGraphWarning => {
  const sourceNodeId = nodeId(kind, sourceId)
  return {
    id: `${code}:${sourceNodeId}:${field}`,
    code,
    nodeId: sourceNodeId,
    sourceType,
    sourceId,
    field,
    message,
  }
}

function collectPanelWarnings(panel: {
  id: string
  imageMediaId: string | null
  videoMediaId: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  characters: string | null
  location: string | null
}): ProjectGraphWarning[] {
  const warnings: ProjectGraphWarning[] = []

  if (hasText(panel.imageUrl) && !hasText(panel.imageMediaId)) {
    warnings.push(
      warning(
        'NovelPromotionPanel',
        'shot',
        panel.id,
        'imageMediaId',
        'MISSING_MEDIA_OBJECT_POINTER',
        'Panel has a legacy image URL but no MediaObject pointer.',
      ),
    )
  }
  if (hasText(panel.videoUrl) && !hasText(panel.videoMediaId)) {
    warnings.push(
      warning(
        'NovelPromotionPanel',
        'shot',
        panel.id,
        'videoMediaId',
        'MISSING_MEDIA_OBJECT_POINTER',
        'Panel has a legacy video URL but no MediaObject pointer.',
      ),
    )
  }
  if (hasText(panel.characters)) {
    warnings.push(
      warning(
        'NovelPromotionPanel',
        'shot',
        panel.id,
        'characters',
        'UNRESOLVED_TEXT_REFERENCE',
        'Panel characters are stored as text and are not entity FK references.',
      ),
    )
  }
  if (hasText(panel.location)) {
    warnings.push(
      warning(
        'NovelPromotionPanel',
        'shot',
        panel.id,
        'location',
        'UNRESOLVED_TEXT_REFERENCE',
        'Panel location is stored as text and is not an entity FK reference.',
      ),
    )
  }

  return warnings
}

export function buildProjectGraphProjection(
  source: ProjectGraphSource,
  options: ProjectGraphProjectionOptions = {},
): ProjectGraphProjection {
  const { episodes, pageInfo } = paginateProjectGraphEpisodes(
    source.episodes,
    options,
  )
  const projectNodeId = nodeId('project', source.project.id)
  const nodes: ProjectGraphNode[] = [
    {
      id: projectNodeId,
      kind: 'project',
      sourceType: 'Project',
      sourceId: source.project.id,
      label: source.project.name,
      updatedAt: source.project.updatedAt.toISOString(),
    },
  ]
  const edges: ProjectGraphEdge[] = []
  const warnings: ProjectGraphWarning[] = []

  for (const episode of episodes) {
    const episodeNodeId = nodeId('episode', episode.id)
    nodes.push({
      id: episodeNodeId,
      kind: 'episode',
      sourceType: 'NovelPromotionEpisode',
      sourceId: episode.id,
      label: episode.name,
      updatedAt: episode.updatedAt.toISOString(),
      episodeNumber: episode.episodeNumber,
    })
    edges.push(
      edge(
        'project_has_episode',
        'NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId',
        projectNodeId,
        episodeNodeId,
      ),
    )

    const clips = [...episode.clips].sort(
      (left, right) =>
        (left.start ?? Number.MAX_SAFE_INTEGER) -
          (right.start ?? Number.MAX_SAFE_INTEGER) || compareText(left.id, right.id),
    )

    for (const clip of clips) {
      const sceneNodeId = nodeId('scene', clip.id)
      nodes.push({
        id: sceneNodeId,
        kind: 'scene',
        sourceType: 'NovelPromotionClip',
        sourceId: clip.id,
        label: clip.summary,
        updatedAt: clip.updatedAt.toISOString(),
        summary: clip.summary,
      })
      edges.push(
        edge(
          'episode_has_scene',
          'NovelPromotionClip.episodeId',
          episodeNodeId,
          sceneNodeId,
        ),
      )

      const storyboard = clip.storyboard
      if (!storyboard) continue

      const storyboardNodeId = nodeId('storyboard', storyboard.id)
      nodes.push({
        id: storyboardNodeId,
        kind: 'storyboard',
        sourceType: 'NovelPromotionStoryboard',
        sourceId: storyboard.id,
        label: clip.summary.trim() || 'Storyboard',
        updatedAt: storyboard.updatedAt.toISOString(),
        panelCount: storyboard.panelCount,
      })
      edges.push(
        edge(
          'scene_has_storyboard',
          'NovelPromotionStoryboard.clipId',
          sceneNodeId,
          storyboardNodeId,
        ),
      )

      if (storyboard.episodeId !== episode.id) {
        warnings.push(
          warning(
            'NovelPromotionStoryboard',
            'storyboard',
            storyboard.id,
            'episodeId',
            'STORYBOARD_EPISODE_MISMATCH',
            'Storyboard episode does not match its parent clip episode; shots were not expanded.',
          ),
        )
        continue
      }

      const panels = [...storyboard.panels].sort(
        (left, right) =>
          left.panelIndex - right.panelIndex || compareText(left.id, right.id),
      )

      for (const panel of panels) {
        const shotNodeId = nodeId('shot', panel.id)
        nodes.push({
          id: shotNodeId,
          kind: 'shot',
          sourceType: 'NovelPromotionPanel',
          sourceId: panel.id,
          label: `Shot ${panel.panelNumber ?? panel.panelIndex + 1}`,
          updatedAt: panel.updatedAt.toISOString(),
          panelIndex: panel.panelIndex,
          panelNumber: panel.panelNumber,
          shotType: panel.shotType,
          imageMediaId: panel.imageMediaId,
          videoMediaId: panel.videoMediaId,
        })
        edges.push(
          edge(
            'storyboard_has_shot',
            'NovelPromotionPanel.storyboardId',
            storyboardNodeId,
            shotNodeId,
          ),
        )
        warnings.push(...collectPanelWarnings(panel))
      }
    }
  }

  return {
    schemaVersion: PROJECT_GRAPH_SCHEMA_VERSION,
    projectId: source.project.id,
    nodes,
    edges,
    warnings,
    pageInfo,
  }
}
