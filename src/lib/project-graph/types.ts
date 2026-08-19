export const PROJECT_GRAPH_SCHEMA_VERSION = '1' as const

export const PROJECT_GRAPH_DEFAULT_EPISODE_LIMIT = 20
export const PROJECT_GRAPH_MAX_EPISODE_LIMIT = 100

export type ProjectGraphNodeKind =
  | 'project'
  | 'episode'
  | 'scene'
  | 'storyboard'
  | 'shot'

export type ProjectGraphSourceType =
  | 'Project'
  | 'NovelPromotionEpisode'
  | 'NovelPromotionClip'
  | 'NovelPromotionStoryboard'
  | 'NovelPromotionPanel'

export type ProjectGraphEdgeRelation =
  | 'project_has_episode'
  | 'episode_has_scene'
  | 'scene_has_storyboard'
  | 'storyboard_has_shot'

export type ProjectGraphSourceRelation =
  | 'NovelPromotionProject.projectId + NovelPromotionEpisode.novelPromotionProjectId'
  | 'NovelPromotionClip.episodeId'
  | 'NovelPromotionStoryboard.clipId'
  | 'NovelPromotionPanel.storyboardId'

export type ProjectGraphWarningCode =
  | 'MISSING_MEDIA_OBJECT_POINTER'
  | 'STORYBOARD_EPISODE_MISMATCH'
  | 'UNRESOLVED_TEXT_REFERENCE'

export type ProjectGraphWarningField =
  | 'imageMediaId'
  | 'videoMediaId'
  | 'episodeId'
  | 'characters'
  | 'location'

interface ProjectGraphSourcePanel {
  id: string
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  imageMediaId: string | null
  videoMediaId: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  characters: string | null
  location: string | null
  updatedAt: Date
}

interface ProjectGraphSourceStoryboard {
  id: string
  episodeId: string
  panelCount: number
  updatedAt: Date
  panels: readonly ProjectGraphSourcePanel[]
}

interface ProjectGraphSourceClip {
  id: string
  summary: string
  start?: number | null
  updatedAt: Date
  storyboard?: ProjectGraphSourceStoryboard | null
}

export interface ProjectGraphSourceEpisode {
  id: string
  episodeNumber: number
  name: string
  updatedAt: Date
  clips: readonly ProjectGraphSourceClip[]
}

export interface ProjectGraphSource {
  project: {
    id: string
    name: string
    updatedAt: Date
  }
  episodes: readonly ProjectGraphSourceEpisode[]
}

interface ProjectGraphNodeBase<
  Kind extends ProjectGraphNodeKind,
  SourceType extends ProjectGraphSourceType,
> {
  id: string
  kind: Kind
  sourceType: SourceType
  sourceId: string
  label: string
  updatedAt: string
}

export type ProjectGraphProjectNode = ProjectGraphNodeBase<'project', 'Project'>

export interface ProjectGraphEpisodeNode
  extends ProjectGraphNodeBase<'episode', 'NovelPromotionEpisode'> {
  episodeNumber: number
}

export interface ProjectGraphSceneNode
  extends ProjectGraphNodeBase<'scene', 'NovelPromotionClip'> {
  summary: string
}

export interface ProjectGraphStoryboardNode
  extends ProjectGraphNodeBase<'storyboard', 'NovelPromotionStoryboard'> {
  panelCount: number
}

export interface ProjectGraphShotNode
  extends ProjectGraphNodeBase<'shot', 'NovelPromotionPanel'> {
  panelIndex: number
  panelNumber: number | null
  shotType: string | null
  imageMediaId: string | null
  videoMediaId: string | null
}

export type ProjectGraphNode =
  | ProjectGraphProjectNode
  | ProjectGraphEpisodeNode
  | ProjectGraphSceneNode
  | ProjectGraphStoryboardNode
  | ProjectGraphShotNode

export interface ProjectGraphEdge {
  id: string
  from: string
  to: string
  relation: ProjectGraphEdgeRelation
  sourceRelation: ProjectGraphSourceRelation
}

export interface ProjectGraphWarning {
  id: string
  code: ProjectGraphWarningCode
  nodeId: string
  sourceType: 'NovelPromotionPanel' | 'NovelPromotionStoryboard'
  sourceId: string
  field: ProjectGraphWarningField
  message: string
}

export interface ProjectGraphPageInfo {
  limit: number
  totalEpisodes: number
  endCursor: string | null
  hasNextPage: boolean
}

export interface ProjectGraphProjection {
  schemaVersion: typeof PROJECT_GRAPH_SCHEMA_VERSION
  projectId: string
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
  warnings: ProjectGraphWarning[]
  pageInfo: ProjectGraphPageInfo
}

export interface ProjectGraphProjectionOptions {
  cursor?: string | null
  limit?: number
}
