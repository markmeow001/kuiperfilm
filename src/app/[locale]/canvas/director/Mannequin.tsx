'use client'

/**
 * Articulated 素体 mannequin (M2b + capsule upgrade) — a Body-kun-style artist
 * doll: capsule limbs + visible ball joints + a tapered (broad-chest / narrow-
 * waist) torso. Same nested-bone hierarchy + pose model as before (presets and
 * per-joint sliders unchanged) — only the per-bone geometry is richer.
 *
 * Rendered at LOCAL origin (feet ~y=0); the wrapping <group> in DirectorStage
 * owns world position/rotation/scale + selection. Pelvis carries pose.root for
 * sit/crouch lowering.
 */
import { memo } from 'react'
import { REST_POSE, type Pose } from './pose-presets'
import { BODY_TYPES, type StageMannequin } from './stage-types'

interface MannequinProps {
  data: StageMannequin
  selected: boolean
}

export const Mannequin = memo(function Mannequin({ data, selected }: MannequinProps) {
  const color = data.color
  const pose: Pose = data.pose ?? REST_POSE
  const j = pose.joints
  const emissive = selected ? color : '#000000'
  const intensity = selected ? 0.3 : 0
  // Body-type proportions: vertical scale (height), limb radius (girth), head.
  const bt = BODY_TYPES.find((b) => b.key === (data.bodyType ?? 'male')) ?? BODY_TYPES[0]
  const g = bt.girth

  // Plain functions (NOT nested components) so React reconciles each as a stable
  // <mesh> — an inline component would remount/recreate all geometry per render.
  const mat = () => (
    <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} roughness={0.55} metalness={0.05} />
  )
  // capsule limb segment (axis = Y); radius scaled by body girth
  const seg = (pos: [number, number, number], r: number, len: number, scale: [number, number, number] = [1, 1, 1]) => (
    <mesh position={pos} scale={[scale[0] * g, scale[1], scale[2] * g]} castShadow>
      <capsuleGeometry args={[r, len, 6, 14]} />
      {mat()}
    </mesh>
  )
  // ball joint / rounded part; radius scaled by body girth
  const ball = (pos: [number, number, number], r: number, scale: [number, number, number] = [1, 1, 1], headMul = 1) => (
    <mesh position={pos} scale={[scale[0] * g * headMul, scale[1] * g * headMul, scale[2] * g * headMul]} castShadow>
      <sphereGeometry args={[r, 18, 16]} />
      {mat()}
    </mesh>
  )

  return (
    // outer group scales total height by body type; pelvis lowers for sit/crouch
    <group scale={[1, bt.height, 1]}>
    <group name="bone:pelvis" position={[pose.root[0], 0.9 + pose.root[1], pose.root[2]]}>
      {ball([0, 0, 0], 0.12, [1.25, 0.95, 0.74])}

      {/* spine → torso (tapered) → head, shoulders */}
      <group position={[0, 0.09, 0]} rotation={j.spine}>
        {seg([0, 0.16, 0], 0.115, 0.1, [1.05, 1, 0.72])}
        {seg([0, 0.4, 0], 0.155, 0.14, [1.4, 1, 0.72])}

        {/* head — scaled by body-type head factor (net = bt.head) */}
        <group position={[0, 0.56, 0]} rotation={j.head}>
          {seg([0, 0.04, 0], 0.05, 0.05)}
          {ball([0, 0.2, 0], 0.13, [0.92, 1.05, 0.95], bt.head / g)}
          {/* nose marks facing (+Z) */}
          <mesh position={[0, 0.2, 0.13]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.035, 0.08, 12]} />
            <meshStandardMaterial color="#ffffff" />
          </mesh>
        </group>

        {/* left arm */}
        <group name="bone:shoulderL" position={[-0.23, 0.46, 0]} rotation={j.shoulderL}>
          {ball([0, 0, 0], 0.065)}
          {seg([0, -0.15, 0], 0.05, 0.18)}
          <group name="bone:elbowL" position={[0, -0.3, 0]} rotation={j.elbowL}>
            {ball([0, 0, 0], 0.05)}
            {seg([0, -0.14, 0], 0.045, 0.18)}
            {ball([0, -0.29, 0], 0.052, [1, 0.9, 0.8])}
          </group>
        </group>
        {/* right arm */}
        <group name="bone:shoulderR" position={[0.23, 0.46, 0]} rotation={j.shoulderR}>
          {ball([0, 0, 0], 0.065)}
          {seg([0, -0.15, 0], 0.05, 0.18)}
          <group name="bone:elbowR" position={[0, -0.3, 0]} rotation={j.elbowR}>
            {ball([0, 0, 0], 0.05)}
            {seg([0, -0.14, 0], 0.045, 0.18)}
            {ball([0, -0.29, 0], 0.052, [1, 0.9, 0.8])}
          </group>
        </group>
      </group>

      {/* left leg */}
      <group name="bone:hipL" position={[-0.12, -0.02, 0]} rotation={j.hipL}>
        {ball([0, 0, 0], 0.08)}
        {seg([0, -0.2, 0], 0.075, 0.26)}
        <group name="bone:kneeL" position={[0, -0.4, 0]} rotation={j.kneeL}>
          {ball([0, 0, 0], 0.07)}
          {seg([0, -0.2, 0], 0.06, 0.28)}
          {/* foot */}
          {ball([0, -0.4, 0.05], 0.08, [0.95, 0.55, 1.7])}
        </group>
      </group>
      {/* right leg */}
      <group name="bone:hipR" position={[0.12, -0.02, 0]} rotation={j.hipR}>
        {ball([0, 0, 0], 0.08)}
        {seg([0, -0.2, 0], 0.075, 0.26)}
        <group name="bone:kneeR" position={[0, -0.4, 0]} rotation={j.kneeR}>
          {ball([0, 0, 0], 0.07)}
          {seg([0, -0.2, 0], 0.06, 0.28)}
          {ball([0, -0.4, 0.05], 0.08, [0.95, 0.55, 1.7])}
        </group>
      </group>
    </group>
    </group>
  )
})
