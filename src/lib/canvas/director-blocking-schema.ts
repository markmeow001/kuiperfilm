import { REST_POSE } from '@/app/[locale]/canvas/director/pose-presets'
import type {
  BodyType,
  DirectorStageState,
  PropKind,
  StageCamera,
  StageMannequin,
  StageProp,
  Vec3,
} from '@/app/[locale]/canvas/director/stage-types'

const BODY_TYPES: BodyType[] = ['male', 'female', 'broad', 'muscular', 'slender', 'teen', 'child', 'chibi']
const PROP_KINDS: PropKind[] = ['box', 'sphere', 'cylinder', 'car']
const SUBJECT_COLORS = ['#6FA8FF', '#FF9E6F', '#7BE3A4', '#C8A2FF', '#F4C44E', '#E86F9E']
const MAX_SUBJECTS = 6
const MAX_PROPS = 8

export interface DirectorBlockingSubject {
  label: string
  bodyType: BodyType
  position: Vec3
  facingDeg: number
}

export interface DirectorBlockingProp {
  label: string
  kind: PropKind
  position: Vec3
  rotationDeg: Vec3
  scale: Vec3
}

export interface DirectorBlockingCamera {
  label: string
  position: Vec3
  target: Vec3
  focalLengthMm: number
  framing: string
  rollDeg: number
}

export interface DirectorBlockingDraft {
  title: string
  summary: string
  subjects: DirectorBlockingSubject[]
  props: DirectorBlockingProp[]
  camera: DirectorBlockingCamera
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: ${path} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: ${path} must be a non-empty string`)
  return value.trim().slice(0, max)
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: ${path} must be between ${min} and ${max}`)
  }
  return value
}

function vec3(value: unknown, path: string, min: Vec3, max: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: ${path} must be a Vec3`)
  return [
    number(value[0], `${path}[0]`, min[0], max[0]),
    number(value[1], `${path}[1]`, min[1], max[1]),
    number(value[2], `${path}[2]`, min[2], max[2]),
  ]
}

export function parseDirectorBlockingDraft(output: string): DirectorBlockingDraft {
  const trimmed = output.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('CANVAS_DIRECTOR_BLOCKING_PARSE: no JSON object in model output')
  const root = object(JSON.parse(trimmed.slice(start, end + 1)) as unknown, 'root')
  if (!Array.isArray(root.subjects) || root.subjects.length < 1 || root.subjects.length > MAX_SUBJECTS) {
    throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: subjects must contain 1-${MAX_SUBJECTS} items`)
  }
  if (!Array.isArray(root.props) || root.props.length > MAX_PROPS) {
    throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: props must contain 0-${MAX_PROPS} items`)
  }
  const subjects = root.subjects.map((raw, index): DirectorBlockingSubject => {
    const item = object(raw, `subjects[${index}]`)
    if (!BODY_TYPES.includes(item.bodyType as BodyType)) throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: subjects[${index}].bodyType is invalid`)
    return {
      label: text(item.label, `subjects[${index}].label`, 40),
      bodyType: item.bodyType as BodyType,
      position: vec3(item.position, `subjects[${index}].position`, [-12, 0, -12], [12, 4, 12]),
      facingDeg: number(item.facingDeg, `subjects[${index}].facingDeg`, -360, 360),
    }
  })
  const props = root.props.map((raw, index): DirectorBlockingProp => {
    const item = object(raw, `props[${index}]`)
    if (!PROP_KINDS.includes(item.kind as PropKind)) throw new Error(`CANVAS_DIRECTOR_BLOCKING_PARSE: props[${index}].kind is invalid`)
    return {
      label: text(item.label, `props[${index}].label`, 40),
      kind: item.kind as PropKind,
      position: vec3(item.position, `props[${index}].position`, [-12, 0, -12], [12, 4, 12]),
      rotationDeg: vec3(item.rotationDeg, `props[${index}].rotationDeg`, [-360, -360, -360], [360, 360, 360]),
      scale: vec3(item.scale, `props[${index}].scale`, [0.1, 0.1, 0.1], [8, 8, 8]),
    }
  })
  const camera = object(root.camera, 'camera')
  const position = vec3(camera.position, 'camera.position', [-20, 0.1, -20], [20, 12, 20])
  const target = vec3(camera.target, 'camera.target', [-12, 0, -12], [12, 6, 12])
  const distanceSq = position.reduce((sum, value, index) => sum + (value - target[index]) ** 2, 0)
  if (distanceSq < 0.01) throw new Error('CANVAS_DIRECTOR_BLOCKING_PARSE: camera position and target are too close')
  return {
    title: text(root.title, 'title', 80),
    summary: text(root.summary, 'summary', 240),
    subjects,
    props,
    camera: {
      label: text(camera.label, 'camera.label', 40),
      position,
      target,
      focalLengthMm: number(camera.focalLengthMm, 'camera.focalLengthMm', 14, 200),
      framing: text(camera.framing, 'camera.framing', 80),
      rollDeg: number(camera.rollDeg, 'camera.rollDeg', -45, 45),
    },
  }
}

export function focalLengthToVerticalFov(focalLengthMm: number): number {
  const degrees = 2 * Math.atan(24 / (2 * focalLengthMm)) * 180 / Math.PI
  return Math.min(90, Math.max(12, degrees))
}

export function materializeDirectorBlocking(
  draft: DirectorBlockingDraft,
  previous: DirectorStageState,
  makeId: (kind: 'subject' | 'prop' | 'camera', index: number) => string,
): DirectorStageState {
  const mannequins: StageMannequin[] = draft.subjects.map((subject, index) => ({
    id: makeId('subject', index),
    label: subject.label,
    position: [...subject.position],
    rotation: [0, subject.facingDeg * Math.PI / 180, 0],
    scale: 1,
    color: SUBJECT_COLORS[index % SUBJECT_COLORS.length],
    bodyType: subject.bodyType,
    pose: REST_POSE,
  }))
  const props: StageProp[] = draft.props.map((prop, index) => ({
    id: makeId('prop', index),
    label: prop.label,
    kind: prop.kind,
    position: [...prop.position],
    rotation: prop.rotationDeg.map((value) => value * Math.PI / 180) as Vec3,
    scale: [...prop.scale],
    color: '#B84A39',
  }))
  const camera: StageCamera = {
    id: makeId('camera', 0),
    label: draft.camera.label,
    position: [...draft.camera.position],
    target: [...draft.camera.target],
    fov: focalLengthToVerticalFov(draft.camera.focalLengthMm),
    roll: draft.camera.rollDeg,
  }
  return { ...previous, mannequins, props, cameras: [camera], shots: [] }
}
