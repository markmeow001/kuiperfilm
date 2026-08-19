import {
  runResumableCreateWithUpload,
  type ResumableCreateWithUploadResult,
  type SubjectUploadTarget,
} from './subject-create-upload-flow'
import { queryKeys } from '@/lib/query/keys'

export interface ManualLocationCreateParams {
  name: string
  description: string
  summary?: string | null
  file: File | null
}

export interface ManualPropCreateParams {
  name: string
  description: string
  file: File | null
}

type RequestExecutor = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ManualSubjectKind = 'location' | 'prop'

export function getManualSubjectCreateInvalidationKeys(
  kind: ManualSubjectKind,
  projectId: string,
  episodeId: string | null,
): ReadonlyArray<readonly unknown[]> {
  const keys: Array<readonly unknown[]> = [
    queryKeys.projectAssets.all(projectId),
    kind === 'location'
      ? queryKeys.projectAssets.locations(projectId)
      : queryKeys.projectAssets.props(projectId),
  ]
  if (episodeId) {
    keys.push([
      ...queryKeys.tasks.all(projectId),
      kind === 'location' ? 'episode-location-bindings' : 'episode-prop-bindings',
      episodeId,
    ])
  }
  return keys
}

interface SharedFlowParams {
  projectId: string
  episodeId: string | null
  createRequestId: string
  existingTarget: SubjectUploadTarget | null
  request?: RequestExecutor
  onCreated: (target: SubjectUploadTarget) => Promise<void>
}

interface ManualLocationFlowParams extends SharedFlowParams {
  params: ManualLocationCreateParams
  upload: (params: {
    file: File
    locationId: string
    imageIndex: number
    labelText: string
  }) => Promise<unknown>
}

interface ManualPropFlowParams extends SharedFlowParams {
  params: ManualPropCreateParams
  upload: (params: {
    file: File
    propId: string
    labelText: string
  }) => Promise<unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function readCreatedId(response: Response, field: 'location' | 'prop'): Promise<string> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  const payload = asRecord(await response.json())
  const entity = asRecord(payload[field])
  const id = entity.id
  if (typeof id !== 'string' || !id) {
    throw new Error(`CREATE_${field.toUpperCase()}_RESPONSE_MISSING_ID`)
  }
  return id
}

const defaultRequest: RequestExecutor = async (input, init) => await fetch(input, init)

export async function runManualLocationCreateWithUpload({
  projectId,
  episodeId,
  createRequestId,
  params,
  existingTarget,
  request = defaultRequest,
  onCreated,
  upload,
}: ManualLocationFlowParams): Promise<ResumableCreateWithUploadResult<SubjectUploadTarget>> {
  return await runResumableCreateWithUpload({
    existingTarget,
    createTarget: async () => {
      const response = await request(`/api/novel-promotion/${projectId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: params.name,
          description: params.description || undefined,
          summary: params.summary || undefined,
          episodeId: episodeId || undefined,
          idempotencyKey: createRequestId,
          skipImageGeneration: params.file ? true : undefined,
        }),
      })
      const id = await readCreatedId(response, 'location')
      return { createdId: id, targetId: id }
    },
    onCreated,
    uploadTarget: async (target) => {
      if (!params.file) {
        if (existingTarget) throw new Error('UPLOAD_FILE_REQUIRED_FOR_RETRY')
        return
      }
      await upload({
        file: params.file,
        locationId: target.targetId,
        imageIndex: 0,
        labelText: params.name,
      })
    },
  })
}

export async function runManualPropCreateWithUpload({
  projectId,
  episodeId,
  createRequestId,
  params,
  existingTarget,
  request = defaultRequest,
  onCreated,
  upload,
}: ManualPropFlowParams): Promise<ResumableCreateWithUploadResult<SubjectUploadTarget>> {
  return await runResumableCreateWithUpload({
    existingTarget,
    createTarget: async () => {
      const response = await request(`/api/novel-promotion/${projectId}/prop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: params.name,
          summary: params.description || undefined,
          episodeId: episodeId || undefined,
          idempotencyKey: createRequestId,
        }),
      })
      const id = await readCreatedId(response, 'prop')
      return { createdId: id, targetId: id }
    },
    onCreated,
    uploadTarget: async (target) => {
      if (!params.file) {
        if (existingTarget) throw new Error('UPLOAD_FILE_REQUIRED_FOR_RETRY')
        return
      }
      await upload({
        file: params.file,
        propId: target.targetId,
        labelText: params.name,
      })
    },
  })
}
