import type {
  StoryboardBatchVideoQuote,
  StoryboardBatchVideoSubmission,
} from '@/lib/novel-promotion/storyboard-batch-video-contract'

export type StoryboardBatchVideoPhase =
  | 'idle'
  | 'quoting'
  | 'quoted'
  | 'submitting'
  | 'tracking'
  | 'outcome_unknown'
  | 'error'

export type StoryboardBatchVideoState = {
  phase: StoryboardBatchVideoPhase
  quote: StoryboardBatchVideoQuote | null
  submission: StoryboardBatchVideoSubmission | null
  error: string | null
}

export type StoryboardBatchVideoAction =
  | { type: 'quote_started' }
  | { type: 'quote_received'; quote: StoryboardBatchVideoQuote }
  | { type: 'quote_failed'; message: string }
  | { type: 'submit_started' }
  | { type: 'submit_received'; submission: StoryboardBatchVideoSubmission }
  | { type: 'submit_outcome_unknown'; message: string }
  | { type: 'reset' }

export const initialStoryboardBatchVideoState: StoryboardBatchVideoState = {
  phase: 'idle',
  quote: null,
  submission: null,
  error: null,
}

export function resolveStoryboardBatchVideoEpisodeContext(
  currentEpisodeId: string | null,
  state: StoryboardBatchVideoState,
): { pinnedEpisodeId: string | null; episodeMismatch: boolean } {
  const quotedEpisodeId = state.quote?.episodeId ?? null
  return {
    pinnedEpisodeId: quotedEpisodeId ?? currentEpisodeId,
    episodeMismatch: Boolean(
      quotedEpisodeId
      && currentEpisodeId
      && quotedEpisodeId !== currentEpisodeId,
    ),
  }
}

export function storyboardBatchVideoReducer(
  state: StoryboardBatchVideoState,
  action: StoryboardBatchVideoAction,
): StoryboardBatchVideoState {
  switch (action.type) {
    case 'quote_started':
      return { phase: 'quoting', quote: null, submission: null, error: null }
    case 'quote_received':
      return { phase: 'quoted', quote: action.quote, submission: null, error: null }
    case 'quote_failed':
      return { ...state, phase: 'error', error: action.message }
    case 'submit_started':
      if (!state.quote) return state
      return { ...state, phase: 'submitting', submission: null, error: null }
    case 'submit_received':
      return { ...state, phase: 'tracking', submission: action.submission, error: null }
    case 'submit_outcome_unknown':
      return { ...state, phase: 'outcome_unknown', submission: null, error: action.message }
    case 'reset':
      return initialStoryboardBatchVideoState
  }
}

type JobStatusSnapshot = { id: string; status: string }

export type StoryboardBatchVideoSummary = {
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  active: number
  terminal: number
  outcome: 'idle' | 'quoted' | 'running' | 'completed' | 'partial' | 'failed' | 'outcome_unknown'
}

export type StoryboardBatchJobsLoadState =
  | 'loading'
  | 'fresh'
  | 'stale'
  | 'error'

export function classifyStoryboardBatchVideoSubmitError(
  error: unknown,
): 'known_rejection' | 'outcome_unknown' {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return 'outcome_unknown'
  }
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && status >= 400 && status < 500
    ? 'known_rejection'
    : 'outcome_unknown'
}

export function resolveStoryboardBatchJobsLoadState(input: {
  hasData: boolean
  isPending: boolean
  isError: boolean
}): StoryboardBatchJobsLoadState {
  if (input.isError) return input.hasData ? 'stale' : 'error'
  if (input.isPending && !input.hasData) return 'loading'
  return 'fresh'
}

type BatchVideoJobIdentity = {
  id: string
  targetId: string
  batchRunId?: string | null
}

export function selectStoryboardBatchVideoJobs<T extends BatchVideoJobIdentity>(
  state: StoryboardBatchVideoState,
  jobs: readonly T[],
): T[] {
  const submittedTaskIds = new Set(
    state.submission?.items
      .map((item) => item.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)) ?? [],
  )
  if (submittedTaskIds.size > 0) {
    return jobs.filter((job) => submittedTaskIds.has(job.id))
  }
  if (state.phase !== 'outcome_unknown' || !state.quote) return []

  const activeAtQuoteTaskIds = new Set(
    state.quote.targets
      .map((target) => target.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  )
  return jobs.filter((job) =>
    activeAtQuoteTaskIds.has(job.id) ||
    job.batchRunId === state.quote?.batchRunId,
  )
}

export function releaseTerminalPanelInFlightIds(
  localInFlight: ReadonlySet<string>,
  serverActive: ReadonlySet<string>,
  terminalPanelIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set(localInFlight)
  for (const panelId of terminalPanelIds) {
    if (!serverActive.has(panelId)) next.delete(panelId)
  }
  return next
}

export function collectTerminalPanelVideoIds(tasks: Array<{
  type: string
  targetType: string
  targetId: string
  status: string
  errorCode?: string | null
}>): Set<string> {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (
      task.type === 'video_panel'
      && task.targetType === 'NovelPromotionPanel'
      && task.targetId
      && (
        task.status === 'failed'
        || task.status === 'cancelled'
        || task.errorCode === 'TASK_CANCELLED'
      )
    ) ids.add(task.targetId)
  }
  return ids
}

function normalizeStatus(status: string | null): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  if (status === 'processing' || status === 'running') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'queued'
}

export function summarizeStoryboardBatchVideoRun(
  state: StoryboardBatchVideoState,
  jobs: readonly JobStatusSnapshot[],
): StoryboardBatchVideoSummary {
  const summary: StoryboardBatchVideoSummary = {
    total: state.submission?.total ?? state.quote?.total ?? 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    active: 0,
    terminal: 0,
    outcome: 'idle',
  }

  if (state.phase === 'outcome_unknown') {
    summary.outcome = 'outcome_unknown'
    return summary
  }
  if (!state.submission) {
    summary.outcome = state.quote ? 'quoted' : 'idle'
    return summary
  }

  const jobById = new Map(jobs.map((job) => [job.id, job.status]))
  for (const item of state.submission.items) {
    if (item.outcome === 'rejected') {
      summary.failed += 1
      summary.terminal += 1
      continue
    }
    const status = normalizeStatus(
      item.taskId ? jobById.get(item.taskId) ?? item.status : item.status,
    )
    summary[status] += 1
    if (status === 'queued' || status === 'running') summary.active += 1
    else summary.terminal += 1
  }

  const negative = summary.failed + summary.cancelled
  if (summary.active > 0) {
    summary.outcome = negative > 0 ? 'partial' : 'running'
  } else if (negative === 0 && summary.completed === summary.total) {
    summary.outcome = 'completed'
  } else if (summary.completed > 0) {
    summary.outcome = 'partial'
  } else {
    summary.outcome = 'failed'
  }
  return summary
}
