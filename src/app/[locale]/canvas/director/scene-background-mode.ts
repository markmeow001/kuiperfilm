import * as THREE from 'three'
import type { StageBackground } from './stage-types'

const DEG2RAD = Math.PI / 180
export const MAX_STAGE_TEXTURE_WIDTH = 4096
export const MAX_STAGE_TEXTURE_HEIGHT = 2048

export function fitStageTextureSize(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 }
  const scale = Math.min(1, MAX_STAGE_TEXTURE_WIDTH / width, MAX_STAGE_TEXTURE_HEIGHT / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Downsample before the first WebGL upload so large source files cannot exhaust GPU memory. */
export function downsampleStageTexture(texture: THREE.Texture): void {
  if (typeof document === 'undefined') return
  const source = texture.image as ({ width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } & CanvasImageSource) | undefined
  const width = source?.naturalWidth ?? source?.width ?? 0
  const height = source?.naturalHeight ?? source?.height ?? 0
  const fitted = fitStageTextureSize(width, height)
  if (!source || (fitted.width === width && fitted.height === height)) return

  const canvas = document.createElement('canvas')
  canvas.width = fitted.width
  canvas.height = fitted.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(source, 0, 0, fitted.width, fitted.height)
  texture.image = canvas
}

/** Keep the panorama as one bounded 2D texture; never trigger cubemap conversion. */
export function configureStageTexture(texture: THREE.Texture): void {
  texture.mapping = THREE.UVMapping
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.repeat.set(1, 1)
  texture.offset.set(0, 0)
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
}

/** Flip sphere UVs in geometry instead of using negative RepeatWrapping. */
export function createPanoramaGeometry(radius: number): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(radius, 48, 32)
  const uv = geometry.getAttribute('uv')
  for (let index = 0; index < uv.count; index += 1) uv.setX(index, 1 - uv.getX(index))
  uv.needsUpdate = true
  return geometry
}

/**
 * The scene clear remains a solid colour. Panorama pixels are rendered by the
 * bounded 2D sphere mesh, so Three never allocates a six-face environment map.
 */
export function applySceneBackground(
  scene: THREE.Scene,
  bg: StageBackground,
  texture: THREE.Texture | null,
): void {
  scene.backgroundRotation.set(0, (bg.rotationDeg ?? 0) * DEG2RAD, 0)

  if (texture) configureStageTexture(texture)
  scene.background = new THREE.Color(bg.skyColor ?? '#0A0A0B')
}
