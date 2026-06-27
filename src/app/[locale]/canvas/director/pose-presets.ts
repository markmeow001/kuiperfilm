/**
 * 导演台 pose rig (M2b) — articulated skeleton pose model + 20 presets.
 *
 * A Pose is a pelvis offset (root, for sit/crouch lowering) + per-joint Euler
 * rotations (radians). Mannequin.tsx applies each joint rotation to its bone
 * group; the rig panel edits them via SliderRow; presets set them all at once.
 *
 * Sign conventions (figure faces +Z, bones hang -Y at rest):
 *  - shoulder/hip .x < 0 → limb swings forward (+Z); > 0 → back
 *  - shoulder .z: L<0 / R>0 → arm raises outward (T-pose)
 *  - elbow/knee .x > 0 → joint bends (calf/forearm swings back)
 *  - spine .x < 0 → lean forward (bow)
 */
export type Vec3 = [number, number, number]

export type Joint =
  | 'spine'
  | 'head'
  | 'shoulderL'
  | 'shoulderR'
  | 'elbowL'
  | 'elbowR'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'

export interface Pose {
  root: Vec3
  joints: Record<Joint, Vec3>
}

const D = (deg: number) => (deg * Math.PI) / 180
const rot = (x: number, y: number, z: number): Vec3 => [D(x), D(y), D(z)]

const ZERO_JOINTS: Record<Joint, Vec3> = {
  spine: [0, 0, 0],
  head: [0, 0, 0],
  shoulderL: [0, 0, 0],
  shoulderR: [0, 0, 0],
  elbowL: [0, 0, 0],
  elbowR: [0, 0, 0],
  hipL: [0, 0, 0],
  hipR: [0, 0, 0],
  kneeL: [0, 0, 0],
  kneeR: [0, 0, 0],
}

/** Build a pose, filling unspecified joints with rest (zero). */
function p(root: Vec3, j: Partial<Record<Joint, Vec3>> = {}): Pose {
  return { root, joints: { ...ZERO_JOINTS, ...j } }
}

export const REST_POSE: Pose = p([0, 0, 0])

export interface PosePreset {
  name: string
  pose: Pose
}

export const POSE_PRESETS: PosePreset[] = [
  { name: '站立', pose: p([0, 0, 0]) },
  { name: 'T型', pose: p([0, 0, 0], { shoulderL: rot(0, 0, -88), shoulderR: rot(0, 0, 88) }) },
  {
    name: '行走',
    pose: p([0, 0, 0], {
      hipL: rot(-24, 0, 0), hipR: rot(24, 0, 0), kneeL: rot(10, 0, 0), kneeR: rot(28, 0, 0),
      shoulderL: rot(20, 0, 0), shoulderR: rot(-20, 0, 0), elbowL: rot(-24, 0, 0), elbowR: rot(-24, 0, 0),
    }),
  },
  {
    name: '跑步',
    pose: p([0, -0.05, 0], {
      spine: rot(-14, 0, 0),
      hipL: rot(-42, 0, 0), hipR: rot(40, 0, 0), kneeL: rot(34, 0, 0), kneeR: rot(70, 0, 0),
      shoulderL: rot(46, 0, 0), shoulderR: rot(-46, 0, 0), elbowL: rot(-70, 0, 0), elbowR: rot(-70, 0, 0),
    }),
  },
  {
    name: '坐姿',
    pose: p([0, -0.42, 0], {
      hipL: rot(-86, 0, 0), hipR: rot(-86, 0, 0), kneeL: rot(86, 0, 0), kneeR: rot(86, 0, 0),
      shoulderL: rot(-8, 0, 0), shoulderR: rot(-8, 0, 0),
    }),
  },
  {
    name: '蹲下',
    pose: p([0, -0.52, 0], {
      // thighs ~horizontal (hip ~-92), shins ~vertical (knee undoes most of it)
      spine: rot(-14, 0, 0), hipL: rot(-92, 0, 0), hipR: rot(-92, 0, 0), kneeL: rot(92, 0, 0), kneeR: rot(92, 0, 0),
      shoulderL: rot(-30, 0, 0), shoulderR: rot(-30, 0, 0), elbowL: rot(-40, 0, 0), elbowR: rot(-40, 0, 0),
    }),
  },
  {
    name: '单膝跪',
    pose: p([0, -0.4, 0], {
      hipR: rot(-86, 0, 0), kneeR: rot(110, 0, 0), hipL: rot(-70, 0, 0), kneeL: rot(80, 0, 0), spine: rot(-6, 0, 0),
    }),
  },
  {
    name: '双膝跪',
    pose: p([0, -0.5, 0], {
      // thighs vertical (rest), shins fold back horizontal (knee ~+100)
      kneeL: rot(100, 0, 0), kneeR: rot(100, 0, 0),
    }),
  },
  {
    name: '叉腰',
    pose: p([0, 0, 0], {
      shoulderL: rot(0, 0, -28), shoulderR: rot(0, 0, 28), elbowL: rot(-104, -30, 0), elbowR: rot(-104, 30, 0),
    }),
  },
  { name: '倚靠', pose: p([0, 0, 0], { spine: rot(0, 0, 16), head: rot(0, 0, 8), shoulderR: rot(0, 0, 10) }) },
  {
    name: '鞠躬',
    pose: p([0, 0, 0], { spine: rot(-64, 0, 0), head: rot(20, 0, 0), shoulderL: rot(-18, 0, 0), shoulderR: rot(-18, 0, 0) }),
  },
  {
    name: '思考',
    pose: p([0, 0, 0], { head: rot(10, -8, 8), shoulderR: rot(-26, 0, 14), elbowR: rot(-128, 0, 0), shoulderL: rot(0, 0, -10), elbowL: rot(-40, 0, 0) }),
  },
  {
    name: '格斗',
    pose: p([0, -0.06, 0], {
      spine: rot(-8, 16, 0), hipL: rot(-20, 0, 0), hipR: rot(14, 0, 0), kneeL: rot(24, 0, 0), kneeR: rot(24, 0, 0),
      shoulderL: rot(-34, 0, -16), elbowL: rot(-96, 0, 0), shoulderR: rot(-28, 0, 16), elbowR: rot(-104, 0, 0),
    }),
  },
  {
    name: '踢球',
    pose: p([0, 0, 0], {
      spine: rot(-8, 0, 0), hipR: rot(-76, 0, 0), kneeR: rot(14, 0, 0), hipL: rot(14, 0, 0),
      shoulderL: rot(-28, 0, 0), shoulderR: rot(28, 0, 0),
    }),
  },
  {
    name: '投掷',
    pose: p([0, 0, 0], { spine: rot(0, -28, 0), shoulderR: rot(72, 0, 18), elbowR: rot(-58, 0, 0), shoulderL: rot(-36, 0, 0), elbowL: rot(-20, 0, 0) }),
  },
  {
    name: '推进',
    pose: p([0, 0, 0], {
      spine: rot(-12, 0, 0), shoulderL: rot(-82, 0, 0), shoulderR: rot(-82, 0, 0), elbowL: rot(-14, 0, 0), elbowR: rot(-14, 0, 0),
      hipL: rot(-18, 0, 0), hipR: rot(12, 0, 0),
    }),
  },
  { name: '招手', pose: p([0, 0, 0], { shoulderR: rot(0, 0, 96), elbowR: rot(-46, 0, 0), head: rot(0, -6, 0) }) },
  { name: '伸手', pose: p([0, 0, 0], { shoulderR: rot(-88, 0, 0), elbowR: rot(-4, 0, 0) }) },
  {
    name: '抱臂',
    pose: p([0, 0, 0], { shoulderL: rot(-14, 0, -18), elbowL: rot(-112, -40, 0), shoulderR: rot(-14, 0, 18), elbowR: rot(-112, 40, 0) }),
  },
  {
    name: '看手机',
    pose: p([0, 0, 0], { head: rot(26, 0, 0), shoulderL: rot(-42, 0, -8), elbowL: rot(-92, 0, 0), shoulderR: rot(-42, 0, 8), elbowR: rot(-92, 0, 0) }),
  },
]

/** Rig-panel slider layout: which joints/axes are editable, grouped + labelled. */
export interface JointAxisSlider {
  joint: Joint
  axis: 0 | 1 | 2
  label: string
}
export interface JointSliderGroup {
  group: string
  rows: JointAxisSlider[]
}

export const RIG_SLIDER_GROUPS: JointSliderGroup[] = [
  { group: '躯干', rows: [
    { joint: 'spine', axis: 0, label: '前倾' }, { joint: 'spine', axis: 1, label: '扭转' }, { joint: 'spine', axis: 2, label: '侧倾' },
  ] },
  { group: '头部', rows: [
    { joint: 'head', axis: 0, label: '点头' }, { joint: 'head', axis: 1, label: '转头' }, { joint: 'head', axis: 2, label: '歪头' },
  ] },
  { group: '左臂', rows: [
    { joint: 'shoulderL', axis: 0, label: '肩·前举' }, { joint: 'shoulderL', axis: 2, label: '肩·外展' }, { joint: 'shoulderL', axis: 1, label: '肩·扭转' }, { joint: 'elbowL', axis: 0, label: '肘·弯曲' },
  ] },
  { group: '右臂', rows: [
    { joint: 'shoulderR', axis: 0, label: '肩·前举' }, { joint: 'shoulderR', axis: 2, label: '肩·外展' }, { joint: 'shoulderR', axis: 1, label: '肩·扭转' }, { joint: 'elbowR', axis: 0, label: '肘·弯曲' },
  ] },
  { group: '左腿', rows: [
    { joint: 'hipL', axis: 0, label: '髋·前后' }, { joint: 'hipL', axis: 2, label: '髋·外展' }, { joint: 'kneeL', axis: 0, label: '膝·弯曲' },
  ] },
  { group: '右腿', rows: [
    { joint: 'hipR', axis: 0, label: '髋·前后' }, { joint: 'hipR', axis: 2, label: '髋·外展' }, { joint: 'kneeR', axis: 0, label: '膝·弯曲' },
  ] },
]
