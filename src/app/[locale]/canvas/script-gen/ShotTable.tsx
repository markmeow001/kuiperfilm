'use client'

/**
 * 脚本生成器分镜表（步骤一「确认镜头」与步骤三「合成提示词」共用）。
 * 列结构对标 LibTV：镜号｜时长｜画面描述｜景别｜光影氛围｜对白·旁白｜音效｜
 * 运镜｜最终提示词｜操作。机位/焦段/表演/站位收在每行的「详情」抽屉里。
 * 所有编辑一律产生新数组（immutability 铁则），由父层落回节点 data。
 */
import { useState } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { CanvasStoryboardShot } from '../lib/canvas-types'
import { EntityText } from './EntityText'

export interface ShotTableProps {
  shots: readonly CanvasStoryboardShot[]
  /** 资产名清单（描述高亮 + 出场实体展示）。 */
  assetNames: readonly string[]
  /** 步骤三时高亮最终提示词列。 */
  focusFinal?: boolean
  onEditShot: (index: number, patch: Partial<CanvasStoryboardShot>) => void
  onDeleteShot: (index: number) => void
  onMoveShot: (index: number, dir: -1 | 1) => void
  onAddShot: () => void
}

const CELL_FIELDS = [
  ['shotSize', '景别', 'w-[72px]'],
  ['lighting', '光影氛围', 'min-w-[150px]'],
  ['dialogue', '对白·旁白', 'min-w-[190px]'],
  ['sfx', '音效', 'min-w-[150px]'],
  ['cameraMove', '运镜', 'min-w-[140px]'],
] as const

const DETAIL_FIELDS = [
  ['cameraAngle', '机位角度'],
  ['lens', '镜头焦段'],
  ['performance', '表演情绪'],
  ['blocking', '站位调度'],
] as const

const cellInputStyle = {
  background: 'transparent',
  color: CANVAS_TOKENS.text.primary,
  border: 'none',
} as const

export function ShotTable({
  shots,
  assetNames,
  focusFinal,
  onEditShot,
  onDeleteShot,
  onMoveShot,
  onAddShot,
}: ShotTableProps) {
  // 画面描述默认渲染高亮只读视图，点击进入编辑（textarea 与高亮层难以并存）。
  const [editingDesc, setEditingDesc] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const toggleExpanded = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const th = 'px-3 py-2.5 text-left text-[12px] font-normal whitespace-nowrap'
  const td = 'px-3 py-2 align-top text-[12px] leading-relaxed'

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-lg" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <table className="w-full border-collapse" style={{ minWidth: 1180 }}>
          <thead>
            <tr style={{ background: CANVAS_TOKENS.bg.panel, color: CANVAS_TOKENS.text.muted }}>
              <th className={th} style={{ width: 48 }}>镜号</th>
              <th className={th} style={{ width: 64 }}>时长</th>
              <th className={`${th} min-w-[260px]`}>画面描述</th>
              {CELL_FIELDS.map(([key, label]) => <th key={key} className={th}>{label}</th>)}
              <th
                className={th}
                style={focusFinal ? { background: `${CANVAS_TOKENS.accent}22`, color: CANVAS_TOKENS.text.primary } : undefined}
              >
                最终提示词
              </th>
              <th className={th} style={{ width: 96 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {shots.map((shot, i) => (
              <ShotRow
                key={`${shot.shotNumber}-${i}`}
                shot={shot}
                index={i}
                total={shots.length}
                assetNames={assetNames}
                focusFinal={Boolean(focusFinal)}
                editingDesc={editingDesc === i}
                expanded={expanded.has(i)}
                onStartEditDesc={() => setEditingDesc(i)}
                onStopEditDesc={() => setEditingDesc(null)}
                onToggleExpanded={() => toggleExpanded(i)}
                onEditShot={onEditShot}
                onDeleteShot={onDeleteShot}
                onMoveShot={onMoveShot}
                td={td}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center pt-3">
        <button
          type="button"
          onClick={onAddShot}
          className="rounded-md px-3 py-1.5 text-[13px]"
          style={{ color: CANVAS_TOKENS.text.secondary }}
        >
          ＋ 添加镜头
        </button>
      </div>
    </div>
  )
}

function ShotRow({
  shot,
  index,
  total,
  assetNames,
  focusFinal,
  editingDesc,
  expanded,
  onStartEditDesc,
  onStopEditDesc,
  onToggleExpanded,
  onEditShot,
  onDeleteShot,
  onMoveShot,
  td,
}: {
  shot: CanvasStoryboardShot
  index: number
  total: number
  assetNames: readonly string[]
  focusFinal: boolean
  editingDesc: boolean
  expanded: boolean
  onStartEditDesc: () => void
  onStopEditDesc: () => void
  onToggleExpanded: () => void
  onEditShot: ShotTableProps['onEditShot']
  onDeleteShot: ShotTableProps['onDeleteShot']
  onMoveShot: ShotTableProps['onMoveShot']
  td: string
}) {
  const rowBorder = { borderTop: `1px solid ${CANVAS_TOKENS.hairline}` }
  return (
    <>
      <tr style={{ ...rowBorder, background: CANVAS_TOKENS.bg.card }}>
        <td className={`${td} text-center`} style={{ color: CANVAS_TOKENS.text.muted }}>{shot.shotNumber}</td>
        <td className={td}>
          <div className="flex items-center gap-0.5" style={{ color: CANVAS_TOKENS.text.primary }}>
            <input
              type="number"
              min={1}
              max={15}
              value={shot.durationSec ?? 5}
              onChange={(e) => onEditShot(index, { durationSec: Number(e.target.value) || 5 })}
              className="w-9 text-center outline-none"
              style={cellInputStyle}
            />
            <span style={{ color: CANVAS_TOKENS.text.muted }}>s</span>
          </div>
        </td>
        <td className={td}>
          {editingDesc ? (
            <textarea
              autoFocus
              value={shot.description}
              rows={3}
              onChange={(e) => onEditShot(index, { description: e.target.value })}
              onBlur={onStopEditDesc}
              className="w-full resize-y outline-none"
              style={cellInputStyle}
            />
          ) : (
            <button
              type="button"
              onClick={onStartEditDesc}
              className="w-full cursor-text text-left"
              style={{ color: shot.description ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.muted }}
            >
              {shot.description
                ? <EntityText text={shot.description} names={assetNames} />
                : '＋ 画面描述'}
            </button>
          )}
        </td>
        {CELL_FIELDS.map(([key, label]) => (
          <td key={key} className={td}>
            <textarea
              value={shot[key] ?? ''}
              rows={2}
              placeholder={`＋ ${label}`}
              onChange={(e) => onEditShot(index, { [key]: e.target.value })}
              className="w-full resize-none outline-none placeholder:opacity-40"
              style={cellInputStyle}
            />
          </td>
        ))}
        <td className={td} style={focusFinal ? { background: `${CANVAS_TOKENS.accent}12` } : undefined}>
          {shot.finalPrompt ? (
            <textarea
              value={shot.finalPrompt}
              rows={3}
              onChange={(e) => onEditShot(index, { finalPrompt: e.target.value })}
              className="min-w-[200px] w-full resize-y outline-none"
              style={{ ...cellInputStyle, color: CANVAS_TOKENS.text.secondary }}
            />
          ) : (
            <span
              className="inline-block rounded-md px-2.5 py-1.5 text-[12px]"
              style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.muted, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              待生成提示词
            </span>
          )}
        </td>
        <td className={td}>
          <div className="flex items-center gap-1.5" style={{ color: CANVAS_TOKENS.text.muted }}>
            <button type="button" title="镜头详情（机位/焦段/表演/站位）" onClick={onToggleExpanded}>{expanded ? '▾' : '▸'}</button>
            <button type="button" title="上移" disabled={index === 0} onClick={() => onMoveShot(index, -1)} className="disabled:opacity-25">↑</button>
            <button type="button" title="下移" disabled={index === total - 1} onClick={() => onMoveShot(index, 1)} className="disabled:opacity-25">↓</button>
            <button type="button" title="删除镜头" onClick={() => onDeleteShot(index)} style={{ color: '#FF8A8A' }}>×</button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr style={{ background: CANVAS_TOKENS.bg.panel }}>
          <td />
          <td colSpan={9} className="px-3 pb-3 pt-1">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {DETAIL_FIELDS.map(([key, label]) => (
                <label key={key} className="block text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
                  {label}
                  <textarea
                    value={shot[key] ?? ''}
                    rows={2}
                    onChange={(e) => onEditShot(index, { [key]: e.target.value })}
                    className="mt-1 w-full resize-none rounded-md px-2 py-1.5 text-[12px] outline-none"
                    style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
                  />
                </label>
              ))}
            </div>
            {shot.entities && shot.entities.length > 0 ? (
              <div className="mt-2 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
                出场资产：{shot.entities.join('、')}
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}
