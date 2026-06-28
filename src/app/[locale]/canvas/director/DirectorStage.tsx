'use client'

/**
 * 导演台 3D stage (v2 — 持久场景 + 多机位).
 *
 * One stage = the cast (mannequins) in their spatial relationship + MULTIPLE
 * cameras. Each camera screenshots the SAME blocking → 发送 spawns one frame
 * node per camera, so every frame shares consistent positions. Combined with
 * cast character refs wired into the director (DirectorNode propagates them onto
 * each frame), both blocking AND appearance carry across every frame.
 *
 * Capture hides all helpers (grid/gizmos/transform) then renders from a temp
 * camera built from the requested camera's state, so the shot is a clean plate.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { Mannequin } from './Mannequin'
import { SliderRow } from './SliderRow'
import { Vec3Field } from './Vec3Field'
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint, type Pose } from './pose-presets'
import { CAMERA_PRESETS, aspectRatio, computePreset } from './camera-presets'
import {
  type BodyType,
  type DirectorStageState,
  type StageAspect,
  type StageCamera,
  type StageMannequin,
  type TransformMode,
  type Vec3,
  BODY_TYPES,
  STAGE_ASPECTS,
  makeCamera,
  makeMannequin,
} from './stage-types'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const camKey = (id: string) => `cam:${id}`
const tgtKey = (id: string) => `tgt:${id}`
/** camera id from a selection key, or null if the selection isn't a camera/target. */
const selectedCamIdFromSel = (sel: string | null): string | null =>
  sel && (sel.startsWith('cam:') || sel.startsWith('tgt:')) ? sel.slice(4) : null

/** Effective look-at: follow a mannequin (chest height) if bound, else manual target. */
function effectiveTarget(cam: StageCamera, mannequins: StageMannequin[]): Vec3 {
  if (cam.lookAtMannequinId) {
    const m = mannequins.find((x) => x.id === cam.lookAtMannequinId)
    if (m) return [m.position[0], m.position[1] + 1.0, m.position[2]]
  }
  return cam.target
}

/** Camera gizmo orientation = lookAt(target) + dutch roll about the view axis. */
function camQuat(cam: StageCamera, mannequins: StageMannequin[]): THREE.Quaternion {
  const target = effectiveTarget(cam, mannequins)
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...cam.position), new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0))
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  if (cam.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), cam.roll * DEG2RAD))
  return q
}

/** Focus point = selected mannequin (or centroid, or origin) at mid-height. */
function focusPoint(mannequins: StageMannequin[], selectedMannequinId: string | null): Vec3 {
  const m = selectedMannequinId ? mannequins.find((x) => x.id === selectedMannequinId) : null
  const subj = m ?? mannequins[0]
  if (subj) return [subj.position[0], subj.position[1] + 1.0, subj.position[2]]
  return [0, 1, 0]
}
function facingOf(mannequins: StageMannequin[], selectedMannequinId: string | null): number {
  const m = selectedMannequinId ? mannequins.find((x) => x.id === selectedMannequinId) : null
  return (m ?? mannequins[0])?.rotation[1] ?? 0
}

/** Bottom-dock icon button with hover tooltip. */
function DockBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
      style={{ background: active ? 'rgba(255,255,255,0.12)' : 'transparent', color: active ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.secondary }}
    >
      {children}
      <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-[11px] group-hover:block" style={{ background: CANVAS_TOKENS.bg.popover, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>{label}</span>
    </button>
  )
}

/* eslint-disable no-restricted-syntax -- canvas-local 3D-stage dock glyphs, not app UI icons */
/** 8 LibTV-style dock glyphs (inline stroke SVG, 20px, currentColor). */
function Glyph({ name }: { name: string }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'pointer': return <svg {...p}><path d="M5 3l7 16 2.5-6.5L21 10z" /></svg>
    case 'person': return <svg {...p}><circle cx="12" cy="6" r="2.4" /><path d="M12 8.4V15M8 11h8M9.5 21l2.5-6 2.5 6" /></svg>
    case 'panorama': return <svg {...p}><path d="M3 8c4-2 14-2 18 0M3 16c4 2 14 2 18 0M3 8v8M21 8v8" /><path d="M13 11l3 2-3 2" /></svg>
    case 'camera': return <svg {...p}><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 10l6-3v10l-6-3z" /></svg>
    case 'frame': return <svg {...p}><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" /></svg>
    case 'photo': return <svg {...p}><circle cx="12" cy="13" r="3.4" /><path d="M4 9a2 2 0 012-2h1l1.2-1.6h6.6L20 7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" /></svg>
    case 'aiimport': return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 14l5-4 4 3 3-2 6 5" /><path d="M12 2v4M10 4h4" /></svg>
    case 'fullscreen': return <svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
    default: return null
  }
}
/* eslint-enable no-restricted-syntax */

interface SceneProps {
  state: DirectorStageState
  selectedId: string | null
  mode: TransformMode
  view: 'director' | 'shot'
  activeShotCamId: string | null
  hiddenIds: Record<string, boolean>
  lockedIds: Record<string, boolean>
  showGrid: boolean
  showGround: boolean
  showLabels: boolean
  onSelect: (id: string | null) => void
  onCommitMannequin: (id: string, patch: Partial<StageMannequin>) => void
  onCommitCamera: (id: string, patch: Partial<StageCamera>) => void
  registerCapture: (fn: (cameraId: string) => string | null) => void
  registerGetView: (fn: () => { position: Vec3; target: Vec3; fov: number }) => void
  registerReset: (fn: () => void) => void
}

function SceneContents({ state, selectedId, mode, view, activeShotCamId, hiddenIds, lockedIds, showGrid, showGround, showLabels, onSelect, onCommitMannequin, onCommitCamera, registerCapture, registerGetView, registerReset }: SceneProps) {
  const { gl, scene, camera: viewCamera } = useThree()
  const helpersRef = useRef<THREE.Group>(null)
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const transformRef = useRef<React.ComponentRef<typeof TransformControls>>(null)
  const mannequinRefs = useRef<Record<string, THREE.Group | null>>({})
  const camGizmoRefs = useRef<Record<string, THREE.Group | null>>({})
  const tgtGizmoRefs = useRef<Record<string, THREE.Mesh | null>>({})

  // Live state in refs so the stable capture closure reads current values.
  const stateRef = useRef(state)
  stateRef.current = state

  const capture = useCallback((cameraId: string): string | null => {
    const s = stateRef.current
    const sc = s.cameras.find((c) => c.id === cameraId)
    if (!sc) return null
    const target = effectiveTarget(sc, s.mannequins)
    const canvas = gl.domElement
    // Render full viewport at the canvas aspect (no distortion); for a fixed
    // output ratio we crop the CANVAS (already sRGB/tone-mapped) — avoids the
    // linear-color readback gotcha of render-target pixel reads.
    const cam = new THREE.PerspectiveCamera(sc.fov, canvas.width / canvas.height || 1, 0.05, 1000)
    cam.position.set(...sc.position)
    cam.lookAt(new THREE.Vector3(...target))
    if (sc.roll) cam.rotateZ(sc.roll * DEG2RAD)

    const helpers = helpersRef.current
    const tc = transformRef.current as unknown as THREE.Object3D | null
    const ph = helpers?.visible
    const pt = tc?.visible
    if (helpers) helpers.visible = false
    if (tc) tc.visible = false
    gl.render(scene, cam)

    const ratio = aspectRatio(s.aspect)
    let url: string
    if (ratio == null) {
      url = canvas.toDataURL('image/png')
    } else {
      const cw = canvas.width
      const ch = canvas.height
      let cropW = cw
      let cropH = ch
      if (ratio > cw / ch) cropH = Math.round(cw / ratio)
      else cropW = Math.round(ch * ratio)
      const sx = Math.floor((cw - cropW) / 2)
      const sy = Math.floor((ch - cropH) / 2)
      const c = document.createElement('canvas')
      c.width = cropW
      c.height = cropH
      const ctx = c.getContext('2d')
      if (!ctx) {
        url = canvas.toDataURL('image/png') // fall back to uncropped rather than throw
      } else {
        ctx.drawImage(canvas, sx, sy, cropW, cropH, 0, 0, cropW, cropH)
        url = c.toDataURL('image/png')
      }
    }
    if (helpers && ph !== undefined) helpers.visible = ph
    if (tc && pt !== undefined) tc.visible = pt
    return url
  }, [gl, scene])

  const getView = useCallback(
    () => ({
      position: viewCamera.position.toArray() as Vec3,
      target: (orbitRef.current?.target?.toArray() as Vec3) ?? [0, 1, 0],
      fov: (viewCamera as THREE.PerspectiveCamera).fov ?? 45,
    }),
    [viewCamera],
  )

  const resetView = useCallback(() => {
    viewCamera.position.set(3.5, 2.6, 5.5)
    if (orbitRef.current) { orbitRef.current.target.set(0, 1, 0); orbitRef.current.update() }
  }, [viewCamera])

  useEffect(() => {
    registerCapture(capture)
    registerGetView(getView)
    registerReset(resetView)
    return () => { registerCapture(() => null) }
  }, [registerCapture, registerGetView, registerReset, capture, getView, resetView])

  // 机位视角: drive the orbit camera to look through the active shot camera.
  // Only positions the camera — orbit.enabled is owned by the single effect
  // below (so there's exactly one writer, no lockout race).
  const activeShot = view === 'shot' && activeShotCamId ? state.cameras.find((c) => c.id === activeShotCamId) ?? null : null
  useEffect(() => {
    const orbit = orbitRef.current
    if (activeShot) {
      const tgt = effectiveTarget(activeShot, state.mannequins)
      viewCamera.position.set(...activeShot.position)
      ;(viewCamera as THREE.PerspectiveCamera).fov = activeShot.fov
      ;(viewCamera as THREE.PerspectiveCamera).updateProjectionMatrix()
      if (orbit) { orbit.target.set(...tgt); orbit.update() }
    } else {
      ;(viewCamera as THREE.PerspectiveCamera).fov = 45
      ;(viewCamera as THREE.PerspectiveCamera).updateProjectionMatrix()
    }
  }, [activeShot, viewCamera, state.mannequins])

  // SINGLE owner of orbit.enabled: free in 导演视角, locked in 机位视角.
  // Re-runs on selection change too, so an interrupted gizmo drag can't leave
  // orbit stuck disabled.
  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enabled = view === 'director'
  }, [view, selectedId])

  const selectedObject: THREE.Object3D | null = selectedId
    ? selectedId.startsWith('cam:')
      ? camGizmoRefs.current[selectedId.slice(4)] ?? null
      : selectedId.startsWith('tgt:')
        ? tgtGizmoRefs.current[selectedId.slice(4)] ?? null
        : mannequinRefs.current[selectedId] ?? null
    : null

  const commitSelected = useCallback(() => {
    const obj = selectedObject
    if (!obj || !selectedId) return
    if (selectedId.startsWith('cam:')) onCommitCamera(selectedId.slice(4), { position: obj.position.toArray() as Vec3 })
    else if (selectedId.startsWith('tgt:')) onCommitCamera(selectedId.slice(4), { target: obj.position.toArray() as Vec3 })
    else onCommitMannequin(selectedId, { position: obj.position.toArray() as Vec3, rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.x })
  }, [selectedObject, selectedId, onCommitCamera, onCommitMannequin])

  const isCamOrTarget = Boolean(selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')))

  return (
    <>
      <color attach="background" args={[CANVAS_TOKENS.bg.canvas]} />
      <hemisphereLight args={['#ffffff', '#2a2a30', 0.85]} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />

      {showGround ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#15151a" roughness={1} />
        </mesh>
      ) : null}

      {/* Helpers — hidden during capture */}
      <group ref={helpersRef}>
        {showGrid ? <Grid args={[40, 40]} cellSize={0.5} cellColor="#2a2a32" sectionSize={2} sectionColor="#3a3a46" fadeDistance={28} infiniteGrid position={[0, 0.001, 0]} /> : null}
        {state.cameras.filter((cam) => !hiddenIds[cam.id]).map((cam) => (
          <group key={cam.id}>
            <group
              ref={(el) => { if (el) camGizmoRefs.current[cam.id] = el; else delete camGizmoRefs.current[cam.id] }}
              position={cam.position}
              quaternion={camQuat(cam, state.mannequins)}
              onClick={(e) => { e.stopPropagation(); onSelect(camKey(cam.id)) }}
            >
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.12, 0.28, 4]} />
                <meshStandardMaterial color={CANVAS_TOKENS.accent} emissive={CANVAS_TOKENS.accent} emissiveIntensity={selectedId === camKey(cam.id) ? 0.55 : 0.18} />
              </mesh>
            </group>
            {cam.lookAtMannequinId ? null : (
              <mesh
                ref={(el) => { if (el) tgtGizmoRefs.current[cam.id] = el; else delete tgtGizmoRefs.current[cam.id] }}
                position={cam.target}
                onClick={(e) => { e.stopPropagation(); onSelect(tgtKey(cam.id)) }}
              >
                <sphereGeometry args={[0.07, 12, 12]} />
                <meshStandardMaterial color={CANVAS_TOKENS.gold} emissive={CANVAS_TOKENS.gold} emissiveIntensity={selectedId === tgtKey(cam.id) ? 0.6 : 0.2} />
              </mesh>
            )}
          </group>
        ))}
      </group>

      {/* navigation cube (top-right). Portals to its own HUD scene so it's never
          in the screenshot; only in 导演视角 so its click-tween can't yank the
          look-through camera in 机位视角. */}
      {view === 'director' ? (
        <GizmoHelper alignment="top-right" margin={[72, 80]}>
          <GizmoViewport axisColors={['#FF6F6F', '#7BE3A4', '#6FA8FF']} labelColor="#fff" />
        </GizmoHelper>
      ) : null}

      {/* Mannequins — wrapping group owns transform + selection */}
      {state.mannequins.filter((m) => !hiddenIds[m.id]).map((m) => (
        <group
          key={m.id}
          ref={(el) => { if (el) mannequinRefs.current[m.id] = el; else delete mannequinRefs.current[m.id] }}
          position={m.position}
          rotation={m.rotation}
          scale={m.scale}
          onClick={(e) => { e.stopPropagation(); onSelect(m.id) }}
        >
          <Mannequin data={m} selected={selectedId === m.id} />
          {showLabels ? (
            <Html position={[0, 2.05, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
              <div style={{ background: 'rgba(10,10,11,0.82)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{m.label}</div>
            </Html>
          ) : null}
        </group>
      ))}

      {/* transform gizmo — not on locked objects, not in 机位视角 */}
      {selectedObject && view === 'director' && !(selectedId && lockedIds[selectedId.replace(/^(cam|tgt):/, '')]) ? (
        <TransformControls
          ref={transformRef}
          object={selectedObject}
          mode={isCamOrTarget ? 'translate' : mode}
          onObjectChange={commitSelected}
          // Disable orbit during the drag; restore to the view-derived value on
          // release (gizmo only shows in 导演视角 so that's `true`). If the gizmo
          // unmounts mid-drag, the single enabled-effect restores it.
          onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false }}
          onMouseUp={() => { if (orbitRef.current) orbitRef.current.enabled = view === 'director' }}
        />
      ) : null}

      <OrbitControls ref={orbitRef} makeDefault target={[0, 1, 0]} enablePan />
    </>
  )
}

interface DirectorStageProps {
  initialState: DirectorStageState
  onClose: () => void
  /** Capture cameraId's POV → spawn a frame on the canvas (label = camera label). */
  onSendShot: (dataUrl: string, label: string, state: DirectorStageState) => void | Promise<void>
  /** Names of character nodes wired into the director (the cast), for display. */
  castLabels?: string[]
  saving?: boolean
}

export function DirectorStage({ initialState, onClose, onSendShot, castLabels = [], saving }: DirectorStageProps) {
  const [state, setState] = useState<DirectorStageState>(initialState)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [toast, setToast] = useState<string | null>(null)
  const [sentTotal, setSentTotal] = useState(0)
  const [view, setView] = useState<'director' | 'shot'>('director')
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>({})
  const [lockedIds, setLockedIds] = useState<Record<string, boolean>>({})
  const [showGrid, setShowGrid] = useState(true)
  const [showGround, setShowGround] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [search, setSearch] = useState('')
  const [addMenu, setAddMenu] = useState(false)
  const [aspectMenu, setAspectMenu] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const captureRef = useRef<((cameraId: string) => string | null) | null>(null)
  const getViewRef = useRef<(() => { position: Vec3; target: Vec3; fov: number }) | null>(null)
  const resetViewRef = useRef<(() => void) | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 })

  // Active shot camera for 机位视角 = selected camera, else first.
  const activeShotCamId = (selectedCamIdFromSel(selectedId) ?? state.cameras[0]?.id) ?? null

  // Measure the stage so the framing overlay matches capture()'s centered
  // max-fit crop exactly (same cw/ch ratio the crop uses).
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setRootSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setRootSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const addMannequin = useCallback((bodyType: BodyType = 'male') => {
    const nid = uid()
    setState((s) => ({ ...s, mannequins: [...s.mannequins, makeMannequin(nid, s.mannequins.length, bodyType)] }))
    setSelectedId(nid)
    setAddMenu(false)
  }, [])
  const addCamera = useCallback(() => {
    const nid = uid()
    setState((s) => ({ ...s, cameras: [...s.cameras, makeCamera(nid, s.cameras.length)] }))
    setSelectedId(camKey(nid))
  }, [])

  const toggleHidden = useCallback((id: string) => setHiddenIds((h) => ({ ...h, [id]: !h[id] })), [])
  const toggleLocked = useCallback((id: string) => setLockedIds((l) => ({ ...l, [id]: !l[id] })), [])

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (!document.fullscreenElement) { el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {}) }
    else { document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => {}) }
  }, [])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    if (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) {
      const cid = selectedId.slice(4)
      setState((s) => (s.cameras.length <= 1 ? s : { ...s, cameras: s.cameras.filter((c) => c.id !== cid) }))
    } else {
      setState((s) => ({
        ...s,
        mannequins: s.mannequins.filter((m) => m.id !== selectedId),
        // drop any camera's follow binding to the deleted mannequin
        cameras: s.cameras.map((c) => (c.lookAtMannequinId === selectedId ? { ...c, lookAtMannequinId: null } : c)),
      }))
    }
    setSelectedId(null)
  }, [selectedId])

  const commitMannequin = useCallback((id: string, patch: Partial<StageMannequin>) => {
    setState((s) => ({ ...s, mannequins: s.mannequins.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
  }, [])
  const commitCamera = useCallback((id: string, patch: Partial<StageCamera>) => {
    setState((s) => ({ ...s, cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  }, [])

  const applyPose = useCallback((id: string, pose: Pose) => {
    setState((s) => ({ ...s, mannequins: s.mannequins.map((m) => (m.id === id ? { ...m, pose } : m)) }))
  }, [])
  const setJointAxis = useCallback((id: string, joint: Joint, axis: 0 | 1 | 2, rad: number) => {
    setState((s) => ({
      ...s,
      mannequins: s.mannequins.map((m) => {
        if (m.id !== id) return m
        const cur = m.pose ?? REST_POSE
        const nextAxis = [...cur.joints[joint]] as [number, number, number]
        nextAxis[axis] = rad
        return { ...m, pose: { ...cur, joints: { ...cur.joints, [joint]: nextAxis } } }
      }),
    }))
  }, [])

  const sendShot = useCallback(async (cameraId: string) => {
    const cam = state.cameras.find((c) => c.id === cameraId)
    if (!cam) return
    if (state.mannequins.length === 0) { setToast('先加至少一个人偶再发送'); return }
    const url = captureRef.current?.(cameraId)
    if (!url) { setToast('截图失败，请重试'); return }
    try {
      setToast(`发送中… ${cam.label}`)
      await onSendShot(url, cam.label, state)
      setSentTotal((n) => n + 1)
      setToast(`✓ ${cam.label} 已发送到画布（关闭导演台后可见）`)
    } catch (e) {
      setToast(`发送失败：${(e as Error)?.message ?? '未知错误'}`)
    }
  }, [onSendShot, state])

  const selectedMannequin = state.mannequins.find((m) => m.id === selectedId) ?? null
  const selectedCamId = selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) ? selectedId.slice(4) : null
  const selectedCamera = selectedCamId ? state.cameras.find((c) => c.id === selectedCamId) ?? null : null

  const applyCameraPreset = useCallback((camId: string, preset: typeof CAMERA_PRESETS[number]) => {
    // 当前视角 needs the live view; bail if not registered yet (avoids a
    // self-referential degenerate camera at the focus point).
    const liveView = preset.current ? getViewRef.current?.() ?? null : null
    if (preset.current && !liveView) { setToast('视角未就绪，请稍候'); return }
    setState((s) => {
      const cam = s.cameras.find((c) => c.id === camId)
      const focusId = cam?.lookAtMannequinId ?? null
      const shot = computePreset(preset, focusPoint(s.mannequins, focusId), facingOf(s.mannequins, focusId), liveView)
      // A preset sets an explicit position+target, so clear follow — otherwise
      // effectiveTarget would override the preset's framing.
      return { ...s, cameras: s.cameras.map((c) => (c.id === camId ? { ...c, position: shot.position, target: shot.target, fov: shot.fov, roll: shot.roll, lookAtMannequinId: null } : c)) }
    })
  }, [])
  const setAspect = useCallback((a: StageAspect) => setState((s) => ({ ...s, aspect: a })), [])

  const btn = 'rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors'

  return (
    <div ref={rootRef} className="fixed inset-0 z-50" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <Canvas shadows gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [3.5, 2.6, 5.5], fov: 45 }} onPointerMissed={() => setSelectedId(null)}>
        <SceneContents
          state={state}
          selectedId={selectedId}
          mode={mode}
          view={view}
          activeShotCamId={activeShotCamId}
          hiddenIds={hiddenIds}
          lockedIds={lockedIds}
          showGrid={showGrid}
          showGround={showGround}
          showLabels={showLabels}
          onSelect={setSelectedId}
          onCommitMannequin={commitMannequin}
          onCommitCamera={commitCamera}
          registerCapture={(fn) => { captureRef.current = fn }}
          registerGetView={(fn) => { getViewRef.current = fn }}
          registerReset={(fn) => { resetViewRef.current = fn }}
        />
      </Canvas>

      {/* Framing overlay — exactly the centered max-fit crop region */}
      {(() => {
        const R = aspectRatio(state.aspect)
        if (!R || rootSize.w === 0 || rootSize.h === 0) return null
        const ar = rootSize.w / rootSize.h
        const w = R > ar ? rootSize.w : rootSize.h * R
        const h = R > ar ? rootSize.w / R : rootSize.h
        return (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div style={{ width: w, height: h, border: `1px solid ${CANVAS_TOKENS.accent}aa`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.34)' }} />
          </div>
        )
      })()}

      {/* Top bar: title | 导演视角/机位视角 toggle | help+close */}
      <div className="absolute inset-x-0 top-0 flex h-12 items-center justify-between px-4" style={{ background: `${CANVAS_TOKENS.bg.panel}cc`, borderBottom: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2 font-mono text-[13px]">
          <span style={{ color: CANVAS_TOKENS.accent }}>◐</span>
          <span style={{ color: CANVAS_TOKENS.text.primary }}>3D导演台</span>
          {castLabels.length > 0 ? <span className="ml-2 rounded px-2 py-0.5 text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>卡司：{castLabels.join('、')}</span> : null}
        </div>
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-lg p-0.5" style={{ background: CANVAS_TOKENS.bg.hover }}>
          {(['director', 'shot'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className="rounded-md px-3 py-1 font-mono text-[12px]" style={{ background: view === v ? CANVAS_TOKENS.bg.card : 'transparent', color: view === v ? CANVAS_TOKENS.text.primary : CANVAS_TOKENS.text.muted }}>
              {v === 'director' ? '导演视角' : '机位视角'}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className={btn} style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕</button>
      </div>

      {/* Left 场景 panel — scene tree (cameras + mannequins) with hide/lock/select */}
      <div className="absolute left-0 top-12 bottom-0 flex w-56 flex-col" style={{ background: `${CANVAS_TOKENS.bg.panel}f2`, borderRight: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <div className="px-3 py-2 font-mono text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>场景</div>
        <div className="px-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索对象" className="w-full rounded-md px-2 py-1.5 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {[
            ...state.cameras.map((c) => ({ id: c.id, key: camKey(c.id), label: c.label, glyph: '◢', accent: CANVAS_TOKENS.accent })),
            ...state.mannequins.map((m) => ({ id: m.id, key: m.id, label: m.label, glyph: '人', accent: m.color })),
          ]
            .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))
            .map((o) => {
              const sel = selectedId === o.key || selectedId === tgtKey(o.id)
              return (
                <div key={o.key} className="group flex items-center gap-1 rounded-md px-1.5 py-1" style={{ background: sel ? CANVAS_TOKENS.bg.hover : 'transparent' }}>
                  <button type="button" onClick={() => setSelectedId(o.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]" style={{ color: sel ? o.accent : CANVAS_TOKENS.text.primary, opacity: hiddenIds[o.id] ? 0.4 : 1 }}>
                    <span style={{ color: o.accent }}>{o.glyph}</span>
                    <span className="truncate">{o.label}</span>
                  </button>
                  <button type="button" title="隐藏" onClick={() => toggleHidden(o.id)} className="px-1 text-[11px]" style={{ color: hiddenIds[o.id] ? CANVAS_TOKENS.gold : CANVAS_TOKENS.text.muted }}>{hiddenIds[o.id] ? '◌' : '◉'}</button>
                  <button type="button" title="锁定" onClick={() => toggleLocked(o.id)} className="px-1 text-[11px]" style={{ color: lockedIds[o.id] ? CANVAS_TOKENS.gold : CANVAS_TOKENS.text.muted }}>{lockedIds[o.id] ? '🔒' : '🔓'}</button>
                </div>
              )
            })}
          {state.cameras.length === 0 && state.mannequins.length === 0 ? <div className="px-2 py-3 text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>用底部工具栏添加角色/机位</div> : null}
        </div>
        {selectedId ? (
          <button type="button" onClick={removeSelected} className="m-2 rounded-md py-1.5 text-[12px]" style={{ color: '#FF8A8A', background: CANVAS_TOKENS.bg.hover }}>✕ 删除选中</button>
        ) : null}
      </div>

      {/* ViewCube reset (top-right, below the gizmo) */}
      <button type="button" onClick={() => resetViewRef.current?.()} className="absolute right-5 top-28 rounded-md px-2 py-1 font-mono text-[11px]" style={{ background: `${CANVAS_TOKENS.bg.card}e6`, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>重置视角</button>

      {/* Rig panel — pose presets + per-joint sliders, shown on mannequin select */}
      {selectedMannequin ? (
        <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <span className="font-mono text-[12px]" style={{ color: selectedMannequin.color }}>{selectedMannequin.label}</span>
            <button type="button" onClick={() => applyPose(selectedMannequin.id, REST_POSE)} className="rounded px-2 py-0.5 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>重置姿势</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {/* transform mode + body type */}
            <div className="mb-2 flex gap-1">
              {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className="flex-1 rounded py-1 text-[11px]" style={{ color: mode === m ? '#06222A' : CANVAS_TOKENS.text.secondary, background: mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover }}>
                  {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
                </button>
              ))}
            </div>
            <label className="mb-2 block">
              <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>素体类型</span>
              <select value={selectedMannequin.bodyType ?? 'male'} onChange={(e) => commitMannequin(selectedMannequin.id, { bodyType: e.target.value as BodyType })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
                {BODY_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </label>
            <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>预设姿势</div>
            <div className="mb-3 grid grid-cols-3 gap-1">
              {POSE_PRESETS.map((preset) => (
                <button key={preset.name} type="button" onClick={() => applyPose(selectedMannequin.id, preset.pose)} className="rounded py-1 text-[11px] transition-colors hover:opacity-80" style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>{preset.name}</button>
              ))}
            </div>
            {RIG_SLIDER_GROUPS.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="mb-0.5 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{g.group}</div>
                {g.rows.map((row) => (
                  <SliderRow key={`${row.joint}-${row.axis}`} label={row.label} value={(selectedMannequin.pose ?? REST_POSE).joints[row.joint][row.axis] * RAD2DEG} min={-180} max={180} onChange={(deg) => setJointAxis(selectedMannequin.id, row.joint, row.axis, deg * DEG2RAD)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Camera inspector — shown when a camera/target is selected */}
      {selectedCamera && selectedCamId ? (
        <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <span className="font-mono text-[12px]" style={{ color: CANVAS_TOKENS.accent }}>摄像机 · {selectedCamera.label}</span>
            <button type="button" onClick={() => sendShot(selectedCamId)} disabled={saving} className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}>发送</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            <label className="block">
              <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>名称</span>
              <input value={selectedCamera.label} onChange={(e) => commitCamera(selectedCamId, { label: e.target.value })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
            </label>
            <label className="block">
              <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>切换机位</span>
              <select value={selectedCamId} onChange={(e) => setSelectedId(camKey(e.target.value))} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>
                {state.cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <Vec3Field label="位置" value={selectedCamera.position} onChange={(v) => commitCamera(selectedCamId, { position: v })} />
            <label className="block">
              <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>注视目标</span>
              <select
                value={selectedCamera.lookAtMannequinId ?? 'manual'}
                onChange={(e) => commitCamera(selectedCamId, { lookAtMannequinId: e.target.value === 'manual' ? null : e.target.value })}
                className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none"
                style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
              >
                <option value="manual">手动坐标</option>
                {state.mannequins.map((m) => <option key={m.id} value={m.id}>追踪：{m.label}</option>)}
              </select>
            </label>
            {selectedCamera.lookAtMannequinId ? null : (
              <Vec3Field label="注视坐标" value={selectedCamera.target} onChange={(v) => commitCamera(selectedCamId, { target: v })} />
            )}
            <SliderRow label="FOV" value={selectedCamera.fov} min={18} max={90} unit="°" onChange={(v) => commitCamera(selectedCamId, { fov: v })} />
            <SliderRow label="荷兰角" value={selectedCamera.roll ?? 0} min={-45} max={45} unit="°" onChange={(v) => commitCamera(selectedCamId, { roll: v })} />
            <div className="pt-1">
              <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>机位视角预设</div>
              <div className="grid grid-cols-2 gap-1">
                {CAMERA_PRESETS.map((preset) => (
                  <button key={preset.name} type="button" onClick={() => applyCameraPreset(selectedCamId, preset)} className="rounded py-1 text-[11px] transition-colors hover:opacity-80" style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>{preset.name}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3D场景 props — shown when nothing is selected */}
      {!selectedMannequin && !selectedCamera ? (
        <div className="absolute right-4 top-16 w-56 rounded-xl p-3" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
          <div className="mb-2 font-mono text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>3D场景</div>
          {([['角色标签', showLabels, setShowLabels], ['网格', showGrid, setShowGrid], ['地面', showGround, setShowGround]] as const).map(([label, val, set]) => (
            <button key={label} type="button" onClick={() => set(!val)} className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>
              <span>{label}</span>
              <span style={{ color: val ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.muted }}>{val ? '● 开' : '○ 关'}</span>
            </button>
          ))}
          <div className="mt-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>选中角色/机位编辑属性 · 全景背景将于批 C 加入</div>
        </div>
      ) : null}

      {/* close dock dropdowns on outside click */}
      {addMenu || aspectMenu ? <div className="absolute inset-0 z-[9]" onClick={() => { setAddMenu(false); setAspectMenu(false) }} /> : null}

      {/* Bottom dock — all tools (LibTV layout) */}
      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl px-2 py-1.5" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
        <DockBtn label="选择" active={!selectedId} onClick={() => setSelectedId(null)}><Glyph name="pointer" /></DockBtn>
        <div className="relative">
          <DockBtn label="添加角色" active={addMenu} onClick={() => { setAddMenu((v) => !v); setAspectMenu(false) }}><Glyph name="person" /></DockBtn>
          {addMenu ? (
            <div className="absolute bottom-12 left-0 w-40 overflow-hidden rounded-xl" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              {BODY_TYPES.map((b) => (
                <button key={b.key} type="button" onClick={() => addMannequin(b.key)} className="block w-full px-3 py-2 text-left text-[12px] hover:bg-white/5" style={{ color: CANVAS_TOKENS.text.primary }}>{b.label}</button>
              ))}
            </div>
          ) : null}
        </div>
        <DockBtn label="全景图（批C）" onClick={() => setToast('全景背景将于批 C（生成）加入')}><Glyph name="panorama" /></DockBtn>
        <DockBtn label="添加机位" onClick={addCamera}><Glyph name="camera" /></DockBtn>
        <div className="relative">
          <DockBtn label="画幅比例" active={aspectMenu} onClick={() => { setAspectMenu((v) => !v); setAddMenu(false) }}><Glyph name="frame" /></DockBtn>
          {aspectMenu ? (
            <div className="absolute bottom-12 left-0 w-32 overflow-hidden rounded-xl" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              {STAGE_ASPECTS.map((a) => (
                <button key={a} type="button" onClick={() => { setAspect(a); setAspectMenu(false) }} className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-white/5" style={{ color: (state.aspect ?? 'auto') === a ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.primary }}>{a === 'auto' ? '自适应' : a}</button>
              ))}
            </div>
          ) : null}
        </div>
        <DockBtn label="截图发送当前机位" onClick={() => activeShotCamId && sendShot(activeShotCamId)}><Glyph name="photo" /></DockBtn>
        <DockBtn label="AI识图导入（批C）" onClick={() => setToast('AI 识图导入将于批 C（生成）加入')}><Glyph name="aiimport" /></DockBtn>
        <DockBtn label={fullscreen ? '退出全屏' : '全屏'} onClick={toggleFullscreen}><Glyph name="fullscreen" /></DockBtn>
        {sentTotal > 0 ? <span className="ml-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>已发送 {sentTotal} 帧</span> : null}
      </div>

      {/* Toast — send feedback (the spawned frame is behind this fullscreen stage) */}
      {toast ? (
        <div
          className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg px-4 py-2 font-mono text-[12px]"
          style={{ background: `${CANVAS_TOKENS.bg.popover}f5`, border: `1px solid ${CANVAS_TOKENS.accent}66`, color: CANVAS_TOKENS.text.primary, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {toast}
        </div>
      ) : null}

    </div>
  )
}
