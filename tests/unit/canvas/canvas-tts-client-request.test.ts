import { describe, expect, it, vi } from 'vitest'
import {
  canvasTtsActivePinFromCheckpoint,
  canvasTtsNodeDataFromCheckpoint,
  canvasTtsRequestPinFromNodeData,
  canvasTtsRequestPinNodeData,
  canvasTtsRequestCheckpointStorageKey,
  pinCanvasTtsClientRequest,
  readCanvasTtsRequestCheckpointFromStorage,
  readValidCanvasTtsTaskId,
  shouldRetainCanvasTtsRequestId,
  writeCanvasTtsRequestCheckpointToStorage,
} from '@/app/[locale]/canvas/nodes/canvas-tts-client-request'

const INPUT = {
  text: '你好',
  referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
  emotionPrompt: '溫柔',
  strength: 0.4,
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('Canvas TTS client request identity', () => {
  it('[同一 payload 在未知結果後重試] -> [重用同一 UUID 與完全相同 body]', () => {
    const createId = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    const first = pinCanvasTtsClientRequest(INPUT, null, createId)
    const retry = pinCanvasTtsClientRequest(INPUT, first.pin, createId)

    expect(retry).toEqual(first)
    expect(retry.body.clientRequestId).toBe('11111111-1111-4111-8111-111111111111')
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('[使用者改動 provider-visible input] -> [建立新的 logical request UUID]', () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const first = pinCanvasTtsClientRequest(INPUT, null, createId)
    const changed = pinCanvasTtsClientRequest({ ...INPUT, text: '再見' }, first.pin, createId)

    expect(changed.body.clientRequestId).toBe('22222222-2222-4222-8222-222222222222')
    expect(changed.pin.idempotencyFingerprint).not.toBe(first.pin.idempotencyFingerprint)
  })

  it('[unknown outcome 後 reload 且輸入相同] -> [從 node data 還原並沿用同一 UUID]', () => {
    const createId = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    const first = pinCanvasTtsClientRequest(INPUT, null, createId)
    const persistedData = canvasTtsRequestPinNodeData(first.pin)

    const restored = canvasTtsRequestPinFromNodeData(persistedData)
    const afterReload = pinCanvasTtsClientRequest(INPUT, restored, createId)

    expect(persistedData).toEqual({
      ttsClientRequestId: '11111111-1111-4111-8111-111111111111',
      ttsIdempotencyFingerprint: first.pin.idempotencyFingerprint,
    })
    expect(afterReload.pin).toEqual(first.pin)
    expect(afterReload.body.clientRequestId).toBe('11111111-1111-4111-8111-111111111111')
    expect(createId).toHaveBeenCalledTimes(1)
  })

  it('[reload 後輸入 fingerprint 不同] -> [不可沿用已持久化的 UUID]', () => {
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const first = pinCanvasTtsClientRequest(INPUT, null, createId)
    const restored = canvasTtsRequestPinFromNodeData(canvasTtsRequestPinNodeData(first.pin))

    const changed = pinCanvasTtsClientRequest({ ...INPUT, strength: 0.8 }, restored, createId)

    expect(changed.body.clientRequestId).toBe('22222222-2222-4222-8222-222222222222')
    expect(changed.pin.idempotencyFingerprint).not.toBe(first.pin.idempotencyFingerprint)
  })

  it('[node autosave 前 reload] -> [從 canvas/node scoped checkpoint 還原 exact request identity]', () => {
    const storage = memoryStorage()
    const scope = { canvasId: 'canvas-1', nodeId: 'audio-1' }
    const pin = pinCanvasTtsClientRequest(
      INPUT,
      null,
      () => '11111111-1111-4111-8111-111111111111',
    ).pin

    const checkpoint = { state: 'pending' as const, pin }
    writeCanvasTtsRequestCheckpointToStorage(storage, scope, checkpoint)

    expect(readCanvasTtsRequestCheckpointFromStorage(storage, scope)).toEqual(checkpoint)
    expect(JSON.parse(String(storage.getItem(canvasTtsRequestCheckpointStorageKey(scope))))).toEqual({
      version: 1,
      state: 'pending',
      pin,
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(storage, { ...scope, nodeId: 'audio-2' })).toBeNull()
    expect(readCanvasTtsRequestCheckpointFromStorage(storage, { ...scope, canvasId: 'canvas-2' })).toBeNull()
  })

  it('[有效 taskId] -> [同步 checkpoint taskId 且仍保留 exact pin]', () => {
    const storage = memoryStorage()
    const scope = { canvasId: 'canvas-1', nodeId: 'audio-1' }
    const pin = pinCanvasTtsClientRequest(
      INPUT,
      null,
      () => '11111111-1111-4111-8111-111111111111',
    ).pin
    writeCanvasTtsRequestCheckpointToStorage(storage, scope, { state: 'pending', pin })

    writeCanvasTtsRequestCheckpointToStorage(storage, scope, {
      state: 'running',
      pin,
      taskId: 'task-1',
    })

    expect(readCanvasTtsRequestCheckpointFromStorage(storage, scope)).toEqual({
      state: 'running',
      pin,
      taskId: 'task-1',
    })
    expect(canvasTtsActivePinFromCheckpoint(readCanvasTtsRequestCheckpointFromStorage(storage, scope))).toEqual(pin)
    expect(canvasTtsNodeDataFromCheckpoint(readCanvasTtsRequestCheckpointFromStorage(storage, scope)!)).toEqual({
      ttsClientRequestId: pin.clientRequestId,
      ttsIdempotencyFingerprint: pin.idempotencyFingerprint,
      ttsTaskId: 'task-1',
    })
  })

  it('[terminal completed 在 node autosave 前] -> [checkpoint 保留結果並阻止沿用舊 UUID]', () => {
    const storage = memoryStorage()
    const scope = { canvasId: 'canvas-1', nodeId: 'audio-1' }
    const pin = pinCanvasTtsClientRequest(
      INPUT,
      null,
      () => '11111111-1111-4111-8111-111111111111',
    ).pin
    const completed = {
      state: 'completed' as const,
      pin,
      taskId: 'task-1',
      audioUrl: 'https://audio.example/result.wav',
      audioKey: 'voice/result.wav',
    }

    writeCanvasTtsRequestCheckpointToStorage(storage, scope, completed)

    expect(readCanvasTtsRequestCheckpointFromStorage(storage, scope)).toEqual(completed)
    expect(canvasTtsActivePinFromCheckpoint(completed)).toBeNull()
    expect(canvasTtsNodeDataFromCheckpoint(completed)).toEqual({
      ttsClientRequestId: null,
      ttsIdempotencyFingerprint: null,
      audioUrl: 'https://audio.example/result.wav',
      audioKey: 'voice/result.wav',
      audioTaskId: 'task-1',
      ttsTaskId: null,
    })
  })

  it('[pin 已確定完成或 deterministic 4xx] -> [清除 node data 內兩個持久欄位]', () => {
    expect(canvasTtsRequestPinNodeData(null)).toEqual({
      ttsClientRequestId: null,
      ttsIdempotencyFingerprint: null,
    })
    expect(canvasTtsRequestPinFromNodeData({
      ttsClientRequestId: '11111111-1111-4111-8111-111111111111',
      ttsIdempotencyFingerprint: null,
    })).toBeNull()
  })

  it('[network/5xx unknown outcome vs known 4xx] -> [只對不確定結果保留 request id]', () => {
    expect(shouldRetainCanvasTtsRequestId(null)).toBe(true)
    expect(shouldRetainCanvasTtsRequestId(200)).toBe(true)
    expect(shouldRetainCanvasTtsRequestId(408)).toBe(true)
    expect(shouldRetainCanvasTtsRequestId(500)).toBe(true)
    expect(shouldRetainCanvasTtsRequestId(429)).toBe(true)
    expect(shouldRetainCanvasTtsRequestId(400)).toBe(false)
    expect(shouldRetainCanvasTtsRequestId(409)).toBe(false)
  })

  it('[taskId 為空白或非字串] -> [不視為有效提交結果並保留 unknown outcome pin]', () => {
    expect(readValidCanvasTtsTaskId(' task-1 ')).toBe('task-1')
    expect(readValidCanvasTtsTaskId('   ')).toBeNull()
    expect(readValidCanvasTtsTaskId({ id: 'task-1' })).toBeNull()
  })
})
