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
  type: 'text' | 'image' | 'video' | 'character' | 'mask',
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
    label: '故事腳本 → 分鏡',
    hint: '文字（腳本）→ 圖片',
    build: (mk, ox, oy) => {
      const t = mk(), img = mk()
      return {
        nodes: [
          node(t, 'text', ox, oy, { title: '腳本', prompt: '' }),
          node(img, 'image', ox + COL, oy, { title: '分鏡', prompt: '' }),
        ],
        edges: [edge(mk(), t, img)],
      }
    },
  },
  {
    key: 'char-turnaround',
    label: '角色三視圖',
    hint: '角色 → 圖片（正／側／背）',
    build: (mk, ox, oy) => {
      const c = mk(), img = mk()
      return {
        nodes: [
          node(c, 'character', ox, oy, { title: '角色' }),
          node(img, 'image', ox + COL, oy, { title: '角色三視圖', prompt: '同一角色的正面、侧面、背面三视图，统一姿势与造型，白色背景' }),
        ],
        edges: [edge(mk(), c, img)],
      }
    },
  },
  {
    key: 'i2v',
    label: '首幀圖生影片',
    hint: '圖片 → 影片（i2v）',
    build: (mk, ox, oy) => {
      const img = mk(), vid = mk()
      return {
        nodes: [
          node(img, 'image', ox, oy, { title: '首幀', prompt: '' }),
          node(vid, 'video', ox + COL, oy, { title: '影片', prompt: '', genMode: 'image' }),
        ],
        edges: [edge(mk(), img, vid)],
      }
    },
  },
  {
    key: 'plate-to-mask',
    label: '實拍畫面 → 遮罩',
    hint: '圖片 → 手動畫背景／修補範圍',
    build: (mk, ox, oy) => {
      const img = mk(), mask = mk()
      return {
        nodes: [
          node(img, 'image', ox, oy, { title: '實拍畫面', prompt: '' }),
          node(mask, 'mask', ox + COL, oy, { title: '背景遮罩' }),
        ],
        edges: [edge(mk(), img, mask)],
      }
    },
  },
  {
    key: 'full-chain',
    label: '角色＋腳本 → 分鏡 → 影片',
    hint: '完整短劇一鏡鏈路',
    build: (mk, ox, oy) => {
      const c = mk(), t = mk(), img = mk(), vid = mk()
      return {
        nodes: [
          node(c, 'character', ox, oy, { title: '角色' }),
          node(t, 'text', ox, oy + ROW, { title: '腳本', prompt: '' }),
          node(img, 'image', ox + COL, oy + ROW / 2, { title: '分鏡', prompt: '' }),
          node(vid, 'video', ox + COL * 2, oy + ROW / 2, { title: '影片', prompt: '', genMode: 'image' }),
        ],
        edges: [edge(mk(), c, img), edge(mk(), t, img), edge(mk(), img, vid)],
      }
    },
  },
]
