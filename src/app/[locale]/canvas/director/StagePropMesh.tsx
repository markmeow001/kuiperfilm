'use client'

/**
 * 道具几何体 — box/sphere/cylinder + 'car' 低模组合（车身+座舱+四轮）。
 * 与 Mannequin 平行：由外层 group 承担 transform/选中，这里只画形。
 * 所有 mesh 以 y=0 落地（几何中心上移半高）。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import type { StageProp } from './stage-types'

export function StagePropMesh({ data, selected }: { data: StageProp; selected: boolean }) {
  const emissive = selected ? CANVAS_TOKENS.accent : '#000000'
  const emissiveIntensity = selected ? 0.25 : 0
  const mat = <meshStandardMaterial color={data.color} roughness={0.85} emissive={emissive} emissiveIntensity={emissiveIntensity} />

  switch (data.kind) {
    case 'sphere':
      return (
        <mesh position={[0, 0.5, 0]} castShadow>
          <sphereGeometry args={[0.5, 24, 24]} />
          {mat}
        </mesh>
      )
    case 'cylinder':
      return (
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.4, 1, 24]} />
          {mat}
        </mesh>
      )
    case 'car': {
      const wheel = (x: number, z: number) => (
        <mesh key={`${x}${z}`} position={[x, 0.3, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.22, 16]} />
          <meshStandardMaterial color="#1c1c22" roughness={0.9} />
        </mesh>
      )
      return (
        <group>
          {/* 车身 */}
          <mesh position={[0, 0.62, 0]} castShadow>
            <boxGeometry args={[1.9, 0.55, 4.2]} />
            {mat}
          </mesh>
          {/* 座舱 */}
          <mesh position={[0, 1.12, -0.2]} castShadow>
            <boxGeometry args={[1.7, 0.5, 2.1]} />
            {mat}
          </mesh>
          {wheel(0.95, 1.35)}
          {wheel(-0.95, 1.35)}
          {wheel(0.95, -1.35)}
          {wheel(-0.95, -1.35)}
        </group>
      )
    }
    case 'box':
    default:
      return (
        <mesh position={[0, 0.5, 0]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          {mat}
        </mesh>
      )
  }
}
