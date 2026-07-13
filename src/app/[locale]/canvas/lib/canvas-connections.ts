import { NODE_META, type CanvasNodeType } from './canvas-tokens'

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
