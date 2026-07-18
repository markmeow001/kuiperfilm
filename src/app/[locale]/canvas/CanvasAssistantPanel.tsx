'use client'

import { useEffect, useRef, useState } from 'react'
import type { CanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { describeCanvasAssistantOperation, parseCanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { CANVAS_TOKENS } from './lib/canvas-tokens'

interface CanvasAssistantPanelProps {
  locale: string
  selectedCount: number
  buildContext: (instruction: string) => string
  onClose: () => void
  onApply: (plan: CanvasAssistantPlan) => void
}

interface TaskResponse {
  task?: {
    status?: string
    result?: { assistantPlan?: unknown }
    error?: { message?: string }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function CanvasAssistantPanel({
  locale,
  selectedCount,
  buildContext,
  onClose,
  onApply,
}: CanvasAssistantPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [plan, setPlan] = useState<CanvasAssistantPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRevision = useRef(0)

  useEffect(() => () => { requestRevision.current += 1 }, [])

  async function generatePlan() {
    if (!instruction.trim() || busy) return
    const revision = ++requestRevision.current
    setBusy(true)
    setError(null)
    setPlan(null)
    try {
      const response = await fetch('/api/canvas/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: buildContext(instruction), mode: 'assistant', locale }),
      })
      const submitted = (await response.json()) as { taskId?: string; error?: { message?: string } }
      if (!response.ok || !submitted.taskId) throw new Error(submitted.error?.message ?? 'AI 计划提交失败')

      for (;;) {
        await wait(1500)
        if (requestRevision.current !== revision) return
        const poll = await fetch(`/api/tasks/${submitted.taskId}`)
        if (!poll.ok) throw new Error(`AI 计划查询失败（${poll.status}）`)
        const payload = (await poll.json()) as TaskResponse
        if (payload.task?.status === 'completed') {
          setPlan(parseCanvasAssistantPlan(payload.task.result?.assistantPlan))
          return
        }
        if (payload.task?.status === 'failed' || payload.task?.status === 'dismissed') {
          throw new Error(payload.task.error?.message ?? 'AI 无法完成画布计划')
        }
      }
    } catch (reason) {
      if (requestRevision.current === revision) setError(reason instanceof Error ? reason.message : 'AI 计划失败')
    } finally {
      if (requestRevision.current === revision) setBusy(false)
    }
  }

  function applyPlan() {
    if (!plan) return
    try {
      onApply(plan)
      setPlan(null)
      setInstruction('')
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法套用 AI 计划')
    }
  }

  return (
    <>
      <button type="button" aria-label="关闭 Canvas Assistant" className="absolute inset-0 z-30 cursor-default" onClick={onClose} />
      <aside
        className="absolute bottom-20 right-5 z-40 flex max-h-[calc(100vh-120px)] w-[390px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl"
        style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}
      >
        <div className="flex items-start justify-between border-b px-4 py-3" style={{ borderColor: CANVAS_TOKENS.hairline }}>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>✨ Canvas Assistant</div>
            <div className="mt-0.5 text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>
              {selectedCount > 0 ? `会优先参考已选 ${selectedCount} 个节点` : '会参考当前画布结构'}
            </div>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-[14px]" onClick={onClose} style={{ color: CANVAS_TOKENS.text.secondary }}>×</button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <textarea
            autoFocus
            rows={4}
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例如：把选中的剧本拆成文字→图片→视频流程，并横向排列"
            className="w-full resize-none rounded-xl px-3 py-2.5 text-[14px] leading-relaxed outline-none disabled:opacity-60"
            style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
          />
          <button
            type="button"
            disabled={busy || !instruction.trim()}
            onClick={generatePlan}
            className="h-9 w-full rounded-lg text-[14px] font-medium disabled:opacity-40"
            style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}
          >
            {busy ? '正在规划…' : '产生操作预览'}
          </button>
          {error ? <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: 'rgba(255,90,90,0.10)', color: '#FF9A9A' }}>{error}</div> : null}
          {plan ? (
            <div className="space-y-2 rounded-xl p-3" style={{ background: CANVAS_TOKENS.bg.card, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              <div className="text-[13px] font-medium" style={{ color: CANVAS_TOKENS.text.primary }}>{plan.summary}</div>
              <ol className="space-y-1.5">
                {plan.operations.map((operation, index) => (
                  <li key={`${operation.kind}-${index}`} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.secondary }}>
                    <span style={{ color: CANVAS_TOKENS.gold }}>{index + 1}.</span>
                    <span>{describeCanvasAssistantOperation(operation)}</span>
                  </li>
                ))}
              </ol>
              <div className="pt-1 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>确认后才会修改画布，可使用 ⌘Z 复原。</div>
              <button type="button" onClick={applyPlan} className="h-9 w-full rounded-lg text-[14px] font-medium" style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}>
                确认并套用
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
