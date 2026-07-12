/**
 * 导演路线方案 → previz StageShot[] 物化（S4，纯函数）。
 *
 * 每个方案镜头：按 cameraPreset（camera-presets 同款解析）对焦 focus 卡司
 * 摆出起幅机位，movement 决定落幅（推近/拉远/横移/升降的确定性位移；
 * 固定 = 起落幅同款）；全体人偶/道具的当前摆位快照进两个关键帧（走位
 * 用户后续自己拉调度线）。总时长交 clampShots 收口。
 */
import { CAMERA_PRESETS, computePreset } from './camera-presets'
import { clampShots, type ShotKeyframe, type StageShot } from './previz-types'
import type { StageMannequin, StageProp, Vec3 } from './stage-types'
import type { DirectorRoutePlan } from '@/lib/canvas/director-routes-schema'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `shot_${Date.now()}_${Math.round(Math.random() * 1e6)}`

/** movement → 落幅相机的确定性位移。 */
function applyMovement(camera: ShotKeyframe['camera'], movement: string): ShotKeyframe['camera'] {
  const p = camera.position
  const t = camera.target
  const dir: Vec3 = [t[0] - p[0], t[1] - p[1], t[2] - p[2]]
  const len = Math.hypot(...dir) || 1
  const clone = (pos: Vec3): ShotKeyframe['camera'] => ({ ...camera, position: pos, target: [...t] })
  switch (movement) {
    case '推近':
      return clone([p[0] + dir[0] * 0.4, p[1] + dir[1] * 0.4, p[2] + dir[2] * 0.4])
    case '拉远':
      return clone([p[0] - dir[0] * 0.5, p[1] - dir[1] * 0.5, p[2] - dir[2] * 0.5])
    case '横移': {
      // 垂直于视线的水平方向（up × dir）
      const side: Vec3 = [dir[2] / len, 0, -dir[0] / len]
      return clone([p[0] + side[0] * 1.4, p[1], p[2] + side[2] * 1.4])
    }
    case '升降':
      return clone([p[0], p[1] + 1.3, p[2]])
    default:
      return { ...camera, position: [...p], target: [...t] }
  }
}

export function materializeRoutePlan(
  plan: DirectorRoutePlan,
  mannequins: StageMannequin[],
  props: StageProp[],
): StageShot[] {
  const actors: ShotKeyframe['actors'] = Object.fromEntries(
    [...mannequins, ...props].map((a) => [a.id, { position: [...a.position] as Vec3, rotation: [...a.rotation] as Vec3 }]),
  )
  const cloneActors = (): ShotKeyframe['actors'] =>
    Object.fromEntries(Object.entries(actors).map(([id, a]) => [id, { position: [...a.position] as Vec3, rotation: [...a.rotation] as Vec3 }]))

  const shots: StageShot[] = plan.shots.map((s) => {
    const focusMannequin = (s.focus ? mannequins.find((m) => m.label === s.focus) : null) ?? mannequins[0] ?? null
    const focus: Vec3 = focusMannequin
      ? [focusMannequin.position[0], focusMannequin.position[1] + 1.0, focusMannequin.position[2]]
      : [0, 1, 0]
    const facingY = focusMannequin?.rotation[1] ?? 0
    const preset = CAMERA_PRESETS.find((p) => p.name === s.cameraPreset && !p.current) ?? CAMERA_PRESETS.find((p) => p.name === '正面中景')!
    const resolved = computePreset(preset, focus, facingY, null)
    const startCamera: ShotKeyframe['camera'] = {
      position: resolved.position,
      target: resolved.target,
      fov: resolved.fov,
      ...(resolved.roll ? { roll: resolved.roll } : {}),
    }
    return {
      id: uid(),
      label: s.label,
      ...(s.note ? { note: s.note } : {}),
      durationSec: s.durationSec,
      start: { camera: startCamera, actors: cloneActors() },
      end: { camera: applyMovement(startCamera, s.movement), actors: cloneActors() },
      easing: 'easeInOut' as const,
    }
  })
  return clampShots(shots)
}
