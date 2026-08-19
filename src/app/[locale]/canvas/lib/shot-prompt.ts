/**
 * 分镜 → 生成 prompt 的唯一组装点。
 *
 * 批量生图、铺图节点、铺视频节点必须用同一个函数组 prompt，否则「批量生成
 * 的图」和「之后单独重生的图」会拿到不同的提示词（一致性静默漂移）。镜头
 * 语言字段（景别/机位/焦段/运镜）逐项标注拼接，而不是揉进散文——生图模型
 * 对显式摄影指令的遵循度远高于埋在描述里的暗示。
 */
import type { CanvasStoryboardShot } from './canvas-types'

function cameraLanguage(shot: CanvasStoryboardShot): string {
  const parts: string[] = []
  if (shot.shotSize?.trim()) parts.push(`景别：${shot.shotSize.trim()}`)
  if (shot.cameraAngle?.trim()) parts.push(`机位：${shot.cameraAngle.trim()}`)
  if (shot.lens?.trim()) parts.push(`镜头：${shot.lens.trim()}`)
  return parts.join('；')
}

/** 单镜生图 prompt：画面 ＋ 表演 ＋ 站位 ＋ 镜头语言 ＋ 全片色调。 */
export function composeShotImagePrompt(
  shot: CanvasStoryboardShot,
  colorTone?: string | null,
): string {
  const lines: string[] = [shot.description.trim()]
  if (shot.performance?.trim()) lines.push(`人物表演：${shot.performance.trim()}`)
  if (shot.blocking?.trim()) lines.push(`站位调度：${shot.blocking.trim()}`)
  const camera = cameraLanguage(shot)
  if (camera) lines.push(camera)
  if (colorTone?.trim()) lines.push(`整体色调：${colorTone.trim()}`)
  return lines.filter(Boolean).join('\n')
}

/** 单镜生视频 prompt：生图 prompt ＋ 运镜。 */
export function composeShotVideoPrompt(
  shot: CanvasStoryboardShot,
  colorTone?: string | null,
): string {
  const base = composeShotImagePrompt(shot, colorTone)
  return shot.cameraMove?.trim() ? `${base}\n运镜：${shot.cameraMove.trim()}` : base
}
