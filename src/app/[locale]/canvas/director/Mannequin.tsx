'use client'

/**
 * Articulated 素体 mannequin (M2b) — a posable skeleton built from nested bone
 * groups. Each joint group applies its pose Euler rotation, so rotating a
 * shoulder swings the whole arm, the elbow swings the forearm, etc. Rendered at
 * LOCAL origin (feet ~y=0); the wrapping <group> in DirectorStage owns
 * world position/rotation/scale + selection. The pelvis carries pose.root for
 * sit/crouch lowering.
 */
import { memo } from 'react'
import { REST_POSE, type Pose } from './pose-presets'
import type { StageMannequin } from './stage-types'

interface MannequinProps {
  data: StageMannequin
  selected: boolean
}

// memo: unedited mannequins keep a stable `data` ref (the stage updater returns
// the same object for untouched ids), so a pose-slider tick on one figure
// re-renders only that figure, not the whole scene.
export const Mannequin = memo(function Mannequin({ data, selected }: MannequinProps) {
  const color = data.color
  const pose: Pose = data.pose ?? REST_POSE
  const j = pose.joints
  const emissive = selected ? color : '#000000'
  const intensity = selected ? 0.28 : 0

  // Plain function (NOT a nested component) so React reconciles each bone as a
  // stable <mesh> — defining a component inline would give it a new type every
  // render and remount/recreate all bone geometry on each pose tick.
  const bone = (pos: [number, number, number], size: [number, number, number]) => (
    <mesh position={pos} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} roughness={0.7} />
    </mesh>
  )

  return (
    // pelvis (skeleton root) — pose.root lowers it for sit/crouch
    <group position={[pose.root[0], 0.9 + pose.root[1], pose.root[2]]}>
      {bone([0, 0, 0], [0.34, 0.18, 0.2])}

      {/* spine → torso → (head, shoulders) */}
      <group position={[0, 0.09, 0]} rotation={j.spine}>
        {bone([0, 0.25, 0], [0.4, 0.5, 0.22])}

        {/* head */}
        <group position={[0, 0.56, 0]} rotation={j.head}>
          {bone([0, 0.03, 0], [0.08, 0.1, 0.08])}
          <mesh position={[0, 0.2, 0]} castShadow>
            <sphereGeometry args={[0.13, 20, 20]} />
            <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} roughness={0.6} />
          </mesh>
          {/* nose marks facing (+Z) */}
          <mesh position={[0, 0.2, 0.13]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.035, 0.08, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>

        {/* left arm */}
        <group position={[-0.24, 0.46, 0]} rotation={j.shoulderL}>
          {bone([0, -0.15, 0], [0.12, 0.3, 0.12])}
          <group position={[0, -0.3, 0]} rotation={j.elbowL}>
            {bone([0, -0.14, 0], [0.11, 0.28, 0.11])}
          </group>
        </group>
        {/* right arm */}
        <group position={[0.24, 0.46, 0]} rotation={j.shoulderR}>
          {bone([0, -0.15, 0], [0.12, 0.3, 0.12])}
          <group position={[0, -0.3, 0]} rotation={j.elbowR}>
            {bone([0, -0.14, 0], [0.11, 0.28, 0.11])}
          </group>
        </group>
      </group>

      {/* left leg */}
      <group position={[-0.12, -0.02, 0]} rotation={j.hipL}>
        {bone([0, -0.2, 0], [0.15, 0.4, 0.16])}
        <group position={[0, -0.4, 0]} rotation={j.kneeL}>
          {bone([0, -0.2, 0], [0.14, 0.4, 0.15])}
          {bone([0, -0.4, 0.05], [0.16, 0.07, 0.26])}
        </group>
      </group>
      {/* right leg */}
      <group position={[0.12, -0.02, 0]} rotation={j.hipR}>
        {bone([0, -0.2, 0], [0.15, 0.4, 0.16])}
        <group position={[0, -0.4, 0]} rotation={j.kneeR}>
          {bone([0, -0.2, 0], [0.14, 0.4, 0.15])}
          {bone([0, -0.4, 0.05], [0.16, 0.07, 0.26])}
        </group>
      </group>
    </group>
  )
})
