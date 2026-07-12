/**
 * 导演指令生成 — 从 previz 镜头序列确定性生成中文指令文本（非 LLM）。
 *
 * 导出预演视频喂 R2V 时，这段文本作为视频 prompt 的骨架：模型拿到参考
 * 视频（机位运动+人物调度）+ 这份文字描述（每镜时长/景别/运镜/走位），
 * 两者互相锚定。纯函数、无副作用，node 端可单测。
 */
import type { StageShot } from './previz-types'
import type { Vec3 } from './stage-types'

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** 从起幅→落幅的机位变化归类一个中文运镜词。 */
export function classifyCameraMove(shot: StageShot): string {
  const s = shot.start.camera
  const e = shot.end.camera
  const moved = dist(s.position, e.position)
  if ((shot.cameraWaypoints?.length ?? 0) > 0 && moved > 0.15) return '弧线运镜'
  if (moved < 0.15) {
    if (e.fov < s.fov - 5) return '变焦推近'
    if (e.fov > s.fov + 5) return '变焦拉远'
    return '固定机位'
  }
  const dStart = dist(s.position, s.target)
  const dEnd = dist(e.position, e.target)
  const dy = Math.abs(e.position[1] - s.position[1])
  if (dEnd < dStart * 0.8) return '推近'
  if (dEnd > dStart * 1.25) return '拉远'
  if (dy > moved * 0.6) return '升降'
  return '横移'
}

/** 该镜头里实际发生位移的 actor id 列表（>0.3m 才算走位）。 */
function movingActors(shot: StageShot): string[] {
  const out: string[] = []
  for (const [id, a] of Object.entries(shot.start.actors)) {
    const b = shot.end.actors[id]
    if (b && dist(a.position, b.position) > 0.3) out.push(id)
  }
  return out
}

export interface DirectorTextOptions {
  /** 只描述这一个镜头（导出单镜时）。缺省 = 全片。 */
  shotId?: string
}

/**
 * 生成中文导演指令。actorLabels 把 actor id 映射为可读名（角色A/车…），
 * 缺失的 id 原样输出。
 */
export function buildPrevizDirectorText(
  shots: StageShot[],
  actorLabels: Record<string, string>,
  options: DirectorTextOptions = {},
): string {
  const scoped = options.shotId ? shots.filter((s) => s.id === options.shotId) : shots
  if (scoped.length === 0) return ''

  // 每镜在全片时间轴上的起点（单镜 scope 也按全片时序标注，便于对回原序列）
  const startAt = new Map<string, number>()
  let acc = 0
  for (const s of shots) {
    startAt.set(s.id, acc)
    acc += s.durationSec
  }
  const scopedTotal = scoped.reduce((sum, s) => sum + s.durationSec, 0)

  const lines: string[] = []
  lines.push(
    `【预演参考】全长 ${scopedTotal.toFixed(1)} 秒，共 ${scoped.length} 镜。` +
      `严格跟随参考视频的镜头运动与人物调度，保持每个镜头的时长与切换节奏。`,
  )
  for (const s of scoped) {
    const t0 = startAt.get(s.id) ?? 0
    const t1 = t0 + s.durationSec
    const move = classifyCameraMove(s)
    const movers = movingActors(s).map((id) => actorLabels[id] ?? id)
    const parts = [
      `${s.label}（${t0.toFixed(1)}-${t1.toFixed(1)}s）`,
      ...(s.note ? [s.note] : []),
      move,
      ...(movers.length > 0 ? [`${movers.join('、')} 有走位`] : []),
    ]
    lines.push(parts.join('：').replace('：', '｜').replace(/：/g, ' / ').replace('｜', '：'))
  }
  return lines.join('\n')
}
