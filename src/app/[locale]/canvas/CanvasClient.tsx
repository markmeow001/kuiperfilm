'use client'

/**
 * 无限画布壳 M1 — 纯 React（无 zustand/tldraw 依赖），仿 infinite-canvas 的
 * transform-based 平移/缩放 + 绝对定位可拖拉节点。UI 对标 LibTV 画布。
 *
 * M1 范围：画布交互（平移/缩放/双击生节点/拖拉）+ 4 种节点占位（角色/文生图/图生
 * 视频/文本）+ 深色 LibTV 风格壳。生成走 Task spine、连线、导演台、串分镜 = 后续。
 */

import { useCallback, useRef, useState } from 'react'

type NodeType = 'character' | 't2i' | 'i2v' | 'text'
interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  title: string
  prompt: string
}
interface Viewport {
  x: number
  y: number
  k: number
}

const NODE_META: Record<NodeType, { label: string; accent: string; hint: string }> = {
  character: { label: '角色', accent: 'text-violet-300 border-violet-500/40', hint: '绑参考图 / 角色库' },
  t2i: { label: '文生图', accent: 'text-amber-300 border-amber-500/40', hint: 'prompt → 图' },
  i2v: { label: '图生视频', accent: 'text-emerald-300 border-emerald-500/40', hint: '首帧图 → 短片' },
  text: { label: '文本', accent: 'text-stone-300 border-stone-500/40', hint: '脚本 / 提示词' },
}
const NODE_W = 240
const NODE_H = 150
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface CanvasClientProps {
  locale: string
}

export function CanvasClient(_props: CanvasClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 })
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [menu, setMenu] = useState<{ sx: number; sy: number; wx: number; wy: number } | null>(null)

  // In-flight interaction state in refs (avoids stale closures + extra renders).
  const panRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const dragRef = useRef<{ id: string; px: number; py: number; ox: number; oy: number } | null>(null)

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const sx = clientX - (rect?.left ?? 0)
      const sy = clientY - (rect?.top ?? 0)
      return { wx: (sx - viewport.x) / viewport.k, wy: (sy - viewport.y) / viewport.k, sx, sy }
    },
    [viewport],
  )

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const sx = e.clientX - (rect?.left ?? 0)
    const sy = e.clientY - (rect?.top ?? 0)
    setViewport((v) => {
      const wx = (sx - v.x) / v.k
      const wy = (sy - v.y) / v.k
      const k = clamp(v.k * (e.deltaY < 0 ? 1.1 : 0.9), 0.2, 3)
      return { k, x: sx - wx * k, y: sy - wy * k }
    })
  }, [])

  // Pan starts only when the press lands on empty canvas (not a node).
  const onBgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      setMenu(null)
      panRef.current = { px: e.clientX, py: e.clientY, ox: viewport.x, oy: viewport.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [viewport.x, viewport.y],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      const d = dragRef.current
      setNodes((ns) =>
        ns.map((n) =>
          n.id === d.id
            ? { ...n, x: d.ox + (e.clientX - d.px) / viewportKRef.current, y: d.oy + (e.clientY - d.py) / viewportKRef.current }
            : n,
        ),
      )
      return
    }
    if (panRef.current) {
      const p = panRef.current
      setViewport((v) => ({ ...v, x: p.ox + (e.clientX - p.px), y: p.oy + (e.clientY - p.py) }))
    }
  }, [])

  const onPointerUp = useCallback(() => {
    panRef.current = null
    dragRef.current = null
  }, [])

  // viewport.k snapshot for the move handler (avoid re-binding handler each render).
  const viewportKRef = useRef(viewport.k)
  viewportKRef.current = viewport.k

  const onNodePointerDown = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation()
    if (e.button !== 0) return
    dragRef.current = { id: node.id, px: e.clientX, py: e.clientY, ox: node.x, oy: node.y }
  }, [])

  const onBgDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { wx, wy, sx, sy } = screenToWorld(e.clientX, e.clientY)
      setMenu({ sx, sy, wx, wy })
    },
    [screenToWorld],
  )

  const addNode = useCallback(
    (type: NodeType) => {
      if (!menu) return
      setNodes((ns) => [
        ...ns,
        {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
          type,
          x: menu.wx - NODE_W / 2,
          y: menu.wy - NODE_H / 2,
          title: NODE_META[type].label,
          prompt: '',
        },
      ])
      setMenu(null)
    },
    [menu],
  )

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#0e0e10] text-stone-200">
      {/* 顶栏 */}
      <div className="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between border-b border-white/5 bg-[#141416]/80 px-4 backdrop-blur">
        <div className="flex items-center gap-2 font-mono text-[13px] tracking-wider text-stone-300">
          <span className="text-violet-400">◇</span> 无限画布 <span className="text-stone-600">·</span>
          <span className="text-stone-500">未命名画布</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[12px] text-stone-400">
          <span className="rounded bg-white/5 px-2 py-1">⚡ —</span>
          <span className="rounded bg-white/5 px-2 py-1">{Math.round(viewport.k * 100)}%</span>
        </div>
      </div>

      {/* 画布 */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{
          backgroundColor: '#0e0e10',
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: `${24 * viewport.k}px ${24 * viewport.k}px`,
          backgroundPosition: `${viewport.x}px ${viewport.y}px`,
        }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onBgDoubleClick}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}
        >
          {nodes.map((n) => {
            const meta = NODE_META[n.type]
            return (
              <div
                key={n.id}
                className={`absolute cursor-grab rounded-lg border bg-[#1a1a1d]/95 shadow-xl shadow-black/40 active:cursor-grabbing ${meta.accent}`}
                style={{ left: n.x, top: n.y, width: NODE_W, minHeight: NODE_H }}
                onPointerDown={(e) => onNodePointerDown(e, n)}
              >
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
                  <span className={`font-mono text-[12px] tracking-wider ${meta.accent.split(' ')[0]}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-stone-600">{meta.hint}</span>
                </div>
                <div className="flex h-[96px] items-center justify-center px-3 text-[12px] text-stone-600">
                  {n.type === 'text' ? '点击编辑文本…' : '（M1 占位 — 生成接线后可在此出图/出片）'}
                </div>
              </div>
            )
          })}
        </div>

        {/* 空画布提示 */}
        {nodes.length === 0 && !menu && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-stone-600">
            <div className="text-2xl">◇</div>
            <p className="text-sm">双击画布 · 添加节点</p>
            <p className="text-[12px] text-stone-700">滚轮缩放 · 拖拽平移</p>
          </div>
        )}
      </div>

      {/* 双击节点类型菜单 */}
      {menu && (
        <div
          className="absolute z-30 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1d] shadow-2xl shadow-black/50"
          style={{ left: clamp(menu.sx, 8, (containerRef.current?.clientWidth ?? 800) - 184), top: clamp(menu.sy, 56, (containerRef.current?.clientHeight ?? 600) - 200) }}
        >
          <div className="border-b border-white/5 px-3 py-2 font-mono text-[11px] tracking-wider text-stone-500">
            添加节点
          </div>
          {(Object.keys(NODE_META) as NodeType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addNode(t)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] text-stone-300 transition-colors hover:bg-white/5"
            >
              <span className={NODE_META[t].accent.split(' ')[0]}>{NODE_META[t].label}</span>
              <span className="text-[11px] text-stone-600">{NODE_META[t].hint}</span>
            </button>
          ))}
        </div>
      )}

      {/* 底部工具列（仿 LibTV，置中胶囊）*/}
      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#1a1a1d]/90 px-2 py-1.5 shadow-2xl shadow-black/50 backdrop-blur">
        {[
          { icon: '＋', title: '添加节点' },
          { icon: '⬚', title: '工具箱' },
          { icon: '🖼', title: '素材库' },
          { icon: '👤', title: '角色库' },
          { icon: '🕘', title: '历史记录' },
        ].map((b) => (
          <button
            key={b.title}
            type="button"
            title={b.title}
            onClick={() => b.title === '添加节点' && setMenu({ sx: (containerRef.current?.clientWidth ?? 800) / 2, sy: (containerRef.current?.clientHeight ?? 600) / 2 - 80, wx: (-viewport.x + (containerRef.current?.clientWidth ?? 800) / 2) / viewport.k, wy: (-viewport.y + (containerRef.current?.clientHeight ?? 600) / 2) / viewport.k })}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100"
          >
            {b.icon}
          </button>
        ))}
      </div>

      {/* 右下：整理 / 缩放（占位）*/}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-[#1a1a1d]/90 px-2 py-1.5 text-stone-400 backdrop-blur">
        <button type="button" title="缩小" onClick={() => setViewport((v) => ({ ...v, k: clamp(v.k * 0.9, 0.2, 3) }))} className="h-7 w-7 rounded hover:bg-white/10">－</button>
        <span className="px-1 font-mono text-[12px]">{Math.round(viewport.k * 100)}%</span>
        <button type="button" title="放大" onClick={() => setViewport((v) => ({ ...v, k: clamp(v.k * 1.1, 0.2, 3) }))} className="h-7 w-7 rounded hover:bg-white/10">＋</button>
        <button type="button" title="复位" onClick={() => setViewport({ x: 0, y: 0, k: 1 })} className="ml-1 h-7 w-7 rounded hover:bg-white/10">⊙</button>
      </div>
    </div>
  )
}
