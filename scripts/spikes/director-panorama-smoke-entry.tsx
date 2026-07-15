import React, { useEffect, useRef, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import * as THREE from 'three'
import { applySceneBackground, configureStageTexture, createPanoramaGeometry, downsampleStageTexture } from '../../src/app/[locale]/canvas/director/scene-background-mode'
import { applyShotCameraView } from '../../src/app/[locale]/canvas/director/shot-camera-view'
import { DEFAULT_BACKGROUND } from '../../src/app/[locale]/canvas/director/stage-types'

function PanoramaSmoke() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [handle] = useState(() => delayRender('render director panorama WebGL smoke'))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(1280, 720, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const source = document.createElement('canvas')
    source.width = 5000
    source.height = 2500
    const context = source.getContext('2d')
    if (!context) throw new Error('2D context unavailable')
    const gradient = context.createLinearGradient(0, 0, source.width, 0)
    gradient.addColorStop(0, '#ef4444')
    gradient.addColorStop(0.33, '#22c55e')
    gradient.addColorStop(0.66, '#3b82f6')
    gradient.addColorStop(1, '#f59e0b')
    context.fillStyle = gradient
    context.fillRect(0, 0, source.width, source.height)
    context.fillStyle = '#ffffff'
    context.font = 'bold 180px sans-serif'
    context.fillText('360 PANORAMA', 300, 590)

    const texture = new THREE.CanvasTexture(source)
    texture.colorSpace = THREE.SRGBColorSpace
    downsampleStageTexture(texture)
    const downsampled = texture.image as HTMLCanvasElement
    if (downsampled.width !== 4096 || downsampled.height !== 2048) {
      throw new Error(`Unexpected panorama texture size: ${downsampled.width}x${downsampled.height}`)
    }
    configureStageTexture(texture)
    const scene = new THREE.Scene()
    const sphereMode = { ...DEFAULT_BACKGROUND, mode: 'sphere' as const, rotationDeg: 18 }
    applySceneBackground(scene, sphereMode, texture)
    applySceneBackground(scene, { ...sphereMode, mode: 'flat' }, texture)
    applySceneBackground(scene, sphereMode, texture)

    const geometry = createPanoramaGeometry(60)
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false })
    const sphere = new THREE.Mesh(geometry, material)
    sphere.rotation.y = THREE.MathUtils.degToRad(18)
    scene.add(sphere)

    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 1000)
    applyShotCameraView(camera, null, { position: [2, 1, 3], fov: 52 }, [0, 1, 0])
    renderer.render(scene, camera)
    continueRender(handle)

    return () => {
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
    }
  }, [handle])

  return <canvas ref={canvasRef} width={1280} height={720} style={{ width: 1280, height: 720 }} />
}

function PanoramaSmokeRoot() {
  return <Composition id="DirectorPanoramaSmoke" component={PanoramaSmoke} durationInFrames={1} fps={30} width={1280} height={720} />
}

registerRoot(PanoramaSmokeRoot)
