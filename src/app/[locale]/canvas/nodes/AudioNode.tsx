'use client'

/**
 * Audio node — text + an uploaded reference voice clip → cloned speech via
 * AtlasCloud Seed Audio (CANVAS_TTS task on the voice worker). Submit → poll
 * /api/tasks/[taskId] → play the result. No preset voice list: the reference
 * clip IS the voice (voice cloning).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNodeConnections, useNodesData, useReactFlow, type NodeProps } from '@xyflow/react'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { useActiveCanvasId } from '../lib/canvas-assets-client'
import { pickUpstreamText } from '../lib/canvas-refs'
import { NodeShell } from './node-shell'
import { canvasAudioPlaybackUrl } from './audio-playback'
import {
  canvasTtsActivePinFromCheckpoint,
  canvasTtsNodeDataFromCheckpoint,
  canvasTtsRequestPinFromNodeData,
  canvasTtsRequestPinNodeData,
  pinCanvasTtsClientRequest,
  readCanvasTtsRequestCheckpointFromStorage,
  readValidCanvasTtsTaskId,
  shouldRetainCanvasTtsRequestId,
  type CanvasTtsRequestPin,
  type CanvasTtsRequestCheckpoint,
  writeCanvasTtsRequestCheckpointToStorage,
} from './canvas-tts-client-request'

type Phase = 'idle' | 'submitting' | 'running' | 'done' | 'failed'

export function AudioNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const canvasId = useActiveCanvasId()
  const upload = useUploadPlaygroundReference()
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestPinRef = useRef<CanvasTtsRequestPin | null>(canvasTtsRequestPinFromNodeData(d))
  const requestCheckpointRef = useRef<CanvasTtsRequestCheckpoint | null>(null)
  const [checkpointHydrated, setCheckpointHydrated] = useState(false)
  const [phase, setPhase] = useState<Phase>(d.audioUrl ? 'done' : 'idle')
  const [error, setError] = useState<string | null>(null)

  // Optional upstream text (wire a Text/Script node's dialogue in).
  const connections = useNodeConnections()
  const incoming = useMemo(() => connections.filter((c) => c.target === id).map((c) => c.source), [connections, id])
  const upstream = useNodesData(incoming)
  const upstreamText = useMemo(() => pickUpstreamText(upstream), [upstream])

  const text = (upstreamText || d.prompt || '').trim()
  const playbackUrl = canvasAudioPlaybackUrl(d)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }, [])

  const persistRequestCheckpoint = useCallback((checkpoint: CanvasTtsRequestCheckpoint) => {
    if (typeof window === 'undefined') throw new Error('瀏覽器儲存空間不可用')
    if (!canvasId) throw new Error('畫布尚未取得持久識別')
    writeCanvasTtsRequestCheckpointToStorage(window.localStorage, { canvasId, nodeId: id }, checkpoint)
    requestCheckpointRef.current = checkpoint
    requestPinRef.current = canvasTtsActivePinFromCheckpoint(checkpoint)
  }, [canvasId, id])

  useEffect(() => {
    if (!canvasId || typeof window === 'undefined') {
      setCheckpointHydrated(true)
      return
    }
    try {
      const checkpoint = readCanvasTtsRequestCheckpointFromStorage(
        window.localStorage,
        { canvasId, nodeId: id },
      )
      requestCheckpointRef.current = checkpoint
      requestPinRef.current = checkpoint
        ? canvasTtsActivePinFromCheckpoint(checkpoint)
        : canvasTtsRequestPinFromNodeData(d)
      if (checkpoint) {
        updateNodeData(id, canvasTtsNodeDataFromCheckpoint(checkpoint))
        if (checkpoint.state === 'running') setPhase('running')
        if (checkpoint.state === 'completed') setPhase('done')
        if (checkpoint.state === 'failed' || checkpoint.state === 'dismissed' || checkpoint.state === 'rejected') {
          setError(checkpoint.errorMessage)
          setPhase('failed')
        }
      }
    } catch (checkpointError) {
      setError((checkpointError as Error).message)
      setPhase('failed')
    } finally {
      setCheckpointHydrated(true)
    }
  // Node data is deliberately read only for the initial hydration fallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, id, updateNodeData])

  useEffect(() => {
    if (!checkpointHydrated) return
    const taskId = d.ttsTaskId
    if (!taskId) return
    const durableCheckpoint = requestCheckpointRef.current
    if (
      durableCheckpoint
      && durableCheckpoint.state !== 'pending'
      && durableCheckpoint.state !== 'running'
      && 'taskId' in durableCheckpoint
      && durableCheckpoint.taskId === taskId
    ) return
    let cancelled = false
    setPhase('running')
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`)
        if (!res.ok) throw new Error(`任务查询失败 (${res.status})`)
        const json = await res.json() as {
          task?: {
            status?: string
            result?: { audioUrl?: unknown; audioKey?: unknown }
            error?: { message?: unknown }
          }
        }
        const task = json?.task
        if (cancelled) return
        if (task?.status === 'completed') {
          const checkpoint: CanvasTtsRequestCheckpoint = {
            state: 'completed',
            pin: requestPinRef.current,
            taskId,
            audioUrl: typeof task.result?.audioUrl === 'string' ? task.result.audioUrl : null,
            audioKey: typeof task.result?.audioKey === 'string' ? task.result.audioKey : null,
          }
          persistRequestCheckpoint(checkpoint)
          updateNodeData(id, canvasTtsNodeDataFromCheckpoint(checkpoint))
          setPhase('done')
          return
        }
        if (task?.status === 'failed' || task?.status === 'dismissed') {
          const errorMessage = typeof task.error?.message === 'string'
            ? task.error.message
            : '配音生成失败'
          const checkpoint: CanvasTtsRequestCheckpoint = {
            state: task.status,
            pin: requestPinRef.current,
            taskId,
            errorMessage,
          }
          persistRequestCheckpoint(checkpoint)
          setError(errorMessage)
          updateNodeData(id, canvasTtsNodeDataFromCheckpoint(checkpoint))
          setPhase('failed')
          return
        }
        pollRef.current = setTimeout(tick, 1500)
      } catch (err) {
        if (cancelled) return
        setError((err as Error)?.message ?? '配音生成失败')
        setPhase('failed')
      }
    }
    tick()
    return () => { cancelled = true; stopPoll() }
  }, [checkpointHydrated, d.ttsTaskId, id, updateNodeData, stopPoll, persistRequestCheckpoint])

  async function handleRefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const res = await upload.mutateAsync({ file, type: 'audio' })
      updateNodeData(id, { referenceAudioKey: res.key, referenceAudioName: file.name })
    } catch (err) {
      setError((err as Error)?.message ?? '参考音上传失败')
    }
  }

  async function handleGenerate() {
    if (!text) { setError('请输入或连入要配音的文字'); return }
    if (!d.referenceAudioKey) { setError('请先上传参考人声（决定音色）'); return }
    if (!canvasId) { setError('請等待畫布儲存完成後再生成配音'); return }
    setError(null)
    setPhase('submitting')
    let responseStatus: number | null = null
    try {
      if (typeof window === 'undefined') throw new Error('瀏覽器儲存空間不可用，未送出配音請求')
      const requestStorage = window.localStorage
      const storageScope = { canvasId, nodeId: id }
      const persistedCheckpoint = readCanvasTtsRequestCheckpointFromStorage(requestStorage, storageScope)
      requestCheckpointRef.current = persistedCheckpoint
      if (persistedCheckpoint?.state === 'running') {
        requestPinRef.current = persistedCheckpoint.pin
        updateNodeData(id, canvasTtsNodeDataFromCheckpoint(persistedCheckpoint))
        setPhase('running')
        return
      }
      const persistedPin = persistedCheckpoint
        ? canvasTtsActivePinFromCheckpoint(persistedCheckpoint)
        : requestPinRef.current
      const pinned = pinCanvasTtsClientRequest({
        text,
        referenceAudioKey: d.referenceAudioKey,
        ...(d.emotionPrompt ? { emotionPrompt: d.emotionPrompt } : {}),
        strength: d.emotionStrength ?? 0.4,
      }, persistedPin)
      persistRequestCheckpoint({ state: 'pending', pin: pinned.pin })
      updateNodeData(id, canvasTtsRequestPinNodeData(pinned.pin))
      const res = await fetch('/api/canvas/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pinned.body),
      })
      responseStatus = res.status
      const json = await res.json()
      const taskId = readValidCanvasTtsTaskId(json?.taskId)
      if (!res.ok || !taskId) {
        throw new Error(json?.error?.message ?? json?.error ?? '提交失败')
      }
      const runningCheckpoint: CanvasTtsRequestCheckpoint = {
        state: 'running',
        pin: pinned.pin,
        taskId,
      }
      persistRequestCheckpoint(runningCheckpoint)
      updateNodeData(id, {
        ...canvasTtsNodeDataFromCheckpoint(runningCheckpoint),
        audioTaskId: null,
        audioKey: null,
        audioUrl: null,
      })
      setPhase('running')
    } catch (err) {
      const errorMessage = (err as Error)?.message ?? '提交失败'
      if (!shouldRetainCanvasTtsRequestId(responseStatus)) {
        try {
          const rejectedPin = requestPinRef.current
          if (!rejectedPin) throw new Error('缺少被拒絕請求的持久識別')
          persistRequestCheckpoint({ state: 'rejected', pin: rejectedPin, errorMessage })
          updateNodeData(id, canvasTtsRequestPinNodeData(null))
        } catch (storageError) {
          setError(`提交被拒絕，但無法清除重試識別：${(storageError as Error).message}`)
          setPhase('failed')
          return
        }
      }
      setError(errorMessage)
      setPhase('failed')
    }
  }

  const meta = NODE_META.audio
  const busy = phase === 'submitting' || phase === 'running'

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} locked={Boolean(d.locked)} width={300}>
      <div className="space-y-2 p-3">
        <div className="flex gap-1">
          {(['voice', 'music'] as const).map((role) => (
            <button key={role} type="button" onClick={() => updateNodeData(id, { audioTrackRole: role })} className="nodrag flex-1 rounded-md py-1 text-[10px]" style={{ background: (d.audioTrackRole ?? 'voice') === role ? CANVAS_TOKENS.bg.active : CANVAS_TOKENS.bg.input }}>
              {role === 'voice' ? '配音轨' : '音乐轨'}
            </button>
          ))}
        </div>
        {upstreamText ? (
          <div className="rounded-md px-2 py-1 text-[10px]" style={{ background: `${meta.accent}18`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${meta.accent}33` }}>
            文字 ← 上游：{upstreamText.length > 40 ? upstreamText.slice(0, 40) + '…' : upstreamText}
          </div>
        ) : (
          <textarea
            value={d.prompt}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder="输入要配音的文字，或连入「文本 / 脚本」节点…"
            rows={3}
            className="nodrag w-full resize-none rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          />
        )}

        {/* reference voice clip (this IS the voice — cloning) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={upload.isPending}
            className="nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
            style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${d.referenceAudioKey ? `${meta.accent}66` : CANVAS_TOKENS.hairline}` }}
          >
            {upload.isPending ? '上传中…' : d.referenceAudioKey ? '＋ 换参考人声' : '＋ 参考人声（音色）'}
          </button>
          {d.referenceAudioName ? (
            <span className="truncate text-[10px]" style={{ color: CANVAS_TOKENS.text.muted, maxWidth: 120 }}>{d.referenceAudioName}</span>
          ) : null}
          <input ref={audioInputRef} type="file" accept="audio/wav,audio/x-wav,audio/wave,audio/mpeg,audio/mp3,audio/mp4,audio/webm,audio/ogg" className="hidden" onChange={handleRefUpload} />
        </div>

        <input
          value={d.emotionPrompt ?? ''}
          onChange={(e) => updateNodeData(id, { emotionPrompt: e.target.value })}
          placeholder="情绪提示（可留空，如：愤怒 / 温柔 / 悲伤）"
          className="nodrag w-full rounded-md px-2 py-1 text-[11px] outline-none"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
        />

        {error ? <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !text || !d.referenceAudioKey}
          className="nodrag w-full rounded-lg py-1.5 text-[12px] font-semibold tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}
        >
          {phase === 'submitting' ? '提交中…' : phase === 'running' ? '配音生成中…' : d.audioUrl ? '重新配音' : '生成配音'}
        </button>

        {playbackUrl && !busy ? (
          <audio src={playbackUrl} controls className="w-full" style={{ height: 36 }} />
        ) : null}
      </div>
    </NodeShell>
  )
}
