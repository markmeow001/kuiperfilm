/**
 * 程序化走路循环（S2 后补）— 按「沿调度线已走距离」驱动的关节摆动。
 *
 * phase = travelDist / WALK_STRIDE_M * 2π：步频锁定在空间距离上，与镜头
 * 时长/速率无关（走得快摆得快），暂停 scrub 时姿势也稳定可复现。角度
 * 惯例与 pose-presets 相同：hip.x<0=前摆、knee.x>0=屈、elbow.x<0=前屈。
 * 输出是**叠加量**（PrevizDriver 加在人偶自身 pose 之上），纯函数可单测。
 */

/** 一个完整步态循环（左右各一步）走过的米数。 */
export const WALK_STRIDE_M = 0.9

const D = (deg: number) => (deg * Math.PI) / 180

export interface WalkJointAngles {
  hipL: number
  hipR: number
  kneeL: number
  kneeR: number
  shoulderL: number
  shoulderR: number
  elbowL: number
  elbowR: number
  /** 骨盆上下 bob（米，叠加在 pelvis Y 上）。 */
  rootBobY: number
}

export function walkJointAngles(phase: number, intensity = 1): WalkJointAngles {
  const s = Math.sin(phase)
  // 膝盖只在该腿前摆（swing）段屈起；支撑段近伸直。
  const kneeSwingL = Math.max(0, Math.sin(phase - Math.PI * 0.25))
  const kneeSwingR = Math.max(0, Math.sin(phase + Math.PI - Math.PI * 0.25))
  return {
    hipL: -D(26) * s * intensity,
    hipR: D(26) * s * intensity,
    kneeL: D(30) * kneeSwingL * intensity,
    kneeR: D(30) * kneeSwingR * intensity,
    // 手臂与同侧腿反向摆
    shoulderL: D(18) * s * intensity,
    shoulderR: -D(18) * s * intensity,
    elbowL: -D(20) * intensity,
    elbowR: -D(20) * intensity,
    // 双支撑期最低、单脚支撑中段最高 → 频率是步频两倍
    rootBobY: 0.025 * Math.abs(Math.cos(phase)) * intensity,
  }
}
