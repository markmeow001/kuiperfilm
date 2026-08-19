'use client'

import type { CanvasRecordView } from '@/lib/query/mutations/canvas-mutations'
import type { ReactNode } from 'react'
import { CANVAS_TOKENS } from './lib/canvas-tokens'

interface Props {
  currentId: string | null
  resources: CanvasRecordView[]
  busy: boolean
  error: string | null
  onClose: () => void
  onCreateCanvas: () => void
  onOpenCanvas: (canvas: CanvasRecordView) => void
  onRename: (resource: CanvasRecordView) => void
  onDelete: (resource: CanvasRecordView) => void
  onSaveWorkflow: () => void
  onUseWorkflow: (workflow: CanvasRecordView) => void
}

export function CanvasResourceMenu(props: Props) {
  const canvases = props.resources.filter((item) => item.kind === 'canvas')
  const workflows = props.resources.filter((item) => item.kind === 'workflow')
  return (
    <>
      <button type="button" aria-label="關閉畫布管理" className="absolute inset-0 z-30 cursor-default" onClick={props.onClose} />
      <div className="absolute left-3 top-14 z-40 max-h-[72vh] w-[calc(100vw-24px)] max-w-[420px] overflow-y-auto rounded-xl p-3" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>畫布與工作流</span>
          <button type="button" disabled={props.busy} onClick={props.onCreateCanvas} className="min-h-11 rounded-md px-3 py-2 text-[12px] hover:bg-white/10 disabled:opacity-40" style={{ color: CANVAS_TOKENS.accent }}>＋ 新增空白畫布</button>
        </div>
        {props.error ? <div className="mb-2 rounded-md px-2 py-1.5 text-[11px]" style={{ background: '#401f25', color: '#ff9b9b' }}>{props.error}</div> : null}
        <ResourceSection title={`我的畫布 · ${canvases.length}`} empty="還沒有畫布">
          {canvases.map((item) => (
            <ResourceRow key={item.id} active={item.id === props.currentId} title={item.title} updatedAt={item.updatedAt} primary="開啟" busy={props.busy} onPrimary={() => props.onOpenCanvas(item)} onRename={() => props.onRename(item)} onDelete={() => props.onDelete(item)} />
          ))}
        </ResourceSection>
        <div className="my-3 h-px" style={{ background: CANVAS_TOKENS.hairline }} />
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>我的工作流 · {workflows.length}</span>
          <button type="button" disabled={props.busy || !props.currentId} onClick={props.onSaveWorkflow} className="min-h-11 rounded-md px-3 py-2 text-[11px] hover:bg-white/10 disabled:opacity-40" style={{ color: CANVAS_TOKENS.text.secondary }}>儲存目前畫布</button>
        </div>
        {workflows.length === 0 ? <div className="px-2 py-3 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>把目前畫布儲存成可重複使用的工作流</div> : workflows.map((item) => (
          <ResourceRow key={item.id} title={item.title} updatedAt={item.updatedAt} primary="展開到新畫布" busy={props.busy} onPrimary={() => props.onUseWorkflow(item)} onRename={() => props.onRename(item)} onDelete={() => props.onDelete(item)} />
        ))}
      </div>
    </>
  )
}

function ResourceSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return <section><div className="mb-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{title}</div>{hasChildren ? children : <div className="px-2 py-3 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{empty}</div>}</section>
}

function ResourceRow({ active = false, title, updatedAt, primary, busy, onPrimary, onRename, onDelete }: { active?: boolean; title: string; updatedAt: string; primary: string; busy: boolean; onPrimary: () => void; onRename: () => void; onDelete: () => void }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg px-2 py-2" style={{ background: active ? CANVAS_TOKENS.bg.hover : CANVAS_TOKENS.bg.app, border: `1px solid ${active ? CANVAS_TOKENS.accent : CANVAS_TOKENS.hairline}` }}>
      <button type="button" disabled={busy} onClick={onPrimary} className="min-h-11 min-w-0 flex-1 text-left disabled:opacity-40">
        <div className="truncate text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>{title}</div>
        <div className="mt-0.5 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{primary} · {new Date(updatedAt).toLocaleString()}</div>
      </button>
      <button type="button" disabled={busy} onClick={onRename} className="min-h-11 min-w-11 text-[11px] disabled:opacity-40" style={{ color: CANVAS_TOKENS.text.secondary }}>改名</button>
      <button type="button" disabled={busy} onClick={onDelete} className="min-h-11 min-w-11 text-[11px] disabled:opacity-40" style={{ color: '#FF8A8A' }}>刪除</button>
    </div>
  )
}
