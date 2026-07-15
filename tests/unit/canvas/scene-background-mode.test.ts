import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applySceneBackground, configureStageTexture, createPanoramaGeometry, fitStageTextureSize } from '@/app/[locale]/canvas/director/scene-background-mode'
import { DEFAULT_BACKGROUND } from '@/app/[locale]/canvas/director/stage-types'

describe('director panorama background', () => {
  it('keeps a sphere panorama as one clamped 2D texture without cubemap conversion', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()

    applySceneBackground(scene, { ...DEFAULT_BACKGROUND, mode: 'sphere', rotationDeg: 35 }, texture)

    expect(scene.background).toBeInstanceOf(THREE.Color)
    expect(texture.mapping).toBe(THREE.UVMapping)
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.repeat.toArray()).toEqual([1, 1])
    expect(texture.offset.toArray()).toEqual([0, 0])
    expect(texture.generateMipmaps).toBe(false)
    expect(scene.backgroundRotation.y).toBeCloseTo(THREE.MathUtils.degToRad(35))
  })

  it('caps large decoded images before their first GPU upload', () => {
    expect(fitStageTextureSize(8192, 4096)).toEqual({ width: 4096, height: 2048 })
    expect(fitStageTextureSize(3000, 1500)).toEqual({ width: 3000, height: 1500 })
  })

  it('survives sphere → flat → sphere mode round-trips without changing texture mapping', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()
    const sphere = { ...DEFAULT_BACKGROUND, mode: 'sphere' as const }
    applySceneBackground(scene, sphere, texture)
    applySceneBackground(scene, { ...sphere, mode: 'flat' }, texture)
    applySceneBackground(scene, sphere, texture)
    expect(texture.mapping).toBe(THREE.UVMapping)
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(scene.background).toBeInstanceOf(THREE.Color)
  })

  it('flips panorama UVs in geometry without negative texture repeat', () => {
    const original = new THREE.SphereGeometry(60, 48, 32)
    const panorama = createPanoramaGeometry(60)
    const originalUv = original.getAttribute('uv')
    const panoramaUv = panorama.getAttribute('uv')
    for (const index of [0, Math.floor(originalUv.count / 2), originalUv.count - 1]) {
      expect(panoramaUv.getX(index)).toBeCloseTo(1 - originalUv.getX(index))
    }
    const texture = new THREE.Texture()
    configureStageTexture(texture)
    expect(texture.repeat.x).toBe(1)
    original.dispose()
    panorama.dispose()
  })

  it('restores UV texture settings and a solid scene background in flat mode', () => {
    const scene = new THREE.Scene()
    const texture = new THREE.Texture()
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.repeat.set(-1, 1)

    applySceneBackground(scene, { ...DEFAULT_BACKGROUND, mode: 'flat', skyColor: '#123456' }, texture)

    expect(scene.background).toBeInstanceOf(THREE.Color)
    expect((scene.background as THREE.Color).getHexString()).toBe('123456')
    expect(texture.mapping).toBe(THREE.UVMapping)
    expect(texture.repeat.toArray()).toEqual([1, 1])
  })
})
