import type { CanvasNodeType } from '@/app/[locale]/canvas/lib/canvas-tokens'

export const CANVAS_ASSISTANT_NODE_TYPES = [
  'text',
  'script',
  'image',
  'video',
  'audio',
  'mask',
  'composition',
  'director',
  'character',
  'scene',
  'prop',
] as const satisfies readonly CanvasNodeType[]

export type CanvasAssistantNodeType = (typeof CANVAS_ASSISTANT_NODE_TYPES)[number]
export type CanvasAssistantArrangeMode = 'left' | 'top' | 'horizontal' | 'vertical'

export interface CanvasAssistantCreateOperation {
  kind: 'create_node'
  alias: string
  nodeType: CanvasAssistantNodeType
  title: string
  prompt?: string
  aspectRatio?: string
}

export interface CanvasAssistantUpdateOperation {
  kind: 'update_nodes'
  nodeIds: string[]
  patch: {
    title?: string
    prompt?: string
    aspectRatio?: string
  }
}

export interface CanvasAssistantConnectOperation {
  kind: 'connect'
  source: string
  target: string
}

export interface CanvasAssistantArrangeOperation {
  kind: 'arrange'
  nodeIds: string[]
  mode: CanvasAssistantArrangeMode
}

export type CanvasAssistantOperation =
  | CanvasAssistantCreateOperation
  | CanvasAssistantUpdateOperation
  | CanvasAssistantConnectOperation
  | CanvasAssistantArrangeOperation

export interface CanvasAssistantPlan {
  summary: string
  operations: CanvasAssistantOperation[]
}

const MAX_OPERATIONS = 12
const ASPECT_RATIO = /^\d{1,2}:\d{1,2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Canvas Assistant: ${field} is required`)
  return value.trim().slice(0, max)
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(`Canvas Assistant: ${field} must contain 1-20 ids`)
  }
  const ids = value.map((item) => requiredString(item, field, 120))
  return [...new Set(ids)]
}

function parseOperation(value: unknown): CanvasAssistantOperation {
  if (!isRecord(value)) throw new Error('Canvas Assistant: operation must be an object')
  if (value.kind === 'create_node') {
    const nodeType = value.nodeType
    if (typeof nodeType !== 'string' || !CANVAS_ASSISTANT_NODE_TYPES.includes(nodeType as CanvasAssistantNodeType)) {
      throw new Error('Canvas Assistant: unsupported node type')
    }
    const aspectRatio = optionalString(value.aspectRatio, 12)
    if (aspectRatio && !ASPECT_RATIO.test(aspectRatio)) throw new Error('Canvas Assistant: invalid aspect ratio')
    return {
      kind: 'create_node',
      alias: requiredString(value.alias, 'alias', 48),
      nodeType: nodeType as CanvasAssistantNodeType,
      title: requiredString(value.title, 'title', 80),
      ...(optionalString(value.prompt, 5000) ? { prompt: optionalString(value.prompt, 5000) } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
    }
  }
  if (value.kind === 'update_nodes') {
    if (!isRecord(value.patch)) throw new Error('Canvas Assistant: update patch is required')
    const title = optionalString(value.patch.title, 80)
    const prompt = optionalString(value.patch.prompt, 5000)
    const aspectRatio = optionalString(value.patch.aspectRatio, 12)
    if (!title && !prompt && !aspectRatio) throw new Error('Canvas Assistant: update patch is empty')
    if (aspectRatio && !ASPECT_RATIO.test(aspectRatio)) throw new Error('Canvas Assistant: invalid aspect ratio')
    return {
      kind: 'update_nodes',
      nodeIds: stringArray(value.nodeIds, 'nodeIds'),
      patch: { ...(title ? { title } : {}), ...(prompt ? { prompt } : {}), ...(aspectRatio ? { aspectRatio } : {}) },
    }
  }
  if (value.kind === 'connect') {
    return {
      kind: 'connect',
      source: requiredString(value.source, 'source', 120),
      target: requiredString(value.target, 'target', 120),
    }
  }
  if (value.kind === 'arrange') {
    const mode = value.mode
    if (mode !== 'left' && mode !== 'top' && mode !== 'horizontal' && mode !== 'vertical') {
      throw new Error('Canvas Assistant: invalid arrange mode')
    }
    return { kind: 'arrange', nodeIds: stringArray(value.nodeIds, 'nodeIds'), mode }
  }
  throw new Error('Canvas Assistant: unsupported operation')
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Canvas Assistant: no JSON plan returned')
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown
}

export function parseCanvasAssistantPlan(value: unknown): CanvasAssistantPlan {
  const root = typeof value === 'string' ? extractJsonObject(value) : value
  if (!isRecord(root)) throw new Error('Canvas Assistant: plan must be an object')
  if (!Array.isArray(root.operations) || root.operations.length === 0 || root.operations.length > MAX_OPERATIONS) {
    throw new Error(`Canvas Assistant: plan must contain 1-${MAX_OPERATIONS} operations`)
  }
  const operations = root.operations.map(parseOperation)
  const aliases = operations.filter((op): op is CanvasAssistantCreateOperation => op.kind === 'create_node').map((op) => op.alias)
  if (new Set(aliases).size !== aliases.length) throw new Error('Canvas Assistant: duplicate aliases')
  return { summary: requiredString(root.summary, 'summary', 240), operations }
}

export function describeCanvasAssistantOperation(operation: CanvasAssistantOperation): string {
  if (operation.kind === 'create_node') return `建立「${operation.title}」${operation.nodeType} 节点`
  if (operation.kind === 'update_nodes') return `更新 ${operation.nodeIds.length} 个节点`
  if (operation.kind === 'connect') return `连接 ${operation.source} → ${operation.target}`
  return `${operation.mode === 'horizontal' ? '横向排列' : operation.mode === 'vertical' ? '纵向排列' : operation.mode === 'left' ? '左对齐' : '顶对齐'} ${operation.nodeIds.length} 个节点`
}
