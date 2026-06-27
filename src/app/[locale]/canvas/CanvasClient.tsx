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
import { CanvasGenerationProvider } from './lib/canvas-generation'
import { useCanvas, useSaveCanvas } from '@/lib/query/mutations/canvas-mutations'
import { makeMediaNode } from './nodes/MediaNode'
import { TextNode } from './nodes/TextNode'
import { CharacterNode } from './nodes/CharacterNode'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `n_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const nodeTypes: NodeTypes = {
  image: makeMediaNode('image'),
  video: makeMediaNode('video'),
  text: TextNode,
  character: CharacterNode,
}

const ADD_ORDER: CanvasNodeType[] = ['image', 'video', 'character', 'text']

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
  const [zoom, setZoom] = useState(1)
  const rf = useReactFlow()
  const instanceRef = useRef<ReactFlowInstance<Node<CanvasNodeData>, Edge> | null>(null)
  const loadedRef = useRef(false)
  const canvasIdRef = useRef<string | null>(null)
  const pendingViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const canvasQuery = useCanvas()
  const save = useSaveCanvas()

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
      const vp = instanceRef.current?.getViewport() ?? { x: 0, y: 0, zoom: 1 }
      const serialized = serializeCanvas(nodes, edges, vp)
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
        },
      )
    }, 800)
    return () => clearTimeout(t)
    // save is stable from react-query; intentionally excluded to avoid re-arming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
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

  const minimapColor = useCallback((n: Node) => NODE_META[(n.type as CanvasNodeType) ?? 'text']?.accent ?? CANVAS_TOKENS.text.muted, [])

  const dockButtons = useMemo(
    () => [
      { key: 'add', label: '添加节点', onClick: openDockMenu },
      { key: 'toolbox', label: '工具箱', onClick: () => {} },
      { key: 'material', label: '素材库', onClick: () => {} },
      { key: 'character', label: '角色库', onClick: () => {} },
      { key: 'history', label: '历史', onClick: () => {} },
    ],
    [openDockMenu],
  )

  return (
    <div ref={wrapperRef} className="fixed inset-0 overflow-hidden" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onDoubleClick={onPaneDoubleClick}
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
