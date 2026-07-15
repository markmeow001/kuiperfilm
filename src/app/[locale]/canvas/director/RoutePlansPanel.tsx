'use client'

/**
 * AI 导演路线方案面板（previz S4）——对标截图左栏：场景描述输入 →
 * 「生成导演路线」→ 2-3 张方案卡（名称/风格/镜头数/时长分布条）→ 应用。
 * 生成走 CANVAS_DIRECTOR_ROUTES 任务（宿主 DirectorNode 提交+轮询），
 * 应用 = route-materialize 落成镜头序列（覆盖前有确认）。
 */
import { useState } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import {
  DIRECTOR_ROUTE_DESCRIPTION_LIMITS,
  type DirectorRouteInputMode,
  type DirectorRoutePlan,
  type DirectorRouteSegment,
} from '@/lib/canvas/director-routes-schema'

export interface RoutePlansPanelProps {
  onClose: () => void
  /** 提交 + 轮询到完成，返回方案列表。 */
  onGenerate: (description: string, mode: DirectorRouteInputMode) => Promise<DirectorRouteSegment[]>
  onApply: (plan: DirectorRoutePlan, segment: DirectorRouteSegment, keepPanelOpen: boolean) => void
  castLabels: string[]
}

export function RoutePlansPanel({ onClose, onGenerate, onApply, castLabels }: RoutePlansPanelProps) {
  const [mode, setMode] = useState<DirectorRouteInputMode>('brief')
  const [drafts, setDrafts] = useState<Record<DirectorRouteInputMode, string>>({ brief: '', storyboard: '' })
  const [segments, setSegments] = useState<DirectorRouteSegment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const description = drafts[mode]
  const maxChars = DIRECTOR_ROUTE_DESCRIPTION_LIMITS[mode]

  function selectMode(nextMode: DirectorRouteInputMode) {
    if (busy || nextMode === mode) return
    setMode(nextMode)
    setSegments([])
    setError(null)
  }

  async function generate() {
    if (busy || !description.trim()) return
    setBusy(true)
    setError(null)
    try {
      setSegments(await onGenerate(description.trim(), mode))
    } catch (e) {
      setError((e as Error)?.message ?? '生成失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`absolute left-60 top-16 bottom-40 z-20 flex flex-col overflow-hidden rounded-xl ${mode === 'storyboard' ? 'w-[min(430px,calc(100vw-16rem))]' : 'w-72'}`} style={{ background: `${CANVAS_TOKENS.bg.card}f5`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <span className="font-mono text-[12px]" style={{ color: CANVAS_TOKENS.accent }}>✨ AI 导演路线方案</span>
        <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕</button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: CANVAS_TOKENS.bg.input }}>
          {([
            ['brief', '短描述 · 500字'],
            ['storyboard', '完整分镜 · 5000字'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => selectMode(value)}
              disabled={busy}
              className="rounded-md px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50"
              style={{ background: mode === value ? CANVAS_TOKENS.bg.card : 'transparent', color: mode === value ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.muted }}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          maxLength={maxChars}
          onChange={(e) => setDrafts((current) => ({ ...current, [mode]: e.target.value }))}
          placeholder={mode === 'storyboard'
            ? '直接贴入完整分镜、剧本段落或场次。AI 会保留剧情顺序与硬性限制，自动整理成多个不超过 15 秒的可执行段落。'
            : '描述这一幕：谁、在哪、发生什么、什么情绪。例：两个人明明离得很近，但关系已经断掉。车停在背后，夜色很安静。'}
          rows={mode === 'storyboard' ? 9 : 4}
          className="w-full resize-y rounded-md px-2 py-1.5 text-[12px] leading-relaxed outline-none"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}`, minHeight: 84 }}
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{description.length}/{maxChars}{castLabels.length > 0 ? ` · 卡司 ${castLabels.length}` : ''}</span>
          <button
            type="button"
            onClick={generate}
            disabled={busy || !description.trim()}
            className="rounded-md px-3 py-1 text-[12px] font-semibold disabled:opacity-40"
            style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}
          >
            {busy ? (mode === 'storyboard' ? '拆分生成中…' : '生成中…') : segments.length > 0 ? '重新生成' : mode === 'storyboard' ? '自动拆分并生成' : '生成导演路线'}
          </button>
        </div>
        {error ? <div className="text-[11px]" style={{ color: '#FF8A8A' }}>{error}</div> : null}

        {mode === 'storyboard' && segments.length === 0 && !busy ? (
          <div className="rounded-md px-2 py-1.5 text-[10px] leading-relaxed" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.muted }}>
            AI 会筛除重复修辞与非视觉信息，但保留人物动作、对白节点、事件因果和你写下的硬性限制。每段最多 15 秒、6 个镜头，并按原文顺序排列。
          </div>
        ) : null}

        {segments.map((segment) => (
          <section key={`${segment.order}-${segment.title}`} className="rounded-xl p-2" style={{ background: CANVAS_TOKENS.bg.input, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.accent }}>{String(segment.order).padStart(2, '0')}</span>
              <span className="text-[12px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>{segment.title}</span>
            </div>
            {segment.sourceSummary ? <p className="mt-1 text-[10px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.muted }}>{segment.sourceSummary}</p> : null}
            <div className="mt-2 space-y-2">
              {segment.plans.map((p, i) => {
                const total = p.shots.reduce((s, x) => s + x.durationSec, 0)
                return (
                  <div key={`${p.name}-${i}`} className="rounded-lg p-2" style={{ background: CANVAS_TOKENS.bg.app, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold" style={{ color: CANVAS_TOKENS.text.primary }}>{p.name}</span>
                <span className="shrink-0 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>镜头 {p.shots.length} · {total.toFixed(1)}s</span>
              </div>
              {p.style ? <div className="mt-0.5 truncate text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{p.style}</div> : null}
              {/* 时间分布条 */}
              <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: CANVAS_TOKENS.bg.input }}>
                {p.shots.map((s, j) => (
                  <div key={j} className="h-full" style={{ width: `${(s.durationSec / total) * 100}%`, background: `${CANVAS_TOKENS.accent}${j % 2 ? '66' : 'aa'}`, borderRight: `1px solid ${CANVAS_TOKENS.bg.app}` }} />
                ))}
              </div>
              <div className="mt-1 space-y-0.5">
                {p.shots.map((s, j) => (
                  <div key={j} className="flex items-baseline justify-between gap-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
                    <span className="min-w-0 flex-1 truncate">{s.label}{s.note ? ` · ${s.note}` : ''}</span>
                    <span className="shrink-0 font-mono" style={{ color: CANVAS_TOKENS.text.muted }}>{s.movement} {s.durationSec.toFixed(1)}s</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onApply(p, segment, mode === 'storyboard')}
                className="mt-1.5 w-full rounded-md py-1 text-[11px] font-semibold"
                style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.accent, border: `1px solid ${CANVAS_TOKENS.accent}55` }}
              >
                {mode === 'storyboard' ? '套用此段 → 摆台' : '应用此方案 → 摆台'}
              </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {mode === 'brief' && segments.length === 0 && !busy ? (
          <div className="px-1 text-[10px] leading-relaxed" style={{ color: CANVAS_TOKENS.text.muted }}>
            先摆好人物/道具，写一句场景描述，AI 出 2-3 套差异化镜头方案（景别/运镜/节奏），选一套落成 previz 时间轴再手工微调。
          </div>
        ) : null}
      </div>
    </div>
  )
}
