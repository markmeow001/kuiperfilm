export interface CanvasTtsClientInput {
  text: string
  referenceAudioKey: string
  emotionPrompt?: string
  strength: number
}

export interface CanvasTtsRequestPin {
  clientRequestId: string
  idempotencyFingerprint: string
}

export interface CanvasTtsRequestPinNodeData {
  ttsClientRequestId?: string | null
  ttsIdempotencyFingerprint?: string | null
}

export interface CanvasTtsRequestStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CanvasTtsRequestStorageScope {
  canvasId: string | null
  nodeId: string
}

export type CanvasTtsRequestCheckpoint =
  | { state: 'pending'; pin: CanvasTtsRequestPin }
  | { state: 'running'; pin: CanvasTtsRequestPin | null; taskId: string }
  | {
      state: 'completed'
      pin: CanvasTtsRequestPin | null
      taskId: string
      audioUrl: string | null
      audioKey: string | null
    }
  | {
      state: 'failed' | 'dismissed'
      pin: CanvasTtsRequestPin | null
      taskId: string
      errorMessage: string
    }
  | { state: 'rejected'; pin: CanvasTtsRequestPin; errorMessage: string }

export interface CanvasTtsCheckpointNodeData extends CanvasTtsRequestPinNodeData, Record<string, unknown> {
  ttsTaskId?: string | null
  audioTaskId?: string | null
  audioUrl?: string | null
  audioKey?: string | null
}

const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_STORAGE_PREFIX = 'kuiper:canvas-tts-request:v1'

function inputFingerprint(input: CanvasTtsClientInput): string {
  return JSON.stringify([
    input.text,
    input.referenceAudioKey,
    input.emotionPrompt ?? '',
    input.strength,
  ])
}

export function pinCanvasTtsClientRequest(
  input: CanvasTtsClientInput,
  previous: CanvasTtsRequestPin | null,
  createId: () => string = () => globalThis.crypto.randomUUID(),
): { pin: CanvasTtsRequestPin; body: CanvasTtsClientInput & { clientRequestId: string } } {
  const idempotencyFingerprint = inputFingerprint(input)
  const pin = previous?.idempotencyFingerprint === idempotencyFingerprint
    ? previous
    : { clientRequestId: createId(), idempotencyFingerprint }
  return {
    pin,
    body: { ...input, clientRequestId: pin.clientRequestId },
  }
}

export function canvasTtsRequestPinFromNodeData(
  data: CanvasTtsRequestPinNodeData,
): CanvasTtsRequestPin | null {
  const clientRequestId = data.ttsClientRequestId?.trim()
  const idempotencyFingerprint = data.ttsIdempotencyFingerprint
  if (
    !clientRequestId
    || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)
    || typeof idempotencyFingerprint !== 'string'
    || idempotencyFingerprint.length === 0
  ) {
    return null
  }
  return { clientRequestId, idempotencyFingerprint }
}

export function canvasTtsRequestPinNodeData(
  pin: CanvasTtsRequestPin | null,
): Required<CanvasTtsRequestPinNodeData> {
  return {
    ttsClientRequestId: pin?.clientRequestId ?? null,
    ttsIdempotencyFingerprint: pin?.idempotencyFingerprint ?? null,
  }
}

export function canvasTtsRequestCheckpointStorageKey(scope: CanvasTtsRequestStorageScope): string {
  const nodeId = scope.nodeId.trim()
  if (!nodeId) throw new Error('Canvas TTS request storage requires a node id')
  const canvasId = scope.canvasId?.trim() || 'unsaved'
  return `${REQUEST_STORAGE_PREFIX}:${encodeURIComponent(canvasId)}:${encodeURIComponent(nodeId)}`
}

function parseCheckpointPin(value: unknown, required: boolean): CanvasTtsRequestPin | null {
  if (value === null && !required) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Canvas TTS request checkpoint is corrupted')
  }
  const record = value as Record<string, unknown>
  const pin = canvasTtsRequestPinFromNodeData({
    ttsClientRequestId: typeof record.clientRequestId === 'string' ? record.clientRequestId : null,
    ttsIdempotencyFingerprint: typeof record.idempotencyFingerprint === 'string'
      ? record.idempotencyFingerprint
      : null,
  })
  if (!pin) throw new Error('Canvas TTS request checkpoint is corrupted')
  return pin
}

function parseCheckpointTaskId(value: unknown): string {
  const taskId = readValidCanvasTtsTaskId(value)
  if (!taskId) throw new Error('Canvas TTS request checkpoint is corrupted')
  return taskId
}

function parseNullableString(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('Canvas TTS request checkpoint is corrupted')
  return value
}

export function readCanvasTtsRequestCheckpointFromStorage(
  storage: CanvasTtsRequestStorage,
  scope: CanvasTtsRequestStorageScope,
): CanvasTtsRequestCheckpoint | null {
  const raw = storage.getItem(canvasTtsRequestCheckpointStorageKey(scope))
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Canvas TTS request checkpoint is corrupted')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Canvas TTS request checkpoint is corrupted')
  }
  const record = parsed as Record<string, unknown>
  if (record.version !== 1 || typeof record.state !== 'string') {
    throw new Error('Canvas TTS request checkpoint is corrupted')
  }
  if (record.state === 'pending') {
    return { state: 'pending', pin: parseCheckpointPin(record.pin, true)! }
  }
  if (record.state === 'running') {
    return {
      state: 'running',
      pin: parseCheckpointPin(record.pin, false),
      taskId: parseCheckpointTaskId(record.taskId),
    }
  }
  if (record.state === 'completed') {
    return {
      state: 'completed',
      pin: parseCheckpointPin(record.pin, false),
      taskId: parseCheckpointTaskId(record.taskId),
      audioUrl: parseNullableString(record.audioUrl),
      audioKey: parseNullableString(record.audioKey),
    }
  }
  if (record.state === 'failed' || record.state === 'dismissed') {
    if (typeof record.errorMessage !== 'string') {
      throw new Error('Canvas TTS request checkpoint is corrupted')
    }
    return {
      state: record.state,
      pin: parseCheckpointPin(record.pin, false),
      taskId: parseCheckpointTaskId(record.taskId),
      errorMessage: record.errorMessage,
    }
  }
  if (record.state === 'rejected') {
    if (typeof record.errorMessage !== 'string') {
      throw new Error('Canvas TTS request checkpoint is corrupted')
    }
    return {
      state: 'rejected',
      pin: parseCheckpointPin(record.pin, true)!,
      errorMessage: record.errorMessage,
    }
  }
  throw new Error('Canvas TTS request checkpoint is corrupted')
}

export function writeCanvasTtsRequestCheckpointToStorage(
  storage: CanvasTtsRequestStorage,
  scope: CanvasTtsRequestStorageScope,
  checkpoint: CanvasTtsRequestCheckpoint,
): void {
  storage.setItem(canvasTtsRequestCheckpointStorageKey(scope), JSON.stringify({
    version: 1,
    ...checkpoint,
  }))
}

export function canvasTtsActivePinFromCheckpoint(
  checkpoint: CanvasTtsRequestCheckpoint | null,
): CanvasTtsRequestPin | null {
  if (checkpoint?.state === 'pending' || checkpoint?.state === 'running') {
    return checkpoint.pin
  }
  return null
}

export function canvasTtsNodeDataFromCheckpoint(
  checkpoint: CanvasTtsRequestCheckpoint,
): CanvasTtsCheckpointNodeData {
  if (checkpoint.state === 'pending') return canvasTtsRequestPinNodeData(checkpoint.pin)
  if (checkpoint.state === 'running') {
    return {
      ...canvasTtsRequestPinNodeData(checkpoint.pin),
      ttsTaskId: checkpoint.taskId,
    }
  }
  if (checkpoint.state === 'completed') {
    return {
      ...canvasTtsRequestPinNodeData(null),
      audioUrl: checkpoint.audioUrl,
      audioKey: checkpoint.audioKey,
      audioTaskId: checkpoint.taskId,
      ttsTaskId: null,
    }
  }
  return { ...canvasTtsRequestPinNodeData(null), ttsTaskId: null }
}

export function readValidCanvasTtsTaskId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const taskId = value.trim()
  return taskId.length > 0 ? taskId : null
}

export function shouldRetainCanvasTtsRequestId(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || (status >= 200 && status < 300) || status >= 500
}
