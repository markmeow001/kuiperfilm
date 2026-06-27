'use client'

/**
 * 无限画布壳 M1 — 纯 React（无 zustand/tldraw 依赖），仿 infinite-canvas 的
 * transform-based 平移/缩放 + 绝对定位可拖拉节点 + SVG 贝塞尔连线。UI 对标 LibTV。
 *
 * 连线 UX（仿 LibTV / infinite-canvas）：
 *  - 每个节点右侧有「输出 port」、左侧有「输入 port」。
 *  - 从输出 port 拖出 → 实时贝塞尔跟随光标 →
 *      · 松手在另一个节点上 → 连成一条边
 *      · 松手在空白处 → 弹节点菜单，选类型后「生成连好的下一个节点」（节点增加节点）
 *
 * 生成走 Task spine、画布存 DB、导演台 3D = 后续。
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
interface Edge {
  id: string
  from: string
  to: string
}
interface Viewport {
  x: number
  y: number
  k: number
}

const NODE_META: Record<NodeType, { label: string; dot: string; ring: string; hint: string }> = {
  character: { label: '角色', dot: 'text-violet-300', ring: 'border-violet-500/40', hint: '绑参考图 / 角色库' },
  t2i: { label: '文生图', dot: 'text-amber-300', ring: 'border-amber-500/40', hint: 'prompt → 图' },
  i2v: { label: '图生视频', dot: 'text-emerald-300', ring: 'border-emerald-500/40', hint: '首帧图 → 短片' },
  text: { label: '文本', dot: 'text-stone-300', ring: 'border-stone-500/40', hint: '脚本 / 提示词' },
}
const NODE_W = 240
const NODE_H = 150
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(performance.now())}`)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const outPort = (n: CanvasNode) => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 })
const inPort = (n: CanvasNode) => ({ x: n.x, y: n.y + NODE_H / 2 })
function bezier(sx: number, sy: number, ex: number, ey: number) {
  const c = Math.max(Math.abs(ex - sx) * 0.5, 50)
  return `M ${sx} ${sy} C ${sx + c} ${sy}, ${ex - c} ${ey}, ${ex} ${ey}`
}

interface CanvasClientProps {
  locale: string
}

export function CanvasClient(_props: CanvasClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, k: 1 })
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [menu, setMenu] = useState<{ sx: number; sy: number; wx: number; wy: number; from: string | null } | null>(null)
  const [pending, setPending] = useState<{ wx: number; wy: number } | null>(null)

  // In-flight interaction state in refs (avoids stale closures + extra renders).
  const panRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const dragRef = useRef<{ id: string; px: number; py: number; ox: number; oy: number } | null>(null)
  const connectRef = useRef<{ from: string } | null>(null)
  const vpRef = useRef(viewport)
  vpRef.current = viewport

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const sx = clientX - (rect?.left ?? 0)
    const sy = clientY - (rect?.top ?? 0)
    const v = vpRef.current
    return { wx: (sx - v.x) / v.k, wy: (sy - v.y) / v.k, sx, sy }
  }, [])

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

  const onBgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    setMenu(null)
    const v = vpRef.current
    panRef.current = { px: e.clientX, py: e.clientY, ox: v.x, oy: v.y }
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (connectRef.current) {
        const { wx, wy } = toWorld(e.clientX, e.clientY)
        setPending({ wx, wy })
        return
      }
      if (dragRef.current) {
        const d = dragRef.current
        const k = vpRef.current.k
        setNodes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: d.ox + (e.clientX - d.px) / k, y: d.oy + (e.clientY - d.py) / k } : n)))
        return
      }
      if (panRef.current) {
        const p = panRef.current
        setViewport((v) => ({ ...v, x: p.ox + (e.clientX - p.px), y: p.oy + (e.clientY - p.py) }))
      }
    },
    [toWorld],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (connectRef.current) {
        const from = connectRef.current.from
        const { wx, wy, sx, sy } = toWorld(e.clientX, e.clientY)
        // hit-test: released over another node?
        const target = nodes.find((n) => n.id !== from && wx >= n.x && wx <= n.x + NODE_W && wy >= n.y && wy <= n.y + NODE_H)
        if (target) {
          setEdges((es) => (es.some((ed) => ed.from === from && ed.to === target.id) ? es : [...es, { id: uid(), from, to: target.id }]))
        } else {
          // released on empty → spawn a CONNECTED next node
          setMenu({ sx, sy, wx, wy, from })
        }
        connectRef.current = null
        setPending(null)
      }
      panRef.current = null
      dragRef.current = null
    },
    [nodes, toWorld],
  )

  const onNodePointerDown = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation()
    if (e.button !== 0) return
    dragRef.current = { id: node.id, px: e.clientX, py: e.clientY, ox: node.x, oy: node.y }
  }, [])

  const onOutPortDown = useCallback((e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation()
    if (e.button !== 0) return
    connectRef.current = { from: node.id }
    const p = outPort(node)
    setPending({ wx: p.x, wy: p.y })
  }, [])

  const onBgDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const { wx, wy, sx, sy } = toWorld(e.clientX, e.clientY)
      setMenu({ sx, sy, wx, wy, from: null })
    },
    [toWorld],
  )

  const addNode = useCallback(
    (type: NodeType) => {
      if (!menu) return
      const id = uid()
      setNodes((ns) => [...ns, { id, type, x: menu.wx - (menu.from ? 0 : NODE_W / 2), y: menu.wy - NODE_H / 2, title: NODE_META[type].label, prompt: '' }])
      if (menu.from) setEdges((es) => [...es, { id: uid(), from: menu.from as string, to: id }])
      setMenu(null)
    },
    [menu],
  )

  const nodeById = (id: string) => nodes.find((n) => n.id === id)

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
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
          {/* 连线层（SVG，世界坐标，overflow visible 让线超出 1x1 仍渲染）*/}
          <svg className="pointer-events-none absolute left-0 top-0" style={{ width: 1, height: 1, overflow: 'visible' }}>
            {edges.map((ed) => {
              const a = nodeById(ed.from)
              const b = nodeById(ed.to)
              if (!a || !b) return null
              const s = outPort(a)
              const t = inPort(b)
              return <path key={ed.id} d={bezier(s.x, s.y, t.x, t.y)} stroke="rgba(255,255,255,0.45)" strokeWidth={2} fill="none" />
            })}
            {pending && connectRef.current && (() => {
              const a = nodeById(connectRef.current.from)
              if (!a) return null
              const s = outPort(a)
              return <path d={bezier(s.x, s.y, pending.wx, pending.wy)} stroke="rgba(124,92,255,0.8)" strokeWidth={2} strokeDasharray="5 4" fill="none" />
            })()}
          </svg>

          {nodes.map((n) => {
            const meta = NODE_META[n.type]
            return (
              <div
                key={n.id}
                className={`absolute cursor-grab rounded-lg border bg-[#1a1a1d]/95 shadow-xl shadow-black/40 active:cursor-grabbing ${meta.ring}`}
                style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => onNodePointerDown(e, n)}
              >
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
                  <span className={`font-mono text-[12px] tracking-wider ${meta.dot}`}>{meta.label}</span>
                  <span className="text-[11px] text-stone-600">{meta.hint}</span>
                </div>
                <div className="flex h-[96px] items-center justify-center px-3 text-center text-[12px] text-stone-600">
                  {n.type === 'text' ? '点击编辑文本…' : '（M1 占位 — 接线后在此出图/出片）'}
                </div>
                {/* 输入 port（左）*/}
                <div className="absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[#1a1a1d] bg-stone-500" />
                {/* 输出 port（右，拖出连线）*/}
                <div
                  title="拖出连接下一个节点"
                  onPointerDown={(e) => onOutPortDown(e, n)}
                  className="absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[#1a1a1d] bg-violet-400 transition-transform hover:scale-125"
                />
              </div>
            )
          })}
        </div>

        {/* 空画布提示 */}
        {nodes.length === 0 && !menu && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-stone-600">
            <div className="text-2xl">◇</div>
            <p className="text-sm">双击画布添加节点</p>
            <p className="text-[12px] text-stone-700">从节点右侧紫点拖出 → 连下一个节点</p>
          </div>
        )}
      </div>

      {/* 节点类型菜单（双击 / 从 port 拖到空白）*/}
      {menu && (
        <div
          className="absolute z-30 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1d] shadow-2xl shadow-black/50"
          style={{ left: clamp(menu.sx, 8, (containerRef.current?.clientWidth ?? 800) - 184), top: clamp(menu.sy, 56, (containerRef.current?.clientHeight ?? 600) - 220) }}
        >
          <div className="border-b border-white/5 px-3 py-2 font-mono text-[11px] tracking-wider text-stone-500">
            {menu.from ? '连接 · 新节点' : '添加节点'}
          </div>
          {(Object.keys(NODE_META) as NodeType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addNode(t)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] text-stone-300 transition-colors hover:bg-white/5"
            >
              <span className={NODE_META[t].dot}>{NODE_META[t].label}</span>
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
            onClick={() => {
              if (b.title !== '添加节点') return
              const cw = containerRef.current?.clientWidth ?? 800
              const ch = containerRef.current?.clientHeight ?? 600
              const v = vpRef.current
              setMenu({ sx: cw / 2, sy: ch / 2 - 80, wx: (-v.x + cw / 2) / v.k, wy: (-v.y + ch / 2) / v.k, from: null })
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100"
          >
            {b.icon}
          </button>
        ))}
      </div>

      {/* 右下：缩放 / 复位 */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 rounded-full border border-white/10 bg-[#1a1a1d]/90 px-2 py-1.5 text-stone-400 backdrop-blur">
        <button type="button" title="缩小" onClick={() => setViewport((v) => ({ ...v, k: clamp(v.k * 0.9, 0.2, 3) }))} className="h-7 w-7 rounded hover:bg-white/10">－</button>
        <span className="px-1 font-mono text-[12px]">{Math.round(viewport.k * 100)}%</span>
        <button type="button" title="放大" onClick={() => setViewport((v) => ({ ...v, k: clamp(v.k * 1.1, 0.2, 3) }))} className="h-7 w-7 rounded hover:bg-white/10">＋</button>
        <button type="button" title="复位" onClick={() => setViewport({ x: 0, y: 0, k: 1 })} className="ml-1 h-7 w-7 rounded hover:bg-white/10">⊙</button>
      </div>
    </div>
  )
}
