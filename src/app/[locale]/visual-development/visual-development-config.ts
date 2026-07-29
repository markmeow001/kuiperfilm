import type { AppIconName } from '@/components/ui/icons/registry'

export type VisualDevelopmentStageId =
  | 'script'
  | 'research'
  | 'world'
  | 'casting'
  | 'face'
  | 'hair'
  | 'costume'
  | 'accessory'
  | 'silhouette'
  | 'expression'
  | 'ability'
  | 'hero'
  | 'turnaround'
  | 'evolution'
  | 'integration'
  | 'video'

export type VisualDevelopmentGroupId =
  | 'foundation'
  | 'identity'
  | 'design'
  | 'production'

export interface VisualDevelopmentStageDefinition {
  id: VisualDevelopmentStageId
  code: string
  group: VisualDevelopmentGroupId
  icon: AppIconName
}

export const VISUAL_DEVELOPMENT_STAGES: readonly VisualDevelopmentStageDefinition[] = [
  { id: 'script', code: '-2', group: 'foundation', icon: 'fileText' },
  { id: 'research', code: '-1', group: 'foundation', icon: 'search' },
  { id: 'world', code: '00', group: 'foundation', icon: 'globe' },
  { id: 'casting', code: '01', group: 'identity', icon: 'user' },
  { id: 'face', code: '02', group: 'identity', icon: 'badgeCheck' },
  { id: 'hair', code: '03', group: 'identity', icon: 'brush' },
  { id: 'costume', code: '04', group: 'design', icon: 'package' },
  { id: 'accessory', code: '05', group: 'design', icon: 'diamond' },
  { id: 'silhouette', code: '06', group: 'design', icon: 'eye' },
  { id: 'expression', code: '07', group: 'design', icon: 'userCircle' },
  { id: 'ability', code: '08', group: 'design', icon: 'sparklesAlt' },
  { id: 'hero', code: '09', group: 'production', icon: 'image' },
  { id: 'turnaround', code: '10', group: 'production', icon: 'refresh' },
  { id: 'evolution', code: '11', group: 'production', icon: 'film' },
  { id: 'integration', code: '12', group: 'production', icon: 'clapperboard' },
  { id: 'video', code: '13', group: 'production', icon: 'video' },
] as const

export const DEFAULT_VISUAL_DEVELOPMENT_STAGE: VisualDevelopmentStageId = 'script'

export function getVisualDevelopmentStage(
  stageId: VisualDevelopmentStageId,
): VisualDevelopmentStageDefinition {
  const stage = VISUAL_DEVELOPMENT_STAGES.find((item) => item.id === stageId)
  if (!stage) {
    throw new Error(`Unknown visual development stage: ${stageId}`)
  }
  return stage
}
