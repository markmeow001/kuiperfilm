'use client'

/**
 * Scene background for the 导演台 — puts an uploaded scene image behind the
 * mannequins so screenshots are character-IN-environment.
 *
 *  - 'flat'   → 场景幕布: the image stands as a large vertical backdrop whose
 *               BOTTOM edge sits on the ground (y=0). Characters at y=0 share the
 *               same floor line as the backdrop → they read as grounded, not
 *               floating. The backdrop billboards to face the camera (yaw only).
 *  - 'sphere' → bounded 2D texture on an inside-view sphere (real 360° panorama).
 *  - 'none'   → solid sky colour.
 *
 * Both bake into screenshots (real scene content). capture() in DirectorStage
 * orients the flat backdrop to the shot camera before rendering.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { StageBackground } from './stage-types'
import { applySceneBackground, configureStageTexture, createPanoramaGeometry, downsampleStageTexture } from './scene-background-mode'

// 场景幕布 geometry: backdrop height (world units ≈ metres) + distance behind the
// scene centre. Bottom edge at y=0 so characters (feet at y=0) share the floor.
export const BACKDROP_H = 7
export const BACKDROP_D = 6

/**
 * Place + orient the flat backdrop: stand it behind the scene relative to the
 * camera, bottom on the ground, facing the camera (yaw only, upright). Shared by
 * the live useFrame and capture() so the screenshot matches the shot camera.
 */
export function orientBackdrop(mesh: THREE.Object3D, camX: number, camZ: number) {
  const len = Math.hypot(camX, camZ) || 1
  const dx = camX / len
  const dz = camZ / len
  mesh.position.set(-dx * BACKDROP_D, BACKDROP_H / 2, -dz * BACKDROP_D)
  mesh.rotation.set(0, Math.atan2(dx, dz), 0)
}

function PanoramaSphere({ texture, radius, rotationDeg }: { texture: THREE.Texture; radius: number; rotationDeg: number }) {
  const geometry = useMemo(() => createPanoramaGeometry(radius), [radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} rotation={[0, rotationDeg * (Math.PI / 180), 0]}>
      <meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  )
}

export function SceneBackground({
  bg,
  onError,
  backdropRef,
}: {
  bg: StageBackground
  onError?: () => void
  backdropRef?: React.RefObject<THREE.Mesh | null>
}) {
  const { scene, camera } = useThree()
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const texRef = useRef<THREE.Texture | null>(null)
  texRef.current = tex
  useEffect(() => () => { texRef.current?.dispose() }, [])

  const src = bg.key ? `/api/canvas/asset?key=${encodeURIComponent(bg.key)}` : bg.url ?? null

  useEffect(() => {
    if (!src) { setTex((old) => { old?.dispose(); return null }); return }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      src,
      (t) => {
        if (cancelled) { t.dispose(); return }
        t.colorSpace = THREE.SRGBColorSpace
        downsampleStageTexture(t)
        configureStageTexture(t)
        setTex((old) => { if (old !== t) old?.dispose(); return t })
      },
      undefined,
      () => { if (!cancelled) { setTex((old) => { old?.dispose(); return null }); onError?.() } },
    )
    return () => { cancelled = true }
  }, [src, onError])

  // Keep scene.background a colour. The panorama is a bounded 2D mesh, avoiding
  // both NPOT RepeatWrapping black frames and equirect→cubemap GPU amplification.
  useEffect(() => {
    applySceneBackground(scene, bg, tex)
    return () => { scene.background = new THREE.Color(bg.skyColor ?? '#0A0A0B') }
  }, [scene, bg, tex])

  // Live billboard: orient the flat backdrop toward the orbit/active camera.
  useFrame(() => {
    if (bg.mode === 'flat' && backdropRef?.current) {
      orientBackdrop(backdropRef.current, camera.position.x, camera.position.z)
    }
  })

  if (bg.mode === 'sphere' && tex) {
    return <PanoramaSphere texture={tex} radius={bg.radius ?? 60} rotationDeg={bg.rotationDeg ?? 0} />
  }

  if (bg.mode === 'flat' && tex) {
    const img = tex.image as { width?: number; height?: number } | undefined
    const aspect = img?.width && img?.height ? img.width / img.height : 1.6
    const w = Math.max(BACKDROP_H * aspect, 14)
    return (
      <mesh ref={backdropRef}>
        <planeGeometry args={[w, BACKDROP_H]} />
        <meshBasicMaterial map={tex} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    )
  }
  return null
}
