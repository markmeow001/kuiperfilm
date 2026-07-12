'use client'

/**
 * 调度线 + 运镜线可视化（选中镜头的路径层）。
 *
 * 运镜线（机位，青蓝）：start.camera → cameraWaypoints → end.camera
 * 调度线（actor，橙黄）：start.actors[id] → movePaths[id] → end.actors[id]
 *
 * waypoint 小球带选择键（wp:cam:<i> / wp:act:<actorId>:<i>），点击后由
 * DirectorStage 的 TransformControls 拖动、commit 回 shot。整层挂在
 * helpers group 里 → 截图/录制时自动隐藏。线条按 CatmullRom 采样（与
 * previz-eval 同族曲线），所见即所动。
 */
import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { StageShot } from './previz-types'
import type { Vec3 } from './stage-types'

export const CAM_PATH_COLOR = '#4F8EF7'
export const ACTOR_PATH_COLOR = '#F4A93E'

export const camWpKey = (i: number) => `wp:cam:${i}`
export const actWpKey = (actorId: string, i: number) => `wp:act:${actorId}:${i}`

export type WpDesc = { kind: 'cam'; index: number } | { kind: 'act'; actorId: string; index: number }

/** Parse a waypoint selection key → descriptor (null if not a waypoint key). */
export function parseWpKey(sel: string | null): WpDesc | null {
  if (!sel || !sel.startsWith('wp:')) return null
  const parts = sel.split(':')
  if (parts[1] === 'cam' && parts.length === 3) return { kind: 'cam', index: Number(parts[2]) }
  if (parts[1] === 'act' && parts.length >= 4) {
    const index = Number(parts[parts.length - 1])
    return { kind: 'act', actorId: parts.slice(2, -1).join(':'), index }
  }
  return null
}

const toV = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2])

function samplePath(from: Vec3, to: Vec3, waypoints: Vec3[] | undefined): [number, number, number][] {
  const pts = [toV(from), ...(waypoints ?? []).map(toV), toV(to)]
  if (pts.length === 2) return [from, to] as [number, number, number][]
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  return curve.getPoints(48).map((p) => [p.x, p.y, p.z])
}

interface PathLineProps {
  from: Vec3
  to: Vec3
  waypoints?: Vec3[]
  color: string
  selectedId: string | null
  keyFor: (i: number) => string
  onSelect: (key: string) => void
  registerWp: (key: string, el: THREE.Mesh | null) => void
  /** 调度线人物路径贴地略抬高，运镜线按相机实际高度。 */
  liftY?: number
}

function PathLine({ from, to, waypoints, color, selectedId, keyFor, onSelect, registerWp, liftY = 0 }: PathLineProps) {
  const lift = (v: Vec3): Vec3 => [v[0], v[1] + liftY, v[2]]
  const points = useMemo(() => samplePath(lift(from), lift(to), waypoints?.map(lift)), [from, to, waypoints]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <Line points={points} color={color} lineWidth={1.5} dashed dashSize={0.18} gapSize={0.1} transparent opacity={0.85} />
      {/* 起点小环 + 终点实心球：读得出方向 */}
      <mesh position={lift(from)}>
        <torusGeometry args={[0.09, 0.02, 8, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={lift(to)}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {(waypoints ?? []).map((w, i) => {
        const key = keyFor(i)
        return (
          <mesh
            key={key}
            ref={(el) => registerWp(key, el)}
            position={lift(w)}
            onClick={(e) => { e.stopPropagation(); onSelect(key) }}
          >
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selectedId === key ? 0.8 : 0.25} />
          </mesh>
        )
      })}
    </group>
  )
}

export interface PathVisualsProps {
  shot: StageShot
  showCameraPath: boolean
  showActorPaths: boolean
  selectedId: string | null
  onSelect: (key: string) => void
  registerWp: (key: string, el: THREE.Mesh | null) => void
}

export function PathVisuals({ shot, showCameraPath, showActorPaths, selectedId, onSelect, registerWp }: PathVisualsProps) {
  const actorIds = useMemo(
    () => Object.keys(shot.start.actors).filter((id) => shot.end.actors[id]),
    [shot.start.actors, shot.end.actors],
  )
  return (
    <group>
      {showCameraPath ? (
        <PathLine
          from={shot.start.camera.position}
          to={shot.end.camera.position}
          waypoints={shot.cameraWaypoints}
          color={CAM_PATH_COLOR}
          selectedId={selectedId}
          keyFor={camWpKey}
          onSelect={onSelect}
          registerWp={registerWp}
        />
      ) : null}
      {showActorPaths
        ? actorIds.map((id) => (
            <PathLine
              key={id}
              from={shot.start.actors[id].position}
              to={shot.end.actors[id].position}
              waypoints={shot.movePaths?.[id]}
              color={ACTOR_PATH_COLOR}
              selectedId={selectedId}
              keyFor={(i) => actWpKey(id, i)}
              onSelect={onSelect}
              registerWp={registerWp}
              liftY={0.04}
            />
          ))
        : null}
    </group>
  )
}
