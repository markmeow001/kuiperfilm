'use client'

/**
 * Primitive 素体 mannequin (M2a) — a simple human proxy built from meshes
 * (head / torso / arms / legs), rendered at LOCAL origin. The wrapping <group>
 * in DirectorStage owns position/rotation/scale + click selection, so the
 * TransformControls gizmo reads/writes a single source-of-truth object.
 * Per-joint rig is M2b.
 */
import type { StageMannequin } from './stage-types'

interface MannequinProps {
  data: StageMannequin
  selected: boolean
}

export function Mannequin({ data, selected }: MannequinProps) {
  const { color } = data
  const emissive = selected ? color : '#000000'
  const intensity = selected ? 0.25 : 0
  const limb = (key: string, pos: [number, number, number], size: [number, number, number]) => (
    <mesh key={key} position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} roughness={0.7} />
    </mesh>
  )
  return (
    <>
      {/* head */}
      <mesh position={[0, 1.62, 0]} castShadow>
        <sphereGeometry args={[0.13, 20, 20]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} roughness={0.6} />
      </mesh>
      {limb('neck', [0, 1.46, 0], [0.07, 0.1, 0.07])}
      {limb('torso', [0, 1.12, 0], [0.42, 0.62, 0.22])}
      {limb('hips', [0, 0.74, 0], [0.34, 0.2, 0.2])}
      {limb('armL', [-0.3, 1.12, 0], [0.13, 0.58, 0.13])}
      {limb('armR', [0.3, 1.12, 0], [0.13, 0.58, 0.13])}
      {limb('legL', [-0.12, 0.36, 0], [0.15, 0.72, 0.16])}
      {limb('legR', [0.12, 0.36, 0], [0.15, 0.72, 0.16])}
      {/* facing marker (nose, points +Z) so orientation reads at a glance */}
      <mesh position={[0, 1.62, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.035, 0.08, 12]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </>
  )
}
