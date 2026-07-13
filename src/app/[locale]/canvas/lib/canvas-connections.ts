import { NODE_META, type CanvasNodeType } from './canvas-tokens'
import type { CanvasEdgeData, CanvasPortType } from './canvas-types'

export const CANVAS_SOURCE_HANDLE = 'canvas-output'
export const CANVAS_TARGET_HANDLE = 'canvas-input'

/**
 * Data-flow contract for ordinary drag connections. Operations that create
 * nodes directly (Director capture/export, Script fan-out) do not need a wire.
 * Every allowed pair must be consumed by the target implementation.
 *
 * 注：director 不在任何 target 的白名单里当 source —— CanvasClient.onConnect
 * 会把 director 参与的拖线一律翻转成 target（导演台只吃卡司），所以
 * director→image/video 的手动连线在到达本契约前就不存在。若未来开放
 * 「导演台输出 handle」，此表要同步补 director 为合法 source。
 */
const ACCEPTS: Record<CanvasNodeType, readonly CanvasNodeType[]> = {
  text: [],
  script: ['text', 'character', 'image'],
  image: ['text', 'script', 'character', 'image', 'video'],
  video: ['text', 'script', 'character', 'image', 'video'],
  audio: ['text', 'script'],
  composition: ['video', 'composition', 'audio'],
  director: ['character', 'image'],
  character: [],
  group: [],
}

export function canConnectCanvasNodes(source: CanvasNodeType, target: CanvasNodeType): boolean {
  return ACCEPTS[target].includes(source)
}

/** 拒线时给用户看的原因（中文节点名，非类型代号）。 */
export function canvasConnectionHint(source: CanvasNodeType, target: CanvasNodeType): string {
  return canConnectCanvasNodes(source, target)
    ? ''
    : `「${NODE_META[source].label}」的输出不能被「${NODE_META[target].label}」节点使用`
}

function portTypeForSource(source: CanvasNodeType): CanvasPortType | null {
  switch (source) {
    case 'text': return 'text'
    case 'script': return 'script'
    case 'character': return 'identity-image'
    case 'image': return 'frame-image'
    case 'video': return 'video-clip'
    case 'audio': return 'audio-voice'
    case 'composition': return 'video-clip'
    case 'group': return 'storyboard-group'
    case 'director': return null
  }
}

/** Deterministic edge metadata for new connections and legacy migration. */
export function inferCanvasEdgeData(
  source: CanvasNodeType,
  target: CanvasNodeType,
  options: { frameIndex?: number; targetMode?: string } = {},
): CanvasEdgeData {
  if (!canConnectCanvasNodes(source, target)) {
    return {
      portType: portTypeForSource(source) ?? 'frame-image',
      invalid: true,
      invalidReason: canvasConnectionHint(source, target),
    }
  }
  const portType = portTypeForSource(source)
  if (!portType) {
    return { portType: 'frame-image', invalid: true, invalidReason: '导演台没有普通连线输出，请使用发送镜头或导出预演' }
  }
  if (target === 'video' && options.targetMode === 'firstlast' && (source === 'image' || source === 'video')) {
    const order = options.frameIndex ?? 0
    return { portType, order, role: order === 0 ? 'first-frame' : order === 1 ? 'last-frame' : 'reference' }
  }
  if (source === 'audio' && target === 'composition') return { portType, role: options.targetMode === 'music' ? 'music' : 'voice' }
  if (source === 'character') return { portType, role: 'reference' }
  if ((source === 'image' || source === 'video') && (target === 'image' || target === 'video')) {
    return { portType, role: 'reference' }
  }
  return { portType }
}
