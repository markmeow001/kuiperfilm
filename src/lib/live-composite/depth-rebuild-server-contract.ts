export const DEPTH_REBUILD_MAX_SEGMENTS = 2
export const DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC = 15
export const DEPTH_REBUILD_MAX_REFERENCE_DURATION_SEC = 7.5
export const DEPTH_REBUILD_MIN_REFERENCE_DURATION_SEC = 4
export const DEPTH_REBUILD_TIME_EPSILON_SEC = 0.001
export const DEPTH_REBUILD_WORKFLOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface DepthRebuildSegmentIdentity {
  workflowId: string
  segmentIndex: number
  segmentCount: number
}

export function isDepthRebuildWorkflowId(value: unknown): value is string {
  return typeof value === 'string' && DEPTH_REBUILD_WORKFLOW_ID_PATTERN.test(value.trim())
}

export function depthRebuildTimesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= DEPTH_REBUILD_TIME_EPSILON_SEC
}

export function isDepthRebuildSegmentIdentity(
  value: { workflowId?: unknown; segmentIndex?: unknown; segmentCount?: unknown },
): value is DepthRebuildSegmentIdentity {
  const { workflowId, segmentIndex, segmentCount } = value
  return isDepthRebuildWorkflowId(workflowId)
    && typeof segmentIndex === 'number'
    && Number.isInteger(segmentIndex)
    && typeof segmentCount === 'number'
    && Number.isInteger(segmentCount)
    && segmentCount >= 1
    && segmentCount <= DEPTH_REBUILD_MAX_SEGMENTS
    && segmentIndex >= 0
    && segmentIndex < segmentCount
}
