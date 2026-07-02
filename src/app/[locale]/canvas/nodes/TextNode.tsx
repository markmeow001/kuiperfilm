'use client'

/**
 * Text node — a free-form prompt / script holder that feeds downstream nodes
 * (script → 分镜, image/video prompt). Includes the LibTV writing assistant:
 * 扩写/改写/润色/续写 via the CANVAS_TEXT task (text worker; no direct LLM
 * call from the client — CLAUDE.md §3).
 */
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META } from '../lib/canvas-tokens'
import type { CanvasNodeData } from '../lib/canvas-types'
import { NodeShell } from './node-shell'

const AI_MODES = [
  { key: 'expand', label: '扩写' },
  { key: 'rewrite', label: '改写' },
  { key: 'polish', label: '润色' },
  { key: 'continue', label: '续写' },
] as const

export function TextNode({ id, data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  const { updateNodeData } = useReactFlow()
  const meta = NODE_META.text
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Poll the in-flight writing-assistant task; write the result back into the
  // node's text when it completes.
  useEffect(() => {
    const taskId = d.textTaskId
    if (!taskId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`)
        if (!res.ok) throw new Error(`任务查询失败 (${res.status})`)
        const json = await res.json()
        const task = json?.task
        if (cancelled) return
        if (task?.status === 'completed') {
          const text = typeof task.result?.text === 'string' ? task.result.text : null
          updateNodeData(id, { ...(text ? { prompt: text } : {}), textTaskId: null })
          return
        }
        if (task?.status === 'failed') {
          setError(task?.error?.message ?? 'AI 写作失败')
          updateNodeData(id, { textTaskId: null })
          return
        }
        pollRef.current = setTimeout(tick, 1500)
      } catch (err) {
        if (cancelled) return
        setError((err as Error)?.message ?? 'AI 写作失败')
        updateNodeData(id, { textTaskId: null })
      }
    }
    tick()
    return () => {
      cancelled = true
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
    }
  }, [d.textTaskId, id, updateNodeData])

  async function runAssist(mode: (typeof AI_MODES)[number]['key']) {
    const text = (d.prompt ?? '').trim()
    if (!text) { setError('先输入一些文字'); return }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/canvas/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
      })
      const json = await res.json()
      if (!res.ok || !json?.taskId) {
        throw new Error(json?.error?.message ?? json?.error ?? '提交失败')
      }
      updateNodeData(id, { textTaskId: json.taskId })
    } catch (err) {
      setError((err as Error)?.message ?? '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || Boolean(d.textTaskId)

  return (
    <NodeShell accent={meta.accent} label={meta.label} hint={meta.hint} selected={selected} width={280}>
      <div className="space-y-2 p-3">
        <textarea
          value={d.prompt}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          placeholder="脚本 / 提示词 / 旁白…"
          rows={5}
          disabled={busy}
          className="nodrag w-full resize-none rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none disabled:opacity-60"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
        />
        {error ? <div className="text-[10px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}
        <div className="flex items-center gap-1">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>✨</span>
          {AI_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={busy}
              onClick={() => runAssist(m.key)}
              className="nodrag flex-1 rounded-md py-1 text-[11px] transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {busy ? (
          <div className="text-center text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
            AI 写作中…
          </div>
        ) : null}
      </div>
    </NodeShell>
  )
}
