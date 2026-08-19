import type { Edge, Node } from '@xyflow/react'
import type { CanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { NODE_META, type CanvasNodeType } from './canvas-tokens'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from './canvas-types'
import { canConnectCanvasNodes, inferCanvasEdgeData } from './canvas-connections'
import { arrangeSelectedNodes } from './canvas-layout'

export interface CanvasAssistantApplyOptions {
  center: { x: number; y: number }
  createId: () => string
  /**
   * 底部 AI 输入条附带的剧本全文。LLM 只见摘要（省 token、避开长度上限、
   * 零复述漂移）；套用计画时把全文填进「第一个 prompt 为空的新建 script
   * 节点」。没有这样的节点则不落地（不隐式塞进别的节点）。
   */
  scriptAttachmentText?: string | null
}

export interface CanvasAssistantApplyResult {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
}

function resolveId(token: string, aliases: Map<string, string>, nodeIds: Set<string>): string {
  const resolved = aliases.get(token) ?? token
  if (!nodeIds.has(resolved)) throw new Error(`找不到节点：${token}`)
  return resolved
}

export function applyCanvasAssistantPlan(
  currentNodes: Node<CanvasNodeData>[],
  currentEdges: Edge[],
  plan: CanvasAssistantPlan,
  options: CanvasAssistantApplyOptions,
): CanvasAssistantApplyResult {
  let nodes = currentNodes.map((node) => ({ ...node, data: { ...node.data } }))
  let edges = currentEdges.map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined }))
  const aliases = new Map<string, string>()
  // 附件全文只落一次：第一个 prompt 为空的新建 script 节点。
  let attachmentText = options.scriptAttachmentText?.trim() || null

  for (const operation of plan.operations) {
    if (operation.kind === 'create_node') {
      const id = options.createId()
      if (aliases.has(operation.alias)) throw new Error(`重复的节点别名：${operation.alias}`)
      aliases.set(operation.alias, id)
      const index = aliases.size - 1
      const injectAttachment = Boolean(
        attachmentText && operation.nodeType === 'script' && !operation.prompt,
      )
      const injectedPrompt = injectAttachment ? attachmentText : null
      if (injectAttachment) attachmentText = null
      nodes = [
        ...nodes.map((node) => ({ ...node, selected: false })),
        {
          id,
          type: operation.nodeType,
          position: { x: options.center.x + (index % 3) * 320, y: options.center.y + Math.floor(index / 3) * 240 },
          selected: true,
          data: {
            title: operation.title || NODE_META[operation.nodeType].label,
            ...DEFAULT_NODE_DATA,
            ...(operation.prompt ? { prompt: operation.prompt } : {}),
            ...(injectedPrompt ? { prompt: injectedPrompt } : {}),
            ...(operation.aspectRatio ? { aspectRatio: operation.aspectRatio } : {}),
          },
        },
      ]
      continue
    }

    const nodeIds = new Set(nodes.map((node) => node.id))
    if (operation.kind === 'update_nodes') {
      const targets = new Set(operation.nodeIds.map((token) => resolveId(token, aliases, nodeIds)))
      const locked = nodes.find((node) => targets.has(node.id) && node.data.locked)
      if (locked) throw new Error(`节点「${locked.data.title}」已锁定，无法由 AI 修改`)
      nodes = nodes.map((node) => targets.has(node.id) ? { ...node, data: { ...node.data, ...operation.patch } } : node)
      continue
    }

    if (operation.kind === 'connect') {
      const source = resolveId(operation.source, aliases, nodeIds)
      const target = resolveId(operation.target, aliases, nodeIds)
      if (source === target) throw new Error('节点不能连接到自己')
      const sourceType = nodes.find((node) => node.id === source)?.type as CanvasNodeType | undefined
      const targetType = nodes.find((node) => node.id === target)?.type as CanvasNodeType | undefined
      if (!sourceType || !targetType || !canConnectCanvasNodes(sourceType, targetType)) {
        throw new Error('AI 计划包含不相容的节点连接')
      }
      if (edges.some((edge) => edge.source === source && edge.target === target)) continue
      edges = [...edges, {
        id: options.createId(),
        source,
        target,
        data: inferCanvasEdgeData(sourceType, targetType),
      }]
      continue
    }

    const targets = new Set(operation.nodeIds.map((token) => resolveId(token, aliases, nodeIds)))
    const previousSelection = new Map(nodes.map((node) => [node.id, Boolean(node.selected)]))
    nodes = arrangeSelectedNodes(
      nodes.map((node) => ({ ...node, selected: targets.has(node.id) })),
      operation.mode,
    ).map((node) => ({ ...node, selected: previousSelection.get(node.id) ?? false }))
  }

  return { nodes, edges }
}
