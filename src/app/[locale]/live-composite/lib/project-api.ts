/**
 * Live Composite — thin client for /api/live-composite/projects.
 *
 * Every helper throws an Error whose message is already user-facing
 * Traditional Chinese (server error message appended when available) —
 * callers surface it directly, never swallow it.
 */
import type {
  LiveCompositeProjectCreateInput,
  LiveCompositeProjectDetail,
  LiveCompositeProjectSummary,
  LiveCompositeProjectUpdateInput,
} from '@/app/api/live-composite/lib/projects-contract'

interface ProjectMutationResult {
  id: string
  name: string
  videoName: string | null
  updatedAt: string
}

async function requestJson<T>(input: string, init: RequestInit, fallbackMessage: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error) {
    throw new Error(`${fallbackMessage}：${error instanceof Error ? error.message : String(error)}`)
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const errorRecord = payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : {}
    const detail = [errorRecord.message, (errorRecord.details as Record<string, unknown> | undefined)?.code]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' / ')
    throw new Error(detail ? `${fallbackMessage}（${detail}）` : `${fallbackMessage}（HTTP ${response.status}）`)
  }
  return payload as T
}

export async function listLiveCompositeProjects(): Promise<LiveCompositeProjectSummary[]> {
  const payload = await requestJson<{ projects: LiveCompositeProjectSummary[] }>(
    '/api/live-composite/projects',
    { method: 'GET' },
    '合成專案清單載入失敗',
  )
  return payload.projects
}

export async function fetchLiveCompositeProject(id: string): Promise<LiveCompositeProjectDetail> {
  const payload = await requestJson<{ project: LiveCompositeProjectDetail }>(
    `/api/live-composite/projects/${encodeURIComponent(id)}`,
    { method: 'GET' },
    '合成專案載入失敗',
  )
  return payload.project
}

export async function createLiveCompositeProject(
  input: LiveCompositeProjectCreateInput,
): Promise<ProjectMutationResult> {
  const payload = await requestJson<{ project: ProjectMutationResult }>(
    '/api/live-composite/projects',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    '合成專案儲存失敗',
  )
  return payload.project
}

export async function updateLiveCompositeProject(
  id: string,
  input: LiveCompositeProjectUpdateInput,
): Promise<ProjectMutationResult> {
  const payload = await requestJson<{ project: ProjectMutationResult }>(
    `/api/live-composite/projects/${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    '合成專案儲存失敗',
  )
  return payload.project
}
