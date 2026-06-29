'use client'

/**
 * 无限画布 M1 — React Flow(@xyflow/react, MIT) 引擎（= LibTV 实测同款），套
 * LibTV 配色 token。图片/视频节点接现有 Playground run spine 出图出片（计费/
 * worker/轮询全继承，无新 task type）。
 *
 * M1 范围：React Flow 壳 + 4 节点(图片/视频/角色/文本) + 文生图/文生视频生成 +
 * 节点连线(handle→handle / 拖到空白生连好的下一个节点) + localStorage 持久化。
 * 画布存 DB(新表 Canvas)、导演台 3D、配方目录、i2v 首帧串接 = M1.5/M2。
 *
 * 设计/分期见 repo docs/plans/2026-06-27-canvas-libtv-clone.md。
 */

import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import { CANVAS_TOKENS, NODE_META, type CanvasNodeType } from './lib/canvas-tokens'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from './lib/canvas-types'
import { serializeCanvas, deserializeCanvas } from './lib/canvas-serialize'
import { CanvasGenerationProvider, useCanvasGeneration } from './lib/canvas-generation'
import { TOOLBOX_PRESETS } from './lib/canvas-toolbox'
import { useCharacterLibrary } from './lib/use-character-library'
import { useCanvas, useSaveCanvas } from '@/lib/query/mutations/canvas-mutations'
import { makeMediaNode } from './nodes/MediaNode'
import { TextNode } from './nodes/TextNode'
import { CharacterNode } from './nodes/CharacterNode'
import { DirectorNode } from './nodes/DirectorNode'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `n_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const nodeTypes: NodeTypes = {
  image: makeMediaNode('image'),
  video: makeMediaNode('video'),
  text: TextNode,
  character: CharacterNode,
  director: DirectorNode,
}

const ADD_ORDER: CanvasNodeType[] = ['image', 'video', 'director', 'character', 'text']

function makeNode(type: CanvasNodeType, x: number, y: number): Node<CanvasNodeData> {
  return {
    id: uid(),
    type,
    position: { x, y },
    data: { title: NODE_META[type].label, ...DEFAULT_NODE_DATA },
  }
}

interface AddMenu {
  screenX: number
  screenY: number
  flowX: number
  flowY: number
  /** When set, the new node is auto-connected from this source id. */
  fromNodeId: string | null
}

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CanvasNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [menu, setMenu] = useState<AddMenu | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ screenX: number; screenY: number; nodeId: string } | null>(null)
  const [showSequence, setShowSequence] = useState(false)
  const [toolbox, setToolbox] = useState(false)
  const [charLib, setCharLib] = useState(false)
  const [zoom, setZoom] = useState(1)
  const rf = useReactFlow()
  const instanceRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null)
  const loadedRef = useRef(false)
  const canvasIdRef = useRef<string | null>(null)
  const pendingViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const clipboardRef = useRef<Node<CanvasNodeData> | null>(null)
  const creatingRef = useRef(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const canvasQuery = useCanvas()
  const save = useSaveCanvas()
  const gen = useCanvasGeneration()

  // Nodes currently generating (their run is pending/running) → the edges feeding
  // them flow brightly to signal "working", like LibTV. Idle edges stay dim/static.
  const workingNodeIds = useMemo(() => {
    const s = new Set<string>()
    for (const n of nodes) {
      const runId = (n.data as CanvasNodeData)?.runId
      const st = gen.runById(runId)?.status
      if (st === 'pending' || st === 'running') s.add(n.id)
    }
    return s
  }, [nodes, gen])

  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const working = workingNodeIds.has(e.target) || workingNodeIds.has(e.source)
        return {
          ...e,
          animated: working,
          style: working
            ? { stroke: CANVAS_TOKENS.accent, strokeWidth: 2.5, opacity: 1 }
            : { stroke: CANVAS_TOKENS.accent, strokeWidth: 1.5, opacity: 0.45 },
        }
      }),
    [edges, workingNodeIds],
  )

  // ── Hydrate from DB once the query resolves ──
  useEffect(() => {
    if (loadedRef.current || canvasQuery.isLoading) return
    loadedRef.current = true
    const canvas = canvasQuery.data?.canvas
    if (!canvas) return
    canvasIdRef.current = canvas.id
    const { nodes: n, edges: e, viewport } = deserializeCanvas({
      nodes: canvas.nodes,
      edges: canvas.edges,
      viewport: canvas.viewport,
    })
    setNodes(n)
    setEdges(e)
    // Apply viewport now if the instance is ready, else stash for onInit.
    if (instanceRef.current) instanceRef.current.setViewport(viewport)
    else pendingViewportRef.current = viewport
  }, [canvasQuery.isLoading, canvasQuery.data, setNodes, setEdges])

  // ── Autosave (debounced) to DB on any change ──
  useEffect(() => {
    if (!loadedRef.current) return
    // Don't create an empty row for a brand-new user who did nothing yet.
    if (nodes.length === 0 && !canvasIdRef.current) return
    const t = setTimeout(() => {
      // Don't fire a second id-less create while the first is still in flight —
      // two concurrent creates would make two Canvas rows for a new user.
      if (!canvasIdRef.current && creatingRef.current) return
      const vp = instanceRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
      const serialized = serializeCanvas(nodes, edges, vp)
      if (!canvasIdRef.current) creatingRef.current = true
      save.mutate(
        {
          ...(canvasIdRef.current ? { id: canvasIdRef.current } : {}),
          nodes: serialized.nodes,
          edges: serialized.edges,
          viewport: serialized.viewport,
        },
        {
          onSuccess: ({ canvas }) => {
            canvasIdRef.current = canvas.id
          },
          onSettled: () => {
            creatingRef.current = false
          },
        },
      )
    }, 800)
    return () => clearTimeout(t)
    // save is stable from react-query; intentionally excluded to avoid re-arming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const onConnect = useCallback(
    (params: Connection) => {
      // A director consumes its cast (it never sources an edge in this model).
      // Under ConnectionMode.Loose a user can drag director→character, which
      // would register no cast. Flip so the director is always the target.
      let p = params
      if (params.source && params.target && rf.getNode(params.source)?.type === 'director') {
        p = { source: params.target, target: params.source, sourceHandle: params.targetHandle ?? null, targetHandle: params.sourceHandle ?? null }
      }
      setEdges((eds) => addEdge(p, eds))
    },
    [setEdges, rf],
  )

  // Drag from a handle, release on empty canvas → open add-menu wired to source.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; fromNode?: { id: string } | null }) => {
      if (connectionState.isValid) return // landed on a node → onConnect handled it
      const fromId = connectionState.fromNode?.id ?? null
      if (!fromId) return
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event
      const rect = wrapperRef.current?.getBoundingClientRect()
      const flow = rf.screenToFlowPosition({ x: clientX, y: clientY })
      setMenu({
        screenX: clientX - (rect?.left ?? 0),
        screenY: clientY - (rect?.top ?? 0),
        flowX: flow.x,
        flowY: flow.y,
        fromNodeId: fromId,
      })
    },
    [rf],
  )

  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const flow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setMenu({
        screenX: event.clientX - (rect?.left ?? 0),
        screenY: event.clientY - (rect?.top ?? 0),
        flowX: flow.x,
        flowY: flow.y,
        fromNodeId: null,
      })
    },
    [rf],
  )

  const addNodeFromMenu = useCallback(
    (type: CanvasNodeType) => {
      if (!menu) return
      const node = makeNode(type, menu.flowX - 140, menu.flowY - 40)
      setNodes((ns) => [...ns, node])
      if (menu.fromNodeId) {
        const edge: Edge = { id: uid(), source: menu.fromNodeId, target: node.id, animated: true }
        setEdges((es) => addEdge(edge, es))
      }
      setMenu(null)
    },
    [menu, setNodes, setEdges],
  )

  const openDockMenu = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    const cx = (rect?.width ?? 800) / 2
    const cy = (rect?.height ?? 600) / 2
    const flow = rf.screenToFlowPosition({ x: (rect?.left ?? 0) + cx, y: (rect?.top ?? 0) + cy })
    setMenu({ screenX: cx, screenY: cy, flowX: flow.x, flowY: flow.y, fromNodeId: null })
  }, [rf])

  // ── Node ops (context menu + keyboard) ──
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      const rect = wrapperRef.current?.getBoundingClientRect()
      setMenu(null)
      setCtxMenu({ screenX: event.clientX - (rect?.left ?? 0), screenY: event.clientY - (rect?.top ?? 0), nodeId: node.id })
    },
    [],
  )

  const copyNode = useCallback((nodeId: string) => {
    const n = nodes.find((x) => x.id === nodeId)
    if (n) clipboardRef.current = n
  }, [nodes])

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
  }, [setNodes, setEdges])

  // Build a clean copy — only id/type/position/data, never RF internal fields
  // (measured/dragging/internals). structuredClone the data to avoid aliasing
  // nested fields if any are ever added. runId reset so the copy starts fresh.
  const cloneNode = (src: Node<CanvasNodeData>, x: number, y: number): Node<CanvasNodeData> => ({
    id: uid(),
    type: src.type,
    position: { x, y },
    data: { ...structuredClone(src.data), runId: null },
  })

  const duplicateNode = useCallback((nodeId: string) => {
    const n = nodes.find((x) => x.id === nodeId)
    if (!n) return
    const copy = cloneNode(n, n.position.x + 48, n.position.y + 48)
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...copy, selected: true }])
  }, [nodes, setNodes])

  const pasteNode = useCallback((flowX?: number, flowY?: number) => {
    const c = clipboardRef.current
    if (!c) return
    const copy = cloneNode(c, flowX ?? c.position.x + 48, flowY ?? c.position.y + 48)
    setNodes((ns) => [...ns, copy])
  }, [setNodes])

  // 优化工作流布局: layered left→right by longest-path depth via Kahn topo-sort
  // (terminates on cycles; cycle nodes keep depth 0).
  const optimizeLayout = useCallback(() => {
    setNodes((ns) => {
      const ids = new Set(ns.map((n) => n.id))
      const indeg = new Map<string, number>()
      ns.forEach((n) => indeg.set(n.id, 0))
      const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
      valid.forEach((e) => indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1))
      const depth = new Map<string, number>()
      const queue: string[] = []
      ns.forEach((n) => { depth.set(n.id, 0); if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id) })
      while (queue.length) {
        const u = queue.shift() as string
        for (const e of valid.filter((x) => x.source === u)) {
          depth.set(e.target, Math.max(depth.get(e.target) ?? 0, (depth.get(u) ?? 0) + 1))
          const left = (indeg.get(e.target) ?? 0) - 1
          indeg.set(e.target, left)
          if (left === 0) queue.push(e.target)
        }
      }
      const COL = 360
      const ROW = 240
      const perCol = new Map<number, number>()
      return ns.map((n) => {
        const d = depth.get(n.id) ?? 0
        const row = perCol.get(d) ?? 0
        perCol.set(d, row + 1)
        return { ...n, position: { x: 80 + d * COL, y: 80 + row * ROW } }
      })
    })
  }, [edges, setNodes])

  // keyboard shortcuts (ignore when typing in inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const meta = e.metaKey || e.ctrlKey
      const selected = nodes.filter((n) => n.selected)
      const sel = selected[0]
      if (meta && e.key === 'c' && sel) { copyNode(sel.id); e.preventDefault() }
      else if (meta && e.key === 'd' && sel) { duplicateNode(sel.id); e.preventDefault() }
      else if (meta && e.key === 'v' && clipboardRef.current) { pasteNode(); e.preventDefault() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) { selected.forEach((n) => deleteNode(n.id)); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodes, copyNode, duplicateNode, pasteNode, deleteNode])

  // Shot sequence = image/video nodes ordered left→right, top→bottom (the
  // storyboard reading order) — the drama as an ordered list of shots.
  const shots = useMemo(() => {
    // Bucket x into columns first → a fully transitive (col, y) comparator.
    // A pairwise |Δx|>threshold compare is non-transitive and can mis-order.
    const col = (x: number) => Math.round(x / 120)
    return nodes
      .filter((n) => n.type === 'image' || n.type === 'video')
      .sort((a, b) => (col(a.position.x) !== col(b.position.x) ? col(a.position.x) - col(b.position.x) : a.position.y - b.position.y))
  }, [nodes])

  const focusNode = useCallback((nodeId: string) => {
    const n = nodes.find((x) => x.id === nodeId)
    if (!n) return
    rf.setCenter(n.position.x + 140, n.position.y + 90, { zoom: 1.1, duration: 400 })
    setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === nodeId })))
  }, [nodes, rf, setNodes])

  // viewport-center flow coords for dropping new nodes/graphs
  const centerFlow = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    return rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 })
  }, [rf])

  const applyToolboxPreset = useCallback((presetKey: string) => {
    const preset = TOOLBOX_PRESETS.find((p) => p.key === presetKey)
    if (!preset) return
    const c = centerFlow()
    const { nodes: newNodes, edges: newEdges } = preset.build(uid, c.x - 280, c.y - 80)
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), ...newNodes])
    if (newEdges.length) setEdges((es) => [...es, ...newEdges])
    setToolbox(false)
  }, [centerFlow, setNodes, setEdges])

  const characterLibQuery = useCharacterLibrary(charLib)
  const dropCharacter = useCallback((name: string, imageUrl: string | null) => {
    const c = centerFlow()
    const node: Node<CanvasNodeData> = {
      id: uid(),
      type: 'character',
      position: { x: c.x - 120, y: c.y - 80 },
      // imageUrl is a signed asset-hub URL (not in the playground-ref namespace,
      // so it can't be a durable referenceKey — the ref guard only accepts URLs,
      // not foreign keys). Store it as resultUrl; downstream falls back to it.
      // In-session it works; re-pick if the signed URL expires.
      data: { ...DEFAULT_NODE_DATA, title: name, resultUrl: imageUrl, referenceKey: null },
    }
    setNodes((ns) => [...ns, node])
    setCharLib(false)
  }, [centerFlow, setNodes])

  const minimapColor = useCallback((n: Node) => NODE_META[(n.type as CanvasNodeType) ?? 'text']?.accent ?? CANVAS_TOKENS.text.muted, [])

  const dockButtons = useMemo(
    () => [
      { key: 'add', label: '添加节点', onClick: openDockMenu },
      { key: 'toolbox', label: '工具箱', onClick: () => setToolbox((v) => !v) },
      { key: 'sequence', label: '镜头序列', onClick: () => setShowSequence((v) => !v) },
      { key: 'character', label: '角色库', onClick: () => setCharLib((v) => !v) },
    ],
    [openDockMenu],
  )

  return (
    <div ref={wrapperRef} className="fixed inset-0 overflow-hidden" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onDoubleClick={onPaneDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => { setCtxMenu(null); setMenu(null) }}
        onInit={(inst) => {
          instanceRef.current = inst as ReactFlowInstance<Node<CanvasNodeData>, Edge>
          if (pendingViewportRef.current) {
            inst.setViewport(pendingViewportRef.current)
            pendingViewportRef.current = null
          }
        }}
        onMove={(_e, vp) => setZoom(vp.zoom)}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        fitView={false}
        // Loose: a drag from any handle to any handle connects (direction =
        // drag start as source). Strict (default) only allowed source→target,
        // which blocked connecting onto source-only nodes. connectionRadius
        // snaps near-misses so the small handles are easy to hit.
        connectionMode={ConnectionMode.Loose}
        connectionRadius={42}
        defaultEdgeOptions={{ animated: true, style: { stroke: CANVAS_TOKENS.accent, strokeWidth: 1.5 } }}
      >
        <Background variant={BackgroundVariant.Dots} gap={CANVAS_TOKENS.grid} size={1.4} color="rgba(255,255,255,0.10)" />
        <Controls position="bottom-right" showInteractive={false} style={{ filter: 'invert(0.9) hue-rotate(180deg)' }} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={minimapColor}
          maskColor="rgba(0,0,0,0.6)"
          style={{ background: CANVAS_TOKENS.bg.panel, border: `1px solid ${CANVAS_TOKENS.hairline}`, marginBottom: 56 }}
        />
      </ReactFlow>

      {/* Top bar */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between px-4"
        style={{ background: `${CANVAS_TOKENS.bg.panel}cc`, borderBottom: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}
      >
        <div className="pointer-events-auto flex items-center gap-3 font-mono text-[13px]">
          <Link href="/zh/v2" className="text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>‹ 返回</Link>
          <span style={{ color: CANVAS_TOKENS.accent }}>◇</span>
          <span style={{ color: CANVAS_TOKENS.text.primary }}>无限画布</span>
          <span style={{ color: CANVAS_TOKENS.text.muted }}>· 未命名</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 font-mono text-[12px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
          <span className="rounded px-2 py-1" style={{ background: CANVAS_TOKENS.bg.hover }}>{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Empty hint */}
      {nodes.length === 0 && !menu ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1" style={{ color: CANVAS_TOKENS.text.muted }}>
          <div className="text-2xl" style={{ color: CANVAS_TOKENS.accent }}>◇</div>
          <p className="text-sm">双击画布添加节点</p>
          <p className="text-[12px]" style={{ color: CANVAS_TOKENS.text.muted }}>从节点右侧端点拖出 → 连下一个节点</p>
        </div>
      ) : null}

      {/* Add-node menu */}
      {menu ? (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setMenu(null)} />
          <div
            className="absolute z-40 w-48 overflow-hidden rounded-xl"
            style={{
              left: Math.min(menu.screenX, (wrapperRef.current?.clientWidth ?? 800) - 200),
              top: Math.min(menu.screenY, (wrapperRef.current?.clientHeight ?? 600) - 220),
              background: CANVAS_TOKENS.bg.popover,
              border: `1px solid ${CANVAS_TOKENS.hairline}`,
              boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            }}
          >
            <div className="px-3 py-2 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted, borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
              {menu.fromNodeId ? '连接 · 新节点' : '添加节点'}
            </div>
            {ADD_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addNodeFromMenu(t)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-white/5"
                style={{ color: CANVAS_TOKENS.text.primary }}
              >
                <span className="flex items-center gap-2">
                  <span style={{ color: NODE_META[t].accent }}>◆</span>
                  {NODE_META[t].label}
                </span>
                <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{NODE_META[t].hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* Node right-click context menu */}
      {ctxMenu ? (
        <>
          <div className="absolute inset-0 z-30" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div
            className="absolute z-40 w-52 overflow-hidden rounded-xl py-1"
            style={{
              left: Math.min(ctxMenu.screenX, (wrapperRef.current?.clientWidth ?? 800) - 220),
              top: Math.min(ctxMenu.screenY, (wrapperRef.current?.clientHeight ?? 600) - 240),
              background: CANVAS_TOKENS.bg.popover,
              border: `1px solid ${CANVAS_TOKENS.hairline}`,
              boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            }}
          >
            {([
              { label: '优化工作流布局', on: () => optimizeLayout(), kbd: '' },
              { sep: true },
              { label: '复制节点', on: () => copyNode(ctxMenu.nodeId), kbd: '⌘C' },
              { label: '创建副本', on: () => duplicateNode(ctxMenu.nodeId), kbd: '⌘D' },
              { label: '粘贴', on: () => pasteNode(), kbd: '⌘V', disabled: !clipboardRef.current },
              { label: '删除', on: () => deleteNode(ctxMenu.nodeId), kbd: '⌘⌫', danger: true },
            ] as Array<{ label?: string; on?: () => void; kbd?: string; sep?: boolean; disabled?: boolean; danger?: boolean }>).map((item, i) =>
              item.sep ? (
                <div key={`sep-${i}`} className="my-1 h-px" style={{ background: CANVAS_TOKENS.hairline }} />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => { item.on?.(); setCtxMenu(null) }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/5 disabled:opacity-40"
                  style={{ color: item.danger ? '#FF8A8A' : CANVAS_TOKENS.text.primary }}
                >
                  <span>{item.label}</span>
                  {item.kbd ? <span className="font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>{item.kbd}</span> : null}
                </button>
              ),
            )}
          </div>
        </>
      ) : null}

      {/* 镜头序列条 — the drama as an ordered list of shots */}
      {showSequence ? (
        <div
          className="absolute inset-x-0 bottom-20 z-20 mx-auto flex max-w-[92%] items-center gap-2 overflow-x-auto rounded-xl p-2"
          style={{ background: `${CANVAS_TOKENS.bg.panel}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
        >
          <span className="shrink-0 px-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>镜头序列 ({shots.length})</span>
          {shots.length === 0 ? (
            <span className="px-2 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>暂无镜头 · 加图片/视频节点</span>
          ) : null}
          {shots.map((n, i) => {
            const data = n.data as CanvasNodeData
            const url = data.resultUrl ?? data.anchorUrl ?? null
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => focusNode(n.id)}
                title={data.title}
                className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md"
                style={{ border: `1px solid ${n.selected ? CANVAS_TOKENS.accent : CANVAS_TOKENS.hairline}`, background: CANVAS_TOKENS.bg.app }}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`shot ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>待生成</span>
                )}
                <span className="absolute left-1 top-1 rounded px-1 font-mono text-[10px]" style={{ background: `${CANVAS_TOKENS.bg.canvas}cc`, color: CANVAS_TOKENS.text.primary }}>{i + 1}</span>
                {n.type === 'video' ? <span className="absolute right-1 bottom-1 text-[11px]" style={{ color: CANVAS_TOKENS.accent }}>▶</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* 工具箱 — one-click preset workflows */}
      {toolbox ? (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setToolbox(false)} />
          <div className="absolute bottom-20 left-1/2 z-30 w-80 -translate-x-1/2 rounded-xl p-2" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
            <div className="mb-1 px-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>工具箱 · 一键预设工作流</div>
            {TOOLBOX_PRESETS.map((p) => (
              <button key={p.key} type="button" onClick={() => applyToolboxPreset(p.key)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/5" style={{ color: CANVAS_TOKENS.text.primary }}>
                <span className="text-[13px]">{p.label}</span>
                <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{p.hint}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* 角色库 — drop a saved character (CharacterAppearance) as a node */}
      {charLib ? (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setCharLib(false)} />
          <div className="absolute bottom-20 left-1/2 z-30 max-h-[50vh] w-96 -translate-x-1/2 overflow-y-auto rounded-xl p-2" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 16px 40px rgba(0,0,0,0.55)' }}>
            <div className="mb-1 px-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>角色库 · 点选放入画布</div>
            {characterLibQuery.isLoading ? <div className="px-2 py-3 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>加载中…</div> : null}
            {characterLibQuery.isError ? <div className="px-2 py-3 text-[11px]" style={{ color: '#FF8A8A' }}>加载角色库失败 · <button type="button" className="underline" onClick={() => characterLibQuery.refetch()}>重试</button></div> : null}
            {characterLibQuery.data && characterLibQuery.data.length === 0 ? <div className="px-2 py-3 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>暂无角色 · 可在资产库创建</div> : null}
            <div className="grid grid-cols-3 gap-2">
              {(characterLibQuery.data ?? []).map((c) => (
                <button key={`${c.characterId}-${c.appearanceId}`} type="button" onClick={() => dropCharacter(c.name, c.imageUrl)} title={c.name} className="overflow-hidden rounded-md" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}`, background: CANVAS_TOKENS.bg.app }}>
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt={c.name} className="h-20 w-full object-cover" />
                  ) : null}
                  <div className="truncate px-1 py-0.5 text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary }}>{c.name}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {/* Bottom-center dock */}
      <div
        className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5"
        style={{ background: `${CANVAS_TOKENS.bg.card}e6`, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
      >
        {dockButtons.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            className="rounded-full px-3 py-1.5 font-mono text-[12px] transition-colors hover:bg-white/10"
            style={{ color: b.key === 'add' ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.secondary }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface CanvasClientProps {
  locale: string
}

export function CanvasClient(_props: CanvasClientProps) {
  return (
    <ReactFlowProvider>
      <CanvasGenerationProvider>
        <CanvasInner />
      </CanvasGenerationProvider>
    </ReactFlowProvider>
  )
}
