'use client'

/**
 * 画布底部全局 AI 输入条（LibTV 对标）——画布唯一的 AI 助理入口。
 *
 * 能力：自然语言指令 → CANVAS_TEXT(mode:'assistant') 任务 → 操作计画预览 →
 * 确认套用（建节点/改节点/连线/排列）。支持：
 * - 上传剧本（.txt/.md/.pdf/.docx，经 /api/files/extract-episodes 抽纯文本）。
 *   全文不进 LLM——助理只见摘要，套用时全文填进新建的脚本节点。
 * - 文本模型选择（用户已启用的 llm 清单；后端逐一验证，不做静默兜底）。
 */
import { useEffect, useRef, useState } from 'react'
import type { CanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { describeCanvasAssistantOperation, parseCanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { CANVAS_TOKENS } from './lib/canvas-tokens'
import type { CanvasAssistantAttachment } from './lib/canvas-assistant-context'

const ATTACHMENT_MAX_CHARS = 100_000
const ATTACHMENT_ACCEPT = '.txt,.md,.pdf,.docx'

interface ScriptAttachment {
  name: string
  text: string
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

export interface CanvasAiBarProps {
  locale: string
  selectedCount: number
  /** 增量信号——外部按钮（dock/选取工具列）要聚焦输入框时 +1。 */
  focusSignal: number
  buildContext: (instruction: string, attachment: CanvasAssistantAttachment | null) => string
  onApply: (plan: CanvasAssistantPlan, scriptAttachmentText: string | null) => void
}

export function CanvasAiBar({ locale, selectedCount, focusSignal, buildContext, onApply }: CanvasAiBarProps) {
  const [instruction, setInstruction] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [attachment, setAttachment] = useState<ScriptAttachment | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [plan, setPlan] = useState<CanvasAssistantPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelKey, setModelKey] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const requestRevision = useRef(0)
  const models = useUserModels()
  const llmModels = models.data?.llm ?? []

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])
  useEffect(() => () => { requestRevision.current += 1 }, [])

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setAttaching(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/files/extract-episodes', { method: 'POST', body: form })
      const json = (await res.json()) as { rawText?: string; error?: { message?: string } }
      if (!res.ok) throw new Error(json?.error?.message ?? '剧本解析失败')
      const text = typeof json.rawText === 'string' ? json.rawText.trim() : ''
      if (!text) throw new Error('文件里没有可用文字（扫描版 PDF 请先 OCR）')
      if (text.length > ATTACHMENT_MAX_CHARS) {
        throw new Error(`剧本过长（${text.length}/${ATTACHMENT_MAX_CHARS} 字符），请拆分后再上传`)
      }
      setAttachment({ name: file.name, text })
    } catch (err) {
      setError((err as Error)?.message ?? '剧本解析失败')
    } finally {
      setAttaching(false)
    }
  }

  async function generatePlan() {
    if (!instruction.trim() || busy) return
    const revision = ++requestRevision.current
    setBusy(true)
    setError(null)
    setPlan(null)
    try {
      const contextAttachment: CanvasAssistantAttachment | null = attachment
        ? { name: attachment.name, chars: attachment.text.length, preview: attachment.text.slice(0, 800) }
        : null
      const response = await fetch('/api/canvas/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: buildContext(instruction, contextAttachment),
          mode: 'assistant',
          locale,
          ...(modelKey ? { modelKey } : {}),
        }),
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
      onApply(plan, attachment?.text ?? null)
      setPlan(null)
      setInstruction('')
      setAttachment(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法套用 AI 计划')
    }
  }

  return (
    // z-30：低于新增节点菜单/右键菜单/快捷键面板（z-40）——暂态弹层永远
    // 盖在常驻输入条之上（2026-08-20 反馈：菜单尾部被输入条挡住）。
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[760px]">
        {/* 计画预览 — 确认后才改画布 */}
        {plan ? (
          <div
            className="mb-2 space-y-2 rounded-2xl p-3"
            style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}
          >
            <div className="text-[13px] font-medium" style={{ color: CANVAS_TOKENS.text.primary }}>{plan.summary}</div>
            <ol className="max-h-44 space-y-1.5 overflow-y-auto">
              {plan.operations.map((operation, index) => (
                <li key={`${operation.kind}-${index}`} className="flex gap-2 text-[12px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.secondary }}>
                  <span style={{ color: CANVAS_TOKENS.gold }}>{index + 1}.</span>
                  <span>{describeCanvasAssistantOperation(operation)}</span>
                </li>
              ))}
            </ol>
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>确认后才会修改画布，可用 ⌘Z 复原。</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setPlan(null)} className="rounded-lg px-3 py-1.5 text-[12px]" style={{ color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
                  放弃
                </button>
                <button type="button" onClick={applyPlan} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: CANVAS_TOKENS.cta, color: CANVAS_TOKENS.ctaText }}>
                  确认并套用（{plan.operations.length}）
                </button>
              </span>
            </div>
          </div>
        ) : null}

        <div
          className="rounded-2xl px-3 pb-2 pt-2.5"
          style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}
        >
          {attachment ? (
            <div className="mb-1.5 flex items-center gap-2 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
              <span className="rounded px-1.5 py-0.5" style={{ background: `${CANVAS_TOKENS.accent}22`, color: '#8FD3E8' }}>剧本</span>
              <span className="truncate">{attachment.name}（{attachment.text.length} 字）— 套用时会填入新建的脚本节点</span>
              <button type="button" aria-label="移除附件" onClick={() => setAttachment(null)} style={{ color: CANVAS_TOKENS.text.muted }}>✕</button>
            </div>
          ) : null}
          {error ? <div className="mb-1.5 text-[11px]" style={{ color: '#FF9A9A' }}>{error}</div> : null}

          <textarea
            ref={inputRef}
            rows={expanded ? 6 : 2}
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void generatePlan()
              }
            }}
            placeholder={selectedCount > 0
              ? `让 AI 处理已选的 ${selectedCount} 个节点，或搭建新流程…`
              : '例如：根据我上传的剧本生成一个完整的故事脚本（⌘↵ 发送）'}
            className="w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none disabled:opacity-60"
            style={{ color: CANVAS_TOKENS.text.primary }}
          />

          <div className="mt-1 flex items-center gap-2">
            <select
              value={modelKey}
              onChange={(event) => setModelKey(event.target.value)}
              title="文本模型（默认用 /profile 的分析模型）"
              className="max-w-[220px] truncate rounded-lg px-2 py-1 font-mono text-[11px] outline-none"
              style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              <option value="">默认模型</option>
              {llmModels.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={attaching || busy}
              title="上传剧本（.txt/.md/.pdf/.docx）"
              className="rounded-lg px-2 py-1 text-[13px] disabled:opacity-40"
              style={{ color: CANVAS_TOKENS.text.secondary }}
            >
              {attaching ? '解析中…' : '📎'}
            </button>
            <input ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={handlePickFile} />
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收合' : '展开'}
              className="rounded-lg px-2 py-1 text-[13px]"
              style={{ color: CANVAS_TOKENS.text.secondary }}
            >
              {expanded ? '⤡' : '⤢'}
            </button>
            <button
              type="button"
              onClick={generatePlan}
              disabled={busy || !instruction.trim()}
              aria-label="发送"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold disabled:opacity-40"
              style={{ background: '#FFFFFF', color: '#111' }}
            >
              {busy ? '…' : '↑'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
