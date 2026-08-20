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

const LEFT_CELL_FIELDS = [
  ['shotSize', '景别'],
  ['lighting', '光影氛围'],
] as const

const RIGHT_CELL_FIELDS = [
  ['sfx', '音效'],
  ['cameraMove', '运镜'],
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
  // 画面描述/对白默认渲染高亮只读视图（实体与说话人名字蓝字），点击进入
  // 编辑（textarea 与高亮层难以并存）。
  const [editing, setEditing] = useState<{ row: number; field: 'description' | 'dialogue' } | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const toggleExpanded = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  // expanded/editing 以行 index 记录；删除/移动会让 index 指到别的镜头，
  // 展开抽屉与编辑框跟错行（review #11）——结构性变更时直接清空。
  const handleDeleteShot = (i: number) => {
    setExpanded(new Set())
    setEditing(null)
    onDeleteShot(i)
  }
  const handleMoveShot = (i: number, dir: -1 | 1) => {
    setExpanded(new Set())
    setEditing(null)
    onMoveShot(i, dir)
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
              {LEFT_CELL_FIELDS.map(([key, label]) => <th key={key} className={th}>{label}</th>)}
              <th className={`${th} min-w-[190px]`}>对白·旁白</th>
              {RIGHT_CELL_FIELDS.map(([key, label]) => <th key={key} className={th}>{label}</th>)}
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
                editingField={editing?.row === i ? editing.field : null}
                expanded={expanded.has(i)}
                onStartEdit={(field) => setEditing({ row: i, field })}
                onStopEdit={() => setEditing(null)}
                onToggleExpanded={() => toggleExpanded(i)}
                onEditShot={onEditShot}
                onDeleteShot={handleDeleteShot}
                onMoveShot={handleMoveShot}
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
  editingField,
  expanded,
  onStartEdit,
  onStopEdit,
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
  editingField: 'description' | 'dialogue' | null
  expanded: boolean
  onStartEdit: (field: 'description' | 'dialogue') => void
  onStopEdit: () => void
  onToggleExpanded: () => void
  onEditShot: ShotTableProps['onEditShot']
  onDeleteShot: ShotTableProps['onDeleteShot']
  onMoveShot: ShotTableProps['onMoveShot']
  td: string
}) {
  // fixed 定位（视口坐标）：菜单锚在 overflow-auto 表格容器内的 td 里，
  // absolute 会被容器裁切——底部行的「删除镜头」看不到（review #10）。
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const rowBorder = { borderTop: `1px solid ${CANVAS_TOKENS.hairline}` }

  // 高亮只读视图 ⇄ 点击编辑（画面描述与对白共用；对白里的说话人名字因为
  // 就是资产名，同一套实体高亮直接命中）。
  const highlightCell = (field: 'description' | 'dialogue', placeholder: string) => {
    const value = shot[field] ?? ''
    if (editingField === field) {
      return (
        <textarea
          autoFocus
          value={value}
          rows={field === 'description' ? 3 : 2}
          onChange={(e) => onEditShot(index, { [field]: e.target.value })}
          onBlur={onStopEdit}
          className="w-full resize-y outline-none"
          style={cellInputStyle}
        />
      )
    }
    return (
      <button
        type="button"
        onClick={() => onStartEdit(field)}
        className="w-full cursor-text text-left"
        style={{ color: value ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.muted }}
      >
        {value ? <EntityText text={value} names={assetNames} /> : placeholder}
      </button>
    )
  }

  return (
    <>
      <tr style={{ ...rowBorder, background: CANVAS_TOKENS.bg.card }}>
        <td className={`${td} text-center`} style={{ color: CANVAS_TOKENS.text.muted }}>{shot.shotNumber}</td>
        <td className={td}>
          <div className="flex items-center gap-0.5" style={{ color: CANVAS_TOKENS.text.primary }}>
            <input
              type="number"
              min={5}
              max={15}
              value={shot.durationSec ?? 5}
              onChange={(e) => onEditShot(index, { durationSec: Number(e.target.value) || 5 })}
              onBlur={(e) => {
                // 表格秒数 = 实际生成/计费秒数：手动输入也钉死 5–15 整数
                // （HTML min/max 不拦打字输入，review #6）。
                const clamped = Math.min(15, Math.max(5, Math.round(Number(e.target.value) || 5)))
                if (clamped !== shot.durationSec) onEditShot(index, { durationSec: clamped })
              }}
              className="w-9 text-center outline-none"
              style={cellInputStyle}
            />
            <span style={{ color: CANVAS_TOKENS.text.muted }}>s</span>
          </div>
        </td>
        <td className={td}>{highlightCell('description', '＋ 画面描述')}</td>
        {LEFT_CELL_FIELDS.map(([key, label]) => (
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
        <td className={td}>{highlightCell('dialogue', '＋')}</td>
        {RIGHT_CELL_FIELDS.map(([key, label]) => (
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
          <button
            type="button"
            aria-label="镜头操作"
            onClick={(e) => {
              if (menuAt) { setMenuAt(null); return }
              const rect = e.currentTarget.getBoundingClientRect()
              // 底部行向上展开，避免超出视口
              const openUp = rect.bottom > window.innerHeight - 220
              setMenuAt({ x: Math.max(8, rect.right - 144), y: openUp ? rect.top - 178 : rect.bottom + 4 })
            }}
            className="rounded px-2 py-0.5 tracking-widest"
            style={{ color: CANVAS_TOKENS.text.muted }}
          >
            …
          </button>
          {menuAt ? (
            <>
              <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuAt(null)} />
              <div
                className="fixed z-20 w-36 overflow-hidden rounded-lg py-1"
                style={{ left: menuAt.x, top: menuAt.y, background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: CANVAS_TOKENS.shadowPopover }}
              >
                {[
                  { label: expanded ? '收起详情' : '镜头详情', disabled: false, danger: false, run: onToggleExpanded },
                  { label: '上移', disabled: index === 0, danger: false, run: () => onMoveShot(index, -1) },
                  { label: '下移', disabled: index === total - 1, danger: false, run: () => onMoveShot(index, 1) },
                  { label: '删除镜头', disabled: false, danger: true, run: () => onDeleteShot(index) },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    onClick={() => { setMenuAt(null); item.run() }}
                    className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/5 disabled:opacity-30"
                    style={{ color: item.danger ? '#FF8A8A' : CANVAS_TOKENS.text.primary }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
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
