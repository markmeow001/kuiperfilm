/**
 * 工具箱 — one-click preset workflows (LibTV 工具箱 equivalent). Each preset
 * drops a pre-wired node chain onto the canvas so the user starts from a working
 * graph instead of building it node by node. Pure data + a build() that returns
 * relative-positioned nodes + edges; CanvasClient places them at the viewport.
 */
import type { Edge, Node } from '@xyflow/react'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from './canvas-types'

type MakeId = () => string

interface BuiltGraph {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
}

export interface ToolboxPreset {
  key: string
  label: string
  hint: string
  build: (makeId: MakeId, originX: number, originY: number) => BuiltGraph
}

function node(
  id: string,
  type: 'text' | 'image' | 'video' | 'character',
  x: number,
  y: number,
  data: Partial<CanvasNodeData> & { title: string },
): Node<CanvasNodeData> {
  return { id, type, position: { x, y }, data: { ...DEFAULT_NODE_DATA, ...data } }
}
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target, animated: true })

const COL = 340
const ROW = 220

export const TOOLBOX_PRESETS: ToolboxPreset[] = [
  {
    key: 'script-to-shot',
    label: '故事脚本 → 分镜',
    hint: '文本(脚本) → 图片',
    build: (mk, ox, oy) => {
      const t = mk(), img = mk()
      return {
        nodes: [
          node(t, 'text', ox, oy, { title: '脚本', prompt: '' }),
          node(img, 'image', ox + COL, oy, { title: '分镜', prompt: '' }),
        ],
        edges: [edge(mk(), t, img)],
      }
    },
  },
  {
    key: 'char-turnaround',
    label: '角色三视图',
    hint: '角色 → 图片(正/侧/背)',
    build: (mk, ox, oy) => {
      const c = mk(), img = mk()
      return {
        nodes: [
          node(c, 'character', ox, oy, { title: '角色' }),
          node(img, 'image', ox + COL, oy, { title: '角色三视图', prompt: '同一角色的正面、侧面、背面三视图，统一姿势与造型，白色背景' }),
        ],
        edges: [edge(mk(), c, img)],
      }
    },
  },
  {
    key: 'i2v',
    label: '首帧图生视频',
    hint: '图片 → 视频(i2v)',
    build: (mk, ox, oy) => {
      const img = mk(), vid = mk()
      return {
        nodes: [
          node(img, 'image', ox, oy, { title: '首帧', prompt: '' }),
          node(vid, 'video', ox + COL, oy, { title: '视频', prompt: '', genMode: 'image' }),
        ],
        edges: [edge(mk(), img, vid)],
      }
    },
  },
  {
    key: 'full-chain',
    label: '角色+脚本 → 分镜 → 视频',
    hint: '完整短剧一镜链路',
    build: (mk, ox, oy) => {
      const c = mk(), t = mk(), img = mk(), vid = mk()
      return {
        nodes: [
          node(c, 'character', ox, oy, { title: '角色' }),
          node(t, 'text', ox, oy + ROW, { title: '脚本', prompt: '' }),
          node(img, 'image', ox + COL, oy + ROW / 2, { title: '分镜', prompt: '' }),
          node(vid, 'video', ox + COL * 2, oy + ROW / 2, { title: '视频', prompt: '', genMode: 'image' }),
        ],
        edges: [edge(mk(), c, img), edge(mk(), t, img), edge(mk(), img, vid)],
      }
    },
  },
]
