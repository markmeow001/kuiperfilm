'use client'

import { useState } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { DirectorBlockingDraft } from '@/lib/canvas/director-blocking-schema'

const MAX_DESCRIPTION_CHARS = 800

export interface BlockingPanelProps {
  onClose: () => void
  onGenerate: (description: string) => Promise<DirectorBlockingDraft>
  onApply: (draft: DirectorBlockingDraft) => void
}

function coordinates(value: [number, number, number]): string {
  return value.map((n) => Number(n.toFixed(1))).join(', ')
}

export function BlockingPanel({ onClose, onGenerate, onApply }: BlockingPanelProps) {
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState<DirectorBlockingDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (busy || !description.trim()) return
    setBusy(true)
    setError(null)
    try {
      setDraft(await onGenerate(description.trim()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute bottom-20 left-5 top-16 z-20 flex w-80 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f5`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <div>
          <div className="font-mono text-[12px]" style={{ color: CANVAS_TOKENS.accent }}>✨ AI 排戏</div>
          <div className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>描述 → 草稿预览 → 确认摆台</div>
        </div>
        <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, MAX_DESCRIPTION_CHARS))}
          placeholder="例：两个角色隔着一张桌子对峙，桌子挡在两人中间。摄影机用 35mm，把两个人框在双人中景内，机位略低。"
          rows={5}
          className="w-full resize-y rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}`, minHeight: 105 }}
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{description.length}/{MAX_DESCRIPTION_CHARS}</span>
          <button type="button" onClick={generate} disabled={busy || !description.trim()} className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}>
            {busy ? '生成草稿中…' : draft ? '重新生成' : '生成排戏草稿'}
          </button>
        </div>
        {error ? <div className="rounded-md p-2 text-[11px]" style={{ color: '#FF8A8A', background: '#7f1d1d22' }}>{error}</div> : null}

        {draft ? (
          <div className="space-y-2 rounded-lg p-2" style={{ background: CANVAS_TOKENS.bg.app, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <div className="text-[13px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>{draft.title}</div>
            <div className="text-[11px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.secondary }}>{draft.summary}</div>
            <div className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>人物 · {draft.subjects.length}</div>
            {draft.subjects.map((subject, index) => (
              <div key={`${subject.label}-${index}`} className="rounded px-2 py-1 text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>
                <span style={{ color: CANVAS_TOKENS.text.primary }}>{subject.label}</span> · {subject.bodyType} · [{coordinates(subject.position)}] · 朝向 {subject.facingDeg}°
              </div>
            ))}
            <div className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>遮挡与道具 · {draft.props.length}</div>
            {draft.props.length > 0 ? draft.props.map((prop, index) => (
              <div key={`${prop.label}-${index}`} className="rounded px-2 py-1 text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>
                <span style={{ color: CANVAS_TOKENS.text.primary }}>{prop.label}</span> · {prop.kind} · [{coordinates(prop.position)}] · 尺寸 [{coordinates(prop.scale)}]
              </div>
            )) : <div className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>无道具</div>}
            <div className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>摄影机</div>
            <div className="rounded px-2 py-1.5 text-[10px] leading-relaxed" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>
              <div style={{ color: CANVAS_TOKENS.text.primary }}>{draft.camera.label} · {draft.camera.focalLengthMm}mm</div>
              <div>{draft.camera.framing}</div>
              <div>位置 [{coordinates(draft.camera.position)}] → 目标 [{coordinates(draft.camera.target)}]</div>
            </div>
            <div className="rounded-md p-2 text-[10px] leading-relaxed" style={{ background: '#78350f22', color: '#F4C44E' }}>
              套用会替换当前人物、道具与机位，并清空旧镜头时间轴；背景与画幅保留。可立即撤销一次。
            </div>
            <button type="button" onClick={() => onApply(draft)} className="w-full rounded-md py-1.5 text-[12px] font-semibold" style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}>
              确认套用到舞台
            </button>
          </div>
        ) : (
          <div className="text-[10px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.muted }}>
            可指定人数、彼此位置、遮挡物、35mm 等焦段、景别与高低角度。AI 只先产出结构化草稿，不会直接覆盖当前舞台。
          </div>
        )}
      </div>
    </div>
  )
}
