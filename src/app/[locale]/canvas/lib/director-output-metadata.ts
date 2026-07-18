import { DEFAULT_BACKGROUND } from '../director/stage-types'
import type {
  DirectorStageState,
  StageAspect,
  StageBackground,
  StageCamera,
  StageMannequin,
  StageProp,
} from '../director/stage-types'
import type { StageShot } from '../director/previz-types'

export interface DirectorActorSnapshot {
  id: string
  label: string
  position: StageMannequin['position']
  rotation: StageMannequin['rotation']
  scale: number
  bodyType?: StageMannequin['bodyType']
}

export interface DirectorPropSnapshot {
  id: string
  label: string
  kind: StageProp['kind']
  position: StageProp['position']
  rotation: StageProp['rotation']
  scale: StageProp['scale']
}

export interface CanvasDirectorOutputMetadata {
  directorNodeId: string
  source: 'camera-still' | 'previz-shot' | 'previz-scene'
  camera: StageCamera | null
  actors: DirectorActorSnapshot[]
  props: DirectorPropSnapshot[]
  shots: StageShot[]
  aspect: StageAspect
  background: StageBackground
}

function cloneVec3(value: [number, number, number]): [number, number, number] {
  return [...value]
}

function cloneCamera(camera: StageCamera | null): StageCamera | null {
  if (!camera) return null
  return {
    ...camera,
    position: cloneVec3(camera.position),
    target: cloneVec3(camera.target),
  }
}

function cloneShot(shot: StageShot): StageShot {
  return structuredClone(shot)
}

export function buildDirectorOutputMetadata(input: {
  directorNodeId: string
  source: CanvasDirectorOutputMetadata['source']
  state: DirectorStageState
  cameraId?: string
  shotIds?: string[]
}): CanvasDirectorOutputMetadata {
  const selectedShotIds = new Set(input.shotIds ?? [])
  const shots = input.source === 'previz-scene'
    ? input.state.shots
    : input.state.shots.filter((shot) => selectedShotIds.has(shot.id))

  return {
    directorNodeId: input.directorNodeId,
    source: input.source,
    camera: cloneCamera(input.state.cameras.find((camera) => camera.id === input.cameraId) ?? null),
    actors: input.state.mannequins.map((actor) => ({
      id: actor.id,
      label: actor.label,
      position: cloneVec3(actor.position),
      rotation: cloneVec3(actor.rotation),
      scale: actor.scale,
      ...(actor.bodyType ? { bodyType: actor.bodyType } : {}),
    })),
    props: input.state.props.map((prop) => ({
      id: prop.id,
      label: prop.label,
      kind: prop.kind,
      position: cloneVec3(prop.position),
      rotation: cloneVec3(prop.rotation),
      scale: cloneVec3(prop.scale),
    })),
    shots: shots.map(cloneShot),
    aspect: input.state.aspect ?? 'auto',
    background: { ...DEFAULT_BACKGROUND, ...(input.state.background ?? {}) },
  }
}
