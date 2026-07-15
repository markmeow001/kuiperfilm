import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { applyShotCameraView } from '@/app/[locale]/canvas/director/shot-camera-view'

describe('director shot POV', () => {
  it('applies the selected camera position, target and FOV to the live view', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 1000)
    const update = vi.fn()
    const controls = { target: new THREE.Vector3(), update }

    applyShotCameraView(camera, controls, { position: [4, 2, -3], fov: 32 }, [0, 1.2, 0])

    expect(camera.position.toArray()).toEqual([4, 2, -3])
    expect(camera.fov).toBe(32)
    expect(controls.target.toArray()).toEqual([0, 1.2, 0])
    expect(update).toHaveBeenCalledOnce()
  })
})
