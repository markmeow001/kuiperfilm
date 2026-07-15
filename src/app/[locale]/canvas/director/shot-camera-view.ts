import * as THREE from 'three'
import type { Vec3 } from './stage-types'

export interface ShotViewControls {
  target: THREE.Vector3
  update: () => void
}

export function applyShotCameraView(
  camera: THREE.PerspectiveCamera,
  controls: ShotViewControls | null,
  shot: { position: Vec3; fov: number },
  target: Vec3,
): void {
  camera.position.set(...shot.position)
  camera.fov = shot.fov
  camera.updateProjectionMatrix()
  if (controls) {
    controls.target.set(...target)
    controls.update()
  } else {
    camera.lookAt(new THREE.Vector3(...target))
  }
}
