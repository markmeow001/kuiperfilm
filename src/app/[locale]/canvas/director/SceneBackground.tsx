'use client'

/**
 * Scene background for the 导演台 — puts an uploaded scene image behind the
 * mannequins so screenshots are character-IN-environment (the load-bearing bit
 * for usable generation references; see canvas_ref/libtv-scene-background-research).
 *
 *  - 'flat'   → scene.background = the image (full-frame backdrop, fills the
 *               view from any camera; great for ordinary scene photos)
 *  - 'sphere' → inverted equirect sphere around the stage (mannequins inside),
 *               with horizontal rotation + radius (for 360° panoramas, LibTV-style)
 *  - 'none'   → solid sky colour
 *
 * The texture bakes into screenshots automatically (real scene content), so even
 * if the editor URL later expires the already-sent frames keep it baked.
 */
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { StageBackground } from './stage-types'

const DEG2RAD = Math.PI / 180

export function SceneBackground({ bg, onError }: { bg: StageBackground; onError?: () => void }) {
  const { scene } = useThree()
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  // Mirror the live texture in a ref so the unmount cleanup can dispose it —
  // scene.background is NOT a scene-graph child, so R3F's unmount auto-dispose
  // never frees it, and the loader cleanup only flips the cancelled flag.
  const texRef = useRef<THREE.Texture | null>(null)
  texRef.current = tex
  useEffect(() => () => { texRef.current?.dispose() }, [])

  // Load the image when the URL changes (NOT on mode toggle — same image serves
  // both flat & sphere). Dispose the previous texture inside the state updater so
  // the live scene.background texture is never freed while still assigned.
  useEffect(() => {
    if (!bg.url) { setTex((old) => { old?.dispose(); return null }); return }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      bg.url,
      (t) => {
        if (cancelled) { t.dispose(); return }
        t.colorSpace = THREE.SRGBColorSpace
        setTex((old) => { if (old !== t) old?.dispose(); return t })
      },
      undefined,
      () => { if (!cancelled) { setTex((old) => { old?.dispose(); return null }); onError?.() } },
    )
    return () => { cancelled = true }
  }, [bg.url, onError])

  // SOLE writer of scene.background: flat image, or solid sky colour. (Sphere
  // mode paints via the mesh below, so background stays the sky colour.) On
  // unmount, reset to the sky colour — nothing else owns scene.background.
  useEffect(() => {
    if (bg.mode === 'flat' && tex) {
      scene.background = tex
    } else {
      scene.background = new THREE.Color(bg.skyColor ?? '#0A0A0B')
    }
    // backgroundRotation only affects equirect/cube backgrounds — for flat it's
    // a no-op (the sphere applies rotation on its own mesh).
    scene.backgroundRotation = new THREE.Euler(0, (bg.rotationDeg ?? 0) * DEG2RAD, 0)
    return () => { scene.background = new THREE.Color(bg.skyColor ?? '#0A0A0B') }
  }, [scene, bg.mode, bg.skyColor, bg.rotationDeg, tex])

  if (bg.mode === 'sphere' && tex) {
    // scale.x = -1 turns the sphere inside-out (view from centre) and un-mirrors
    // the equirect texture; FrontSide then faces inward correctly.
    return (
      <mesh rotation={[0, (bg.rotationDeg ?? 0) * DEG2RAD, 0]} scale={[-1, 1, 1]}>
        <sphereGeometry args={[bg.radius ?? 60, 48, 32]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    )
  }
  return null
}
