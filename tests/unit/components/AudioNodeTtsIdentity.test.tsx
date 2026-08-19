import type { ReactNode } from 'react'
import type { NodeProps } from '@xyflow/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactFlowMock = vi.hoisted(() => ({
  updateNodeData: vi.fn(),
}))

const fetchMock = vi.hoisted(() => vi.fn())

const canvasContextMock = vi.hoisted(() => ({ activeCanvasId: 'canvas-1' as string | null }))

const storageMock = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    clear: vi.fn(() => { values.clear() }),
  }
})

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ updateNodeData: reactFlowMock.updateNodeData }),
  useNodeConnections: () => [],
  useNodesData: () => [],
}))

vi.mock('@/lib/query/mutations/playground-mutations', () => ({
  useUploadPlaygroundReference: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/app/[locale]/canvas/lib/canvas-assets-client', () => ({
  useActiveCanvasId: () => canvasContextMock.activeCanvasId,
}))

vi.mock('@/app/[locale]/canvas/nodes/node-shell', () => ({
  NodeShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { DEFAULT_NODE_DATA, type CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'
import { AudioNode } from '@/app/[locale]/canvas/nodes/AudioNode'
import {
  canvasTtsRequestCheckpointStorageKey,
  readCanvasTtsRequestCheckpointFromStorage,
  writeCanvasTtsRequestCheckpointToStorage,
} from '@/app/[locale]/canvas/nodes/canvas-tts-client-request'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const INPUT_FINGERPRINT = JSON.stringify([
  '你好',
  'voice/playground-ref/user-1/ref.wav',
  '溫柔',
  0.4,
])

function audioNodeProps(overrides: Partial<CanvasNodeData> = {}): NodeProps {
  return {
    id: 'audio-1',
    type: 'audio',
    data: {
      title: '配音',
      ...DEFAULT_NODE_DATA,
      prompt: '你好',
      referenceAudioKey: 'voice/playground-ref/user-1/ref.wav',
      emotionPrompt: '溫柔',
      emotionStrength: 0.4,
      ...overrides,
    },
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  }
}

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

describe('AudioNode Canvas TTS durable request identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageMock.clear()
    canvasContextMock.activeCanvasId = 'canvas-1'
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storageMock })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(REQUEST_ID)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('[送出前] -> [先把 request identity 寫入可 autosave 的 node data]', async () => {
    fetchMock.mockImplementation(async () => {
      expect(reactFlowMock.updateNodeData).toHaveBeenNthCalledWith(1, 'audio-1', {
        ttsClientRequestId: REQUEST_ID,
        ttsIdempotencyFingerprint: INPUT_FINGERPRINT,
      })
      expect(JSON.parse(String(storageMock.getItem(canvasTtsRequestCheckpointStorageKey({
        canvasId: 'canvas-1',
        nodeId: 'audio-1',
      }))))).toEqual({
        version: 1,
        state: 'pending',
        pin: {
          clientRequestId: REQUEST_ID,
          idempotencyFingerprint: INPUT_FINGERPRINT,
        },
      })
      return response(500, { error: 'provider unavailable' })
    })
    render(<AudioNode {...audioNodeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: '生成配音' }))

    await waitFor(() => expect(screen.getByText('provider unavailable')).toBeInTheDocument())
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(requestBody.clientRequestId).toBe(REQUEST_ID)
    expect(reactFlowMock.updateNodeData).toHaveBeenCalledTimes(1)
  })

  it('[新畫布尚未取得 durable canvas id] -> [明確阻止送出避免 storage scope 漂移]', async () => {
    canvasContextMock.activeCanvasId = null
    render(<AudioNode {...audioNodeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: '生成配音' }))

    expect(await screen.findByText('請等待畫布儲存完成後再生成配音')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reactFlowMock.updateNodeData).not.toHaveBeenCalled()
  })

  it('[reload 後同 fingerprint 重試且 2xx malformed] -> [沿用 persisted UUID 並保留 pin]', async () => {
    writeCanvasTtsRequestCheckpointToStorage(storageMock, { canvasId: 'canvas-1', nodeId: 'audio-1' }, {
      state: 'pending',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
    })
    fetchMock.mockResolvedValue(response(200, { taskId: '   ' }))
    render(<AudioNode {...audioNodeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: '生成配音' }))

    await waitFor(() => expect(screen.getByText('提交失败')).toBeInTheDocument())
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(requestBody.clientRequestId).toBe(REQUEST_ID)
    expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
      ttsClientRequestId: REQUEST_ID,
      ttsIdempotencyFingerprint: INPUT_FINGERPRINT,
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )?.state).toBe('pending')
  })

  it('[deterministic 4xx] -> [清除 persisted request identity]', async () => {
    fetchMock.mockResolvedValue(response(400, { error: { message: 'invalid input' } }))
    render(<AudioNode {...audioNodeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: '生成配音' }))

    await waitFor(() => expect(screen.getByText('invalid input')).toBeInTheDocument())
    expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
      ttsClientRequestId: null,
      ttsIdempotencyFingerprint: null,
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )).toEqual({
      state: 'rejected',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      errorMessage: 'invalid input',
    })
  })

  it('[解析到有效 taskId 但 task 尚未 terminal] -> [保留 durable identity 並持久化 taskId]', async () => {
    fetchMock.mockResolvedValue(response(200, { taskId: ' task-123 ' }))
    render(<AudioNode {...audioNodeProps()} />)

    fireEvent.click(screen.getByRole('button', { name: '生成配音' }))

    await waitFor(() => {
      expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
        ttsClientRequestId: REQUEST_ID,
        ttsIdempotencyFingerprint: INPUT_FINGERPRINT,
        ttsTaskId: 'task-123',
        audioTaskId: null,
        audioKey: null,
        audioUrl: null,
      })
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )).toEqual({
      state: 'running',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      taskId: 'task-123',
    })
  })

  it('[poll 確認 task terminal completed] -> [才清除 durable identity 與 ttsTaskId]', async () => {
    writeCanvasTtsRequestCheckpointToStorage(storageMock, { canvasId: 'canvas-1', nodeId: 'audio-1' }, {
      state: 'running',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      taskId: 'task-123',
    })
    fetchMock.mockResolvedValue(response(200, {
      task: {
        status: 'completed',
        result: { audioUrl: 'https://audio.example/result.wav', audioKey: 'voice/result.wav' },
      },
    }))
    reactFlowMock.updateNodeData.mockImplementation((_nodeId: string, patch: Record<string, unknown>) => {
      if (patch.audioTaskId !== 'task-123') return
      expect(readCanvasTtsRequestCheckpointFromStorage(
        storageMock,
        { canvasId: 'canvas-1', nodeId: 'audio-1' },
      )).toEqual({
        state: 'completed',
        pin: {
          clientRequestId: REQUEST_ID,
          idempotencyFingerprint: INPUT_FINGERPRINT,
        },
        taskId: 'task-123',
        audioUrl: 'https://audio.example/result.wav',
        audioKey: 'voice/result.wav',
      })
    })
    render(<AudioNode {...audioNodeProps({
      ttsTaskId: 'task-123',
      ttsClientRequestId: REQUEST_ID,
      ttsIdempotencyFingerprint: INPUT_FINGERPRINT,
    })} />)

    await waitFor(() => {
      expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
        ttsClientRequestId: null,
        ttsIdempotencyFingerprint: null,
        audioUrl: 'https://audio.example/result.wav',
        audioKey: 'voice/result.wav',
        audioTaskId: 'task-123',
        ttsTaskId: null,
      })
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )?.state).toBe('completed')
  })

  it.each(['failed', 'dismissed'] as const)('[poll 確認 task terminal %s] -> [清除 durable identity 讓明確重試建立新 request]', async (status) => {
    writeCanvasTtsRequestCheckpointToStorage(storageMock, { canvasId: 'canvas-1', nodeId: 'audio-1' }, {
      state: 'running',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      taskId: 'task-123',
    })
    fetchMock.mockResolvedValue(response(200, {
      task: { status, error: { message: 'provider rejected' } },
    }))
    render(<AudioNode {...audioNodeProps({
      ttsTaskId: 'task-123',
      ttsClientRequestId: REQUEST_ID,
      ttsIdempotencyFingerprint: INPUT_FINGERPRINT,
    })} />)

    await waitFor(() => expect(screen.getByText('provider rejected')).toBeInTheDocument())
    expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
      ttsClientRequestId: null,
      ttsIdempotencyFingerprint: null,
      ttsTaskId: null,
    })
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )).toEqual({
      state: status,
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      taskId: 'task-123',
      errorMessage: 'provider rejected',
    })
  })

  it('[terminal completed checkpoint 存在但 DB node 尚未 autosave] -> [reload 直接恢復結果且不重新 POST]', async () => {
    writeCanvasTtsRequestCheckpointToStorage(storageMock, { canvasId: 'canvas-1', nodeId: 'audio-1' }, {
      state: 'completed',
      pin: {
        clientRequestId: REQUEST_ID,
        idempotencyFingerprint: INPUT_FINGERPRINT,
      },
      taskId: 'task-123',
      audioUrl: 'https://audio.example/result.wav',
      audioKey: 'voice/result.wav',
    })

    render(<AudioNode {...audioNodeProps()} />)

    await waitFor(() => {
      expect(reactFlowMock.updateNodeData).toHaveBeenLastCalledWith('audio-1', {
        ttsClientRequestId: null,
        ttsIdempotencyFingerprint: null,
        audioUrl: 'https://audio.example/result.wav',
        audioKey: 'voice/result.wav',
        audioTaskId: 'task-123',
        ttsTaskId: null,
      })
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readCanvasTtsRequestCheckpointFromStorage(
      storageMock,
      { canvasId: 'canvas-1', nodeId: 'audio-1' },
    )?.state).toBe('completed')
  })
})
