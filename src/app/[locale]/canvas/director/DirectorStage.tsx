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
import { REST_POSE, type Joint, type Pose } from './pose-presets'
import { CAMERA_PRESETS, aspectRatio, computePreset } from './camera-presets'
import { SceneBackground, orientBackdrop } from './SceneBackground'
import {
  type BodyType,
  type DirectorStageState,
  type StageAspect,
  type StageBackground,
  type StageCamera,
  type StageMannequin,
  type TransformMode,
  type Vec3,
  type PropKind,
  type StageProp,
  BODY_TYPES,
  DEFAULT_BACKGROUND,
  PROP_KINDS,
  STAGE_ASPECTS,
  makeCamera,
  makeMannequin,
  makeProp,
} from './stage-types'
import { MAX_SCENE_SEC, SHOT_MIN_SEC, clampShots, makeShot, totalDurationSec, type ShotKeyframe, type StageShot } from './previz-types'
import { usePrevizPlayback } from './use-previz-playback'
import { PrevizDriver } from './PrevizDriver'
import { PrevizTimeline } from './PrevizTimeline'
import { PrevizShotPanel } from './PrevizShotPanel'
import { ACTOR_PATH_LIFT_Y, PathVisuals, parseWpKey, type WpDesc } from './PathVisuals'
import { StagePropMesh } from './StagePropMesh'
import { PropPanel } from './PropPanel'
import { RigPanel } from './RigPanel'
import { CameraPanel } from './CameraPanel'
import { applyCameraMovePreset, CAMERA_MOVE_PRESETS, type CameraMoveKey } from './camera-motion-presets'
import { frameCameraAtDistance } from './camera-lens'
import { buildPrevizDirectorText } from './previz-director-text'
import { applyShotCameraView } from './shot-camera-view'
import { computeExportCrop, recordPrevizClip } from './previz-record'
import { RoutePlansPanel } from './RoutePlansPanel'
import { BlockingPanel } from './BlockingPanel'
import { materializeRoutePlan } from './route-materialize'
import type { PrevizCrop } from '@/lib/canvas/previz-transcode'
import type { DirectorRouteInputMode, DirectorRoutePlan, DirectorRouteSegment } from '@/lib/canvas/director-routes-schema'
import { materializeDirectorBlocking, type DirectorBlockingDraft } from '@/lib/canvas/director-blocking-schema'

const DEG2RAD = Math.PI / 180
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const camKey = (id: string) => `cam:${id}`
const tgtKey = (id: string) => `tgt:${id}`
/** camera id from a selection key, or null if the selection isn't a camera/target. */
const selectedCamIdFromSel = (sel: string | null): string | null =>
  sel && (sel.startsWith('cam:') || sel.startsWith('tgt:')) ? sel.slice(4) : null

/** Effective look-at: follow a mannequin or prop if bound, else manual target. */
function effectiveTarget(cam: StageCamera, mannequins: StageMannequin[], props: StageProp[]): Vec3 {
  let t: Vec3 = cam.target
  if (cam.lookAtObjectId) {
    const mannequin = mannequins.find((item) => item.id === cam.lookAtObjectId)
    const prop = props.find((item) => item.id === cam.lookAtObjectId)
    if (mannequin) t = [mannequin.position[0], mannequin.position[1] + 1.0, mannequin.position[2]]
    else if (prop) t = [...prop.position]
  }
  // Guard the degenerate eye==target case (lookAt → NaN quaternion): nudge +Z.
  const dx = t[0] - cam.position[0], dy = t[1] - cam.position[1], dz = t[2] - cam.position[2]
  if (dx * dx + dy * dy + dz * dz < 1e-6) return [t[0], t[1], t[2] + 0.01]
  return t
}

/** Camera gizmo orientation = lookAt(target) + dutch roll about the view axis. */
function camQuat(cam: StageCamera, mannequins: StageMannequin[], props: StageProp[]): THREE.Quaternion {
  const target = effectiveTarget(cam, mannequins, props)
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...cam.position), new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0))
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  if (cam.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), cam.roll * DEG2RAD))
  return q
}

/** Focus point = selected scene object (or first mannequin, or origin). */
function focusPoint(mannequins: StageMannequin[], props: StageProp[], selectedObjectId: string | null): Vec3 {
  const mannequin = selectedObjectId ? mannequins.find((item) => item.id === selectedObjectId) : null
  const prop = selectedObjectId ? props.find((item) => item.id === selectedObjectId) : null
  const fallback = mannequins[0]
  if (mannequin) return [mannequin.position[0], mannequin.position[1] + 1.0, mannequin.position[2]]
  if (prop) return [...prop.position]
  if (fallback) return [fallback.position[0], fallback.position[1] + 1.0, fallback.position[2]]
  return [0, 1, 0]
}
function facingOf(mannequins: StageMannequin[], props: StageProp[], selectedObjectId: string | null): number {
  const object = selectedObjectId
    ? [...mannequins, ...props].find((item) => item.id === selectedObjectId)
    : null
  return (object ?? mannequins[0])?.rotation[1] ?? 0
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
    case 'blocking': return <svg {...p}><path d="M4 18h16M7 18v-5h4v5M15 18v-8h4v8" /><circle cx="9" cy="7" r="2" /><circle cx="17" cy="5" r="2" /><path d="M12 9l2-2" /></svg>
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
  /** previz 播放驱动（激活时命令式接管相机+actor，锁 orbit/gizmo）+ 路径层。 */
  previz: {
    active: boolean
    getTimeSec: () => number
    selectedShot: StageShot | null
    showCameraPath: boolean
    showActorPaths: boolean
    /** 录制导出中 — 隐藏 helpers（网格/路径/机位锥），画面只留正片内容。 */
    recording: boolean
  }
  onSelect: (id: string | null) => void
  onEnterCameraView: (id: string) => void
  onCommitMannequin: (id: string, patch: Partial<StageMannequin>) => void
  onCommitCamera: (id: string, patch: Partial<StageCamera>) => void
  onCommitProp: (id: string, patch: Partial<StageProp>) => void
  onCommitWaypoint: (desc: WpDesc, position: Vec3) => void
  registerCapture: (fn: (cameraId: string) => string | null) => void
  registerGetView: (fn: () => { position: Vec3; target: Vec3; fov: number }) => void
  registerReset: (fn: () => void) => void
  onBgError?: () => void
}

function SceneContents({ state, selectedId, mode, view, activeShotCamId, hiddenIds, lockedIds, showGrid, showGround, showLabels, previz, onSelect, onEnterCameraView, onCommitMannequin, onCommitCamera, onCommitProp, onCommitWaypoint, registerCapture, registerGetView, registerReset, onBgError }: SceneProps) {
  const { gl, scene, camera: viewCamera } = useThree()
  const helpersRef = useRef<THREE.Group>(null)
  const backdropRef = useRef<THREE.Mesh>(null)
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const transformRef = useRef<React.ComponentRef<typeof TransformControls>>(null)
  // 人偶 + 道具共用一本 actor refs（id 均为 uid，previz 驱动按 id 找 group）。
  const actorRefs = useRef<Record<string, THREE.Group | null>>({})
  const camGizmoRefs = useRef<Record<string, THREE.Group | null>>({})
  const tgtGizmoRefs = useRef<Record<string, THREE.Mesh | null>>({})
  const wpRefs = useRef<Record<string, THREE.Mesh | null>>({})

  // Live state in refs so the stable capture closure reads current values.
  const stateRef = useRef(state)
  stateRef.current = state

  const capture = useCallback((cameraId: string): string | null => {
    const s = stateRef.current
    const sc = s.cameras.find((c) => c.id === cameraId)
    if (!sc) return null
    const target = effectiveTarget(sc, s.mannequins, s.props)
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
    // Orient the flat 场景幕布 to THIS shot camera (useFrame won't run mid-capture).
    if (backdropRef.current) orientBackdrop(backdropRef.current, sc.position[0], sc.position[2])
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
  // previz 播放期间跳过（PrevizDriver 每帧接管相机）；depends on previz.active
  // 所以退出预演时会重跑，把 机位视角 的相机位置/FOV 从预演残留状态拉回
  // 机位本身（review 2026-07-13 HIGH#2 —— 否则退出后卡在预演末帧 + fov 45）。
  const activeShot = view === 'shot' && activeShotCamId ? state.cameras.find((c) => c.id === activeShotCamId) ?? null : null
  useEffect(() => {
    if (previz.active) return
    const orbit = orbitRef.current
    if (activeShot) {
      const tgt = effectiveTarget(activeShot, state.mannequins, state.props)
      applyShotCameraView(viewCamera as THREE.PerspectiveCamera, orbit, activeShot, tgt)
    } else {
      ;(viewCamera as THREE.PerspectiveCamera).fov = 45
      ;(viewCamera as THREE.PerspectiveCamera).updateProjectionMatrix()
    }
  }, [activeShot, viewCamera, state.mannequins, state.props, previz.active])

  // SINGLE owner of orbit.enabled: free in 导演视角, locked in 机位视角 and
  // during previz playback (the driver owns the camera then). Re-runs on
  // selection change too, so an interrupted gizmo drag can't leave orbit
  // stuck disabled.
  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enabled = view === 'director' && !previz.active
  }, [view, selectedId, previz.active])

  // 录制导出中隐藏 helpers 组（capture() 是瞬时隐藏，录制要持续整段）。
  useEffect(() => {
    if (helpersRef.current) helpersRef.current.visible = !previz.recording
  }, [previz.recording])

  const isProp = useCallback((id: string) => state.props.some((p) => p.id === id), [state.props])

  const selectedObject: THREE.Object3D | null = selectedId
    ? selectedId.startsWith('cam:')
      ? camGizmoRefs.current[selectedId.slice(4)] ?? null
      : selectedId.startsWith('tgt:')
        ? tgtGizmoRefs.current[selectedId.slice(4)] ?? null
        : selectedId.startsWith('wp:')
          ? wpRefs.current[selectedId] ?? null
          : actorRefs.current[selectedId] ?? null
    : null

  const commitSelected = useCallback(() => {
    const obj = selectedObject
    if (!obj || !selectedId) return
    if (selectedId.startsWith('cam:')) onCommitCamera(selectedId.slice(4), { position: obj.position.toArray() as Vec3 })
    else if (selectedId.startsWith('tgt:')) onCommitCamera(selectedId.slice(4), { target: obj.position.toArray() as Vec3 })
    else if (selectedId.startsWith('wp:')) {
      const desc = parseWpKey(selectedId)
      if (desc) onCommitWaypoint(desc, obj.position.toArray() as Vec3)
    } else if (isProp(selectedId)) {
      onCommitProp(selectedId, { position: obj.position.toArray() as Vec3, rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.toArray() as Vec3 })
    } else onCommitMannequin(selectedId, { position: obj.position.toArray() as Vec3, rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.x })
  }, [selectedObject, selectedId, onCommitCamera, onCommitMannequin, onCommitProp, onCommitWaypoint, isProp])

  // cam/tgt/waypoint gizmos are position-only handles → force translate mode.
  const isCamOrTarget = Boolean(selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:') || selectedId.startsWith('wp:')))

  return (
    <>
      <SceneBackground bg={state.background ?? DEFAULT_BACKGROUND} onError={onBgError} backdropRef={backdropRef} key={state.background?.url ?? 'none'} />
      <PrevizDriver active={previz.active} shots={state.shots} getTimeSec={previz.getTimeSec} actorRefs={actorRefs} restActors={[...state.mannequins, ...state.props]} />
      <hemisphereLight args={['#ffffff', '#2a2a30', 0.85]} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />

      {showGround ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          {/* With a scene background, make the floor a transparent shadow-catcher:
              the black slab disappears and characters cast shadows onto the scene
              → they read as grounded IN the environment, not floating on a plane. */}
          {state.background?.url && state.background.mode !== 'none' ? (
            <shadowMaterial transparent opacity={0.4} />
          ) : (
            <meshStandardMaterial color="#15151a" roughness={1} />
          )}
        </mesh>
      ) : null}

      {/* Helpers — hidden during capture */}
      <group ref={helpersRef}>
        {showGrid ? <Grid args={[40, 40]} cellSize={0.5} cellColor="#2a2a32" sectionSize={2} sectionColor="#3a3a46" fadeDistance={28} infiniteGrid position={[0, 0.001, 0]} /> : null}
        {/* 调度线/运镜线 — 选中镜头的路径层（预演播放时也显示，capture 时随 helpers 隐藏） */}
        {previz.selectedShot ? (
          <PathVisuals
            shot={previz.selectedShot}
            showCameraPath={previz.showCameraPath}
            showActorPaths={previz.showActorPaths}
            selectedId={selectedId}
            onSelect={onSelect}
            registerWp={(key, el) => { if (el) wpRefs.current[key] = el; else delete wpRefs.current[key] }}
          />
        ) : null}
        {state.cameras.filter((cam) => !hiddenIds[cam.id]).map((cam) => (
          <group key={cam.id}>
            <group
              ref={(el) => { if (el) camGizmoRefs.current[cam.id] = el; else delete camGizmoRefs.current[cam.id] }}
              position={cam.position}
              quaternion={camQuat(cam, state.mannequins, state.props)}
              onClick={(e) => { e.stopPropagation(); onSelect(camKey(cam.id)) }}
              onDoubleClick={(e) => { e.stopPropagation(); onEnterCameraView(cam.id) }}
            >
              {/* Recognisable camera body; double-click looks through its lens. */}
              <mesh>
                <boxGeometry args={[0.28, 0.18, 0.2]} />
                <meshStandardMaterial color={CANVAS_TOKENS.accent} emissive={CANVAS_TOKENS.accent} emissiveIntensity={selectedId === camKey(cam.id) ? 0.55 : 0.18} />
              </mesh>
              <mesh position={[0, 0, -0.16]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.07, 0.09, 0.12, 16]} />
                <meshStandardMaterial color={CANVAS_TOKENS.accent} emissive={CANVAS_TOKENS.accent} emissiveIntensity={0.22} />
              </mesh>
            </group>
            {cam.lookAtObjectId ? null : (
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
          ref={(el) => { if (el) actorRefs.current[m.id] = el; else delete actorRefs.current[m.id] }}
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

      {/* 道具 — 与人偶同款 transform/选中通道，注册进同一本 actorRefs */}
      {state.props.filter((p) => !hiddenIds[p.id]).map((p) => (
        <group
          key={p.id}
          ref={(el) => { if (el) actorRefs.current[p.id] = el; else delete actorRefs.current[p.id] }}
          position={p.position}
          rotation={p.rotation}
          scale={p.scale}
          onClick={(e) => { e.stopPropagation(); onSelect(p.id) }}
        >
          <StagePropMesh data={p} selected={selectedId === p.id} />
          {showLabels ? (
            <Html position={[0, 1.6, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
              <div style={{ background: 'rgba(10,10,11,0.82)', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{p.label}</div>
            </Html>
          ) : null}
        </group>
      ))}

      {/* transform gizmo — not on locked objects, not in 机位视角, not during previz */}
      {selectedObject && view === 'director' && !previz.active && !(selectedId && lockedIds[selectedId.replace(/^(cam|tgt):/, '')]) ? (
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

/** previz 导出载荷 — DirectorNode 拿去上传/转码/生成视频节点。 */
export interface PrevizExportPayload {
  blob: Blob
  mimeType: string
  aspect: '9:16' | '16:9'
  durationSec: number
  crop: PrevizCrop
  scope: 'shot' | 'scene'
  title: string
  directorText: string
  /** Exact ordered source shots represented by this export. */
  shotIds: string[]
  state: DirectorStageState
}

interface DirectorStageProps {
  initialState: DirectorStageState
  onClose: () => void
  /** Capture camera POV → spawn a frame and retain the exact camera metadata. */
  onSendShot: (dataUrl: string, camera: StageCamera, state: DirectorStageState) => void | Promise<void>
  /** 导出预演 → 上传转码 → 生成带参考视频的视频节点；返回可预览/下载的 MP4 URL。 */
  onExportPreviz?: (payload: PrevizExportPayload) => Promise<{ videoUrl: string }>
  /**
   * 关闭导演台时把最终舞台状态（含 previz 镜头序列/道具）持久化回节点。
   * v2 只在「发送」时存——previz 的时间轴工作量大得多，直接 ✕ 关掉丢
   * 全部排练不可接受（review 2026-07-13 HIGH#4）。
   */
  onPersistState?: (state: DirectorStageState) => void
  /** AI 导演路线：提交 CANVAS_DIRECTOR_ROUTES 任务并轮询到完成（S4）。 */
  onGenerateRoutes?: (description: string, mode: DirectorRouteInputMode, cast: string[], props: string[]) => Promise<DirectorRouteSegment[]>
  /** AI 排戏：把自然语言转换为待确认的可编辑 3D 场景草稿。 */
  onGenerateBlocking?: (description: string) => Promise<DirectorBlockingDraft>
  /** Storyboard-derived brief used to open AI blocking without re-pasting text. */
  initialBlockingDescription?: string
  /** Names of character nodes wired into the director (the cast), for display. */
  castLabels?: string[]
  saving?: boolean
  /** Upload a scene-background image → durable COS key + signed URL. */
  uploadImage?: (file: File) => Promise<{ key: string; url: string }>
  /** Generate an image (AI识图: flat → 360 panorama). Resolves to result URL. */
  generateImage?: (opts: { prompt: string; refKey?: string; aspectRatio?: string }) => Promise<{ url: string }>
  /** Upstream image nodes (e.g. 720全景图) usable as the 全景球 background. */
  upstreamImages?: { runId: string; label: string; url: string }[]
  /** Copy an upstream run-result into a durable bg key. Resolves to {key, url}. */
  importBackground?: (runId: string) => Promise<{ key: string; url: string }>
}

const PANORAMA_PROMPT = '将这张场景图转换为无缝衔接的 360° 等距圆柱全景图（equirectangular panorama，2:1），左右边缘可平滑环绕拼接，保持原场景的风格、光线与氛围，适合作为环境背景球贴图'

export function DirectorStage({ initialState, onClose, onSendShot, onExportPreviz, onPersistState, onGenerateRoutes, onGenerateBlocking, initialBlockingDescription = '', castLabels = [], saving, uploadImage, generateImage, upstreamImages = [], importBackground }: DirectorStageProps) {
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

  const enterCameraView = useCallback((cameraId: string) => {
    setSelectedId(camKey(cameraId))
    setView('shot')
  }, [])

  const selectSceneObject = useCallback((selectionKey: string) => {
    setSelectedId(selectionKey)
    setView('director')
  }, [])

  // ---- previz (镜头预演) ----
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [showCameraPath, setShowCameraPath] = useState(true)
  const [showActorPaths, setShowActorPaths] = useState(true)
  const [exportAspect, setExportAspect] = useState<'9:16' | '16:9'>('9:16')
  const [downloadAfterExport, setDownloadAfterExport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [routesOpen, setRoutesOpen] = useState(false)
  const [blockingOpen, setBlockingOpen] = useState(Boolean(initialBlockingDescription))
  const [blockingUndoState, setBlockingUndoState] = useState<DirectorStageState | null>(null)
  const selectedShotIndex = state.shots.findIndex((s) => s.id === selectedShotId)
  const selectedShot = selectedShotIndex >= 0 ? state.shots[selectedShotIndex] : null
  const playback = usePrevizPlayback(state.shots, selectedShotIndex)

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
  const addProp = useCallback((kind: PropKind) => {
    const nid = uid()
    setState((s) => ({ ...s, props: [...s.props, makeProp(nid, s.props.length, kind)] }))
    setSelectedId(nid)
    setAddMenu(false)
  }, [])
  const commitProp = useCallback((id: string, patch: Partial<StageProp>) => {
    setState((s) => ({ ...s, props: s.props.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
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
    if (selectedId.startsWith('wp:')) return // waypoint 删除走镜头检查器的清空
    if (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) {
      const cid = selectedId.slice(4)
      setState((s) => (s.cameras.length <= 1 ? s : { ...s, cameras: s.cameras.filter((c) => c.id !== cid) }))
    } else {
      setState((s) => ({
        ...s,
        mannequins: s.mannequins.filter((m) => m.id !== selectedId),
        props: s.props.filter((p) => p.id !== selectedId),
        // drop any camera's follow binding to the deleted scene object
        cameras: s.cameras.map((c) => (c.lookAtObjectId === selectedId ? { ...c, lookAtObjectId: null } : c)),
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

  // ---- previz handlers ----

  /** 当前「摄影机视角」：优先选中的机位（含荷兰角），否则实时 orbit 视角。 */
  const currentCameraPose = useCallback((): ShotKeyframe['camera'] | null => {
    const camId = selectedCamIdFromSel(selectedId)
    const cam = camId ? state.cameras.find((c) => c.id === camId) : null
    if (cam) return { position: [...cam.position], target: effectiveTarget(cam, state.mannequins, state.props), fov: cam.fov, ...(cam.roll ? { roll: cam.roll } : {}) }
    const live = getViewRef.current?.()
    if (!live) return null
    return { position: live.position, target: live.target, fov: live.fov }
  }, [selectedId, state.cameras, state.mannequins, state.props])

  const currentActorPlacements = useCallback((): ShotKeyframe['actors'] => {
    return Object.fromEntries(
      [...state.mannequins, ...state.props].map((a) => [a.id, { position: [...a.position] as Vec3, rotation: [...a.rotation] as Vec3 }]),
    )
  }, [state.mannequins, state.props])

  const addShot = useCallback(() => {
    const camera = currentCameraPose()
    if (!camera) { setToast('视角未就绪，请稍候'); return }
    const remaining = MAX_SCENE_SEC - totalDurationSec(state.shots)
    if (remaining < SHOT_MIN_SEC) { setToast(`全片已满 ${MAX_SCENE_SEC} 秒（R2V 参考视频上限）`); return }
    const shot = makeShot(uid(), state.shots.length, camera, currentActorPlacements())
    const next = clampShots([...state.shots, shot])
    setState((s) => ({ ...s, shots: next }))
    setSelectedShotId(shot.id)
    setSelectedId(null) // 清掉场景对象选中——否则对象检查器压住镜头检查器（smoke 发现）
  }, [currentCameraPose, currentActorPlacements, state.shots])

  /** 时间轴选镜头：同时取消场景对象选中，让镜头检查器出得来。 */
  const selectShot = useCallback((id: string | null) => {
    setSelectedShotId(id)
    if (id) setSelectedId(null)
  }, [])

  const patchShot = useCallback((id: string, patch: Partial<StageShot>) => {
    setState((s) => ({ ...s, shots: clampShots(s.shots.map((x) => (x.id === id ? { ...x, ...patch } : x))) }))
  }, [])

  const applyShotCameraMove = useCallback((key: CameraMoveKey) => {
    if (!selectedShot) return
    const activeCamera = state.cameras.find((camera) => camera.id === activeShotCamId)
    const next = applyCameraMovePreset(selectedShot, key, activeCamera?.lookAtObjectId)
    if (!next) {
      setToast('跟拍需要先在摄像机面板锁定人物或道具，并设置其起幅与落幅位置')
      return
    }
    patchShot(selectedShot.id, next)
    const label = CAMERA_MOVE_PRESETS.find((preset) => preset.key === key)?.label
    if (!label) throw new Error(`未知运镜预设：${key}`)
    setToast(`✓ 已套用${label}运镜，可继续拖动关键点微调`)
  }, [activeShotCamId, patchShot, selectedShot, state.cameras])

  const deleteShot = useCallback((id: string) => {
    setState((s) => ({ ...s, shots: s.shots.filter((x) => x.id !== id) }))
    setSelectedShotId((cur) => (cur === id ? null : cur))
  }, [])

  const setShotCamera = useCallback((end: 'start' | 'end') => {
    if (!selectedShot) return
    const camera = currentCameraPose()
    if (!camera) { setToast('视角未就绪，请稍候'); return }
    patchShot(selectedShot.id, { [end]: { ...selectedShot[end], camera } } as Partial<StageShot>)
    setToast(`✓ 摄影机已设为${end === 'start' ? '起幅' : '落幅'}`)
  }, [selectedShot, currentCameraPose, patchShot])

  const setShotActors = useCallback((end: 'start' | 'end') => {
    if (!selectedShot) return
    patchShot(selectedShot.id, { [end]: { ...selectedShot[end], actors: currentActorPlacements() } } as Partial<StageShot>)
    setToast(`✓ 全体摆位已设为${end === 'start' ? '起幅' : '落幅'}`)
  }, [selectedShot, currentActorPlacements, patchShot])

  const jumpToShotEnd = useCallback((end: 'start' | 'end') => {
    if (selectedShotIndex < 0) return
    let acc = 0
    for (let i = 0; i < selectedShotIndex; i++) acc += state.shots[i].durationSec
    playback.enter('shot')
    playback.seek(end === 'start' ? acc : acc + state.shots[selectedShotIndex].durationSec)
  }, [selectedShotIndex, state.shots, playback])

  const addCameraWaypoint = useCallback(() => {
    if (!selectedShot) return
    const camera = currentCameraPose()
    if (!camera) { setToast('视角未就绪，请稍候'); return }
    patchShot(selectedShot.id, { cameraWaypoints: [...(selectedShot.cameraWaypoints ?? []), camera.position] })
    setToast('✓ 已加运镜关键点')
  }, [selectedShot, currentCameraPose, patchShot])

  /** 在 actor 起幅→落幅中点上方加一个调度点（拖动小球细调）。 */
  const addActorWaypoint = useCallback((actorId: string) => {
    if (!selectedShot) return
    const a = selectedShot.start.actors[actorId]
    const b = selectedShot.end.actors[actorId]
    if (!a || !b) { setToast('该对象缺起幅或落幅摆位，先「摆位设为起幅/落幅」'); return }
    const existing = selectedShot.movePaths?.[actorId] ?? []
    const mid: Vec3 = [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2, (a.position[2] + b.position[2]) / 2 + 0.8]
    patchShot(selectedShot.id, { movePaths: { ...(selectedShot.movePaths ?? {}), [actorId]: [...existing, mid] } })
    setToast('✓ 已加调度点（拖动橙色小球调整）')
  }, [selectedShot, patchShot])

  const clearActorWaypoints = useCallback((actorId: string) => {
    if (!selectedShot?.movePaths?.[actorId]) return
    const next = { ...selectedShot.movePaths }
    delete next[actorId]
    patchShot(selectedShot.id, { movePaths: Object.keys(next).length > 0 ? next : undefined })
  }, [selectedShot, patchShot])

  /**
   * waypoint 小球拖动 commit（来自 SceneContents 的 TransformControls）。
   * 调度点 mesh 是抬高 ACTOR_PATH_LIFT_Y 渲染的，存回去要减掉，否则每次
   * 拖动 Y 累积漂移。
   */
  const commitWaypoint = useCallback((desc: { kind: 'cam'; index: number } | { kind: 'act'; actorId: string; index: number }, rawPosition: Vec3) => {
    if (!selectedShot) return
    const position: Vec3 = desc.kind === 'act' ? [rawPosition[0], rawPosition[1] - ACTOR_PATH_LIFT_Y, rawPosition[2]] : rawPosition
    if (desc.kind === 'cam') {
      const wps = [...(selectedShot.cameraWaypoints ?? [])]
      if (desc.index < 0 || desc.index >= wps.length) return
      wps[desc.index] = position
      patchShot(selectedShot.id, { cameraWaypoints: wps })
    } else {
      const list = [...(selectedShot.movePaths?.[desc.actorId] ?? [])]
      if (desc.index < 0 || desc.index >= list.length) return
      list[desc.index] = position
      patchShot(selectedShot.id, { movePaths: { ...(selectedShot.movePaths ?? {}), [desc.actorId]: list } })
    }
  }, [selectedShot, patchShot])

  /** 应用 AI 导演路线方案 → 物化成镜头序列（覆盖已有序列前确认）。 */
  const applyRoutePlan = useCallback((plan: DirectorRoutePlan, segment: DirectorRouteSegment, keepPanelOpen: boolean) => {
    if (state.shots.length > 0 && !window.confirm(`应用「${plan.name}」将替换现有 ${state.shots.length} 个镜头，确定？`)) return
    const shots = materializeRoutePlan(plan, state.mannequins, state.props)
    if (shots.length === 0) { setToast('方案没有可用镜头'); return }
    setState((s) => ({ ...s, shots }))
    setSelectedShotId(shots[0].id)
    playback.exit()
    if (!keepPanelOpen) setRoutesOpen(false)
    setToast(`✓ 已套用「${segment.title} / ${plan.name}」：${shots.length} 个镜头，可逐镜微调起幅/落幅`)
  }, [state.shots.length, state.mannequins, state.props, playback])

  const applyBlockingDraft = useCallback((draft: DirectorBlockingDraft) => {
    const affected = state.mannequins.length + state.props.length + state.cameras.length + state.shots.length
    if (affected > 1 && !window.confirm('套用 AI 排戏会替换当前人物、道具与机位，并清空旧镜头时间轴。确定继续？')) return
    const previous = structuredClone(state)
    const next = materializeDirectorBlocking(draft, state, (kind, index) => `${kind}_${index}_${uid()}`)
    setBlockingUndoState(previous)
    setState(next)
    setSelectedId(camKey(next.cameras[0].id))
    setSelectedShotId(null)
    setHiddenIds({})
    setLockedIds({})
    playback.exit()
    setView('director')
    setBlockingOpen(false)
    setToast(`✓ 已套用「${draft.title}」，已选中 ${draft.camera.focalLengthMm}mm 生成机位，可自由调整；需要时再进入机位视角检查构图`)
  }, [state, playback])

  const undoBlocking = useCallback(() => {
    if (!blockingUndoState) return
    setState(blockingUndoState)
    setBlockingUndoState(null)
    setSelectedId(null)
    setSelectedShotId(null)
    setHiddenIds({})
    setLockedIds({})
    playback.exit()
    setView('director')
    setToast('✓ 已复原 AI 排戏前的舞台')
  }, [blockingUndoState, playback])

  /** 导出预演：锁 1x 实时播放 + 录制画布 → 交给 onExportPreviz 上传转码。 */
  const exportPreviz = useCallback(async (scope: 'shot' | 'scene') => {
    if (!onExportPreviz) { setToast('导出未就绪'); return }
    if (exporting) return
    if (state.shots.length === 0) { setToast('先建至少一个镜头（时间轴「+」）'); return }
    if (scope === 'shot' && selectedShotIndex < 0) { setToast('先在时间轴选中要导出的镜头'); return }
    const canvasEl = rootRef.current?.querySelector('canvas')
    if (!(canvasEl instanceof HTMLCanvasElement)) { setToast('画布未就绪'); return }

    // 导出区间（全片时间轴上的秒）
    let rangeStart = 0
    let rangeEnd = totalDurationSec(state.shots)
    if (scope === 'shot') {
      rangeStart = state.shots.slice(0, selectedShotIndex).reduce((s, x) => s + x.durationSec, 0)
      rangeEnd = rangeStart + state.shots[selectedShotIndex].durationSec
    }
    const durationSec = rangeEnd - rangeStart
    const title = scope === 'shot' ? `预演·${state.shots[selectedShotIndex].label}` : '预演·完整一幕'

    setExporting(true)
    try {
      playback.setRate(1) // 录制是实时的，非 1x 会导致片长错位
      playback.enter(scope === 'shot' ? 'shot' : 'scene')
      const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
      await nextFrame(); await nextFrame() // 让 range 状态提交，seek 才不会被旧区间钳制
      playback.seek(rangeStart)
      setRecording(true)
      await nextFrame(); await nextFrame() // helpers 隐藏 + 首帧就位
      setToast(`录制中…（${durationSec.toFixed(1)}s 实时预演）`)
      const clip = await recordPrevizClip({
        canvas: canvasEl,
        start: playback.toggle,
        isDone: () => playback.getTimeSec() >= rangeEnd - 0.02,
        maxMs: (durationSec + 5) * 1000,
      })
      setRecording(false)
      playback.exit()
      setToast('转码上传中…')
      const actorLabels = Object.fromEntries([...state.mannequins, ...state.props].map((a) => [a.id, a.label]))
      const { videoUrl } = await onExportPreviz({
        blob: clip.blob,
        mimeType: clip.mimeType,
        aspect: exportAspect,
        durationSec,
        crop: computeExportCrop(canvasEl.width, canvasEl.height, exportAspect),
        scope,
        title,
        directorText: buildPrevizDirectorText(state.shots, actorLabels, scope === 'shot' ? { shotId: state.shots[selectedShotIndex].id } : {}),
        shotIds: scope === 'shot' ? [state.shots[selectedShotIndex].id] : state.shots.map((shot) => shot.id),
        state,
      })
      setToast('✓ 预演已导出：视频节点已带参考视频生成（关闭导演台可见）')
      if (downloadAfterExport && videoUrl) window.open(videoUrl, '_blank', 'noopener')
    } catch (e) {
      setToast(`导出失败：${(e as Error)?.message ?? '未知错误'}`)
    } finally {
      setRecording(false)
      setExporting(false)
    }
  }, [onExportPreviz, exporting, state, selectedShotIndex, playback, exportAspect, downloadAfterExport])

  const sendShot = useCallback(async (cameraId: string) => {
    const cam = state.cameras.find((c) => c.id === cameraId)
    if (!cam) return
    if (state.mannequins.length === 0) { setToast('先加至少一个人偶再发送'); return }
    const url = captureRef.current?.(cameraId)
    if (!url) { setToast('截图失败，请重试'); return }
    try {
      setToast(`发送中… ${cam.label}`)
      await onSendShot(url, cam, state)
      setSentTotal((n) => n + 1)
      setToast(`✓ ${cam.label} 已发送到画布（关闭导演台后可见）`)
    } catch (e) {
      setToast(`发送失败：${(e as Error)?.message ?? '未知错误'}`)
    }
  }, [onSendShot, state])

  const selectedMannequin = state.mannequins.find((m) => m.id === selectedId) ?? null
  const selectedProp = state.props.find((p) => p.id === selectedId) ?? null
  const selectedCamId = selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) ? selectedId.slice(4) : null
  const selectedCamera = selectedCamId ? state.cameras.find((c) => c.id === selectedCamId) ?? null : null
  const activeTrackingTargetId = state.cameras.find((camera) => camera.id === activeShotCamId)?.lookAtObjectId
  const activeTrackingTargetLabel = [...state.mannequins, ...state.props].find((item) => item.id === activeTrackingTargetId)?.label ?? null

  const applyCameraPreset = useCallback((camId: string, preset: typeof CAMERA_PRESETS[number]) => {
    // 当前视角 needs the live view; bail if not registered yet (avoids a
    // self-referential degenerate camera at the focus point).
    const liveView = preset.current ? getViewRef.current?.() ?? null : null
    if (preset.current && !liveView) { setToast('视角未就绪，请稍候'); return }
    setState((s) => {
      const cam = s.cameras.find((c) => c.id === camId)
      const focusId = cam?.lookAtObjectId ?? null
      const shot = computePreset(preset, focusPoint(s.mannequins, s.props, focusId), facingOf(s.mannequins, s.props, focusId), liveView)
      // A preset sets an explicit position+target, so clear follow — otherwise
      // effectiveTarget would override the preset's framing.
      return { ...s, cameras: s.cameras.map((c) => (c.id === camId ? { ...c, position: shot.position, target: shot.target, fov: shot.fov, roll: shot.roll, lookAtObjectId: null } : c)) }
    })
  }, [])
  const applyCameraFraming = useCallback((camId: string, distance: number, fov: number) => {
    setState((s) => ({
      ...s,
      cameras: s.cameras.map((camera) => {
        if (camera.id !== camId) return camera
        const target = effectiveTarget(camera, s.mannequins, s.props)
        return { ...camera, position: frameCameraAtDistance(camera.position, target, distance), target, fov }
      }),
    }))
  }, [])
  const setAspect = useCallback((a: StageAspect) => setState((s) => ({ ...s, aspect: a })), [])

  const setBackground = useCallback((patch: Partial<StageBackground>) => {
    setState((s) => ({ ...s, background: { ...DEFAULT_BACKGROUND, ...s.background, ...patch } }))
  }, [])
  const bgInputRef = useRef<HTMLInputElement>(null)
  const onPickBackground = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!uploadImage) { setToast('上传未就绪'); return }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setToast('请上传 jpg/png/webp 图片'); return }
    if (file.size > 20 * 1024 * 1024) { setToast('图片过大（上限 20MB）'); return }
    try {
      setToast('上传场景图中…')
      const { key, url } = await uploadImage(file)
      // default to 全景球 if the image looks panoramic (w≈2h), else 平面背景
      setState((s) => {
        const prevMode = s.background?.mode
        const mode = prevMode && prevMode !== 'none' ? prevMode : 'flat'
        return { ...s, background: { ...DEFAULT_BACKGROUND, ...s.background, mode, key, url } }
      })
      setToast('✓ 场景背景已设置')
    } catch (err) {
      setToast(`上传失败：${(err as Error)?.message ?? '未知错误'}`)
    }
  }, [uploadImage])

  const bg = state.background ?? DEFAULT_BACKGROUND
  const onBgError = useCallback(() => setToast('背景图加载失败（链接可能已过期，请重新上传）'), [])
  const [panoBusy, setPanoBusy] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  const importFromUpstream = useCallback(async (runId: string) => {
    if (panoBusy || !importBackground) return
    setPanoBusy(true)
    setToast('导入全景中…')
    try {
      const { key, url } = await importBackground(runId)
      if (!mountedRef.current) return
      setBackground({ mode: 'sphere', key, url })
      setToast('✓ 已设为全景球背景')
    } catch (e) {
      if (mountedRef.current) setToast(`导入失败：${(e as Error)?.message ?? '未知错误'}`)
    } finally {
      if (mountedRef.current) setPanoBusy(false)
    }
  }, [panoBusy, importBackground, setBackground])
  const convertToPanorama = useCallback(async () => {
    if (panoBusy) return // guard both entry points (panel + dock) → no double-bill
    if (!generateImage) { setToast('生成未就绪'); return }
    if (!bg.key) { setToast('请先上传场景图，再 AI 转全景'); return }
    setPanoBusy(true)
    setToast('AI 识图转全景中…（约 1 分钟，消耗点数）')
    try {
      const { url } = await generateImage({ prompt: PANORAMA_PROMPT, refKey: bg.key, aspectRatio: '2:1' })
      // Re-upload the result to a durable key so the panorama survives reload /
      // signed-URL expiry (the run result URL alone is ephemeral).
      let durable: { key: string | null; url: string } = { key: null, url }
      if (uploadImage) {
        try {
          const blob = await (await fetch(url)).blob()
          const up = await uploadImage(new File([blob], `panorama-${Date.now()}.png`, { type: blob.type || 'image/png' }))
          durable = { key: up.key, url: up.url }
        } catch { /* keep ephemeral url if re-upload fails */ }
      }
      if (!mountedRef.current) return // stage closed mid-generation
      setBackground({ mode: 'sphere', url: durable.url, key: durable.key })
      setToast('✓ 已生成 360° 全景背景')
    } catch (e) {
      if (mountedRef.current) setToast(`转全景失败：${(e as Error)?.message ?? '未知错误'}`)
    } finally {
      if (mountedRef.current) setPanoBusy(false)
    }
  }, [panoBusy, generateImage, uploadImage, bg.key, setBackground])

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
          previz={{ active: playback.active, getTimeSec: playback.getTimeSec, selectedShot, showCameraPath, showActorPaths, recording }}
          onSelect={setSelectedId}
          onEnterCameraView={enterCameraView}
          onCommitMannequin={commitMannequin}
          onCommitCamera={commitCamera}
          onCommitProp={commitProp}
          onCommitWaypoint={commitWaypoint}
          registerCapture={(fn) => { captureRef.current = fn }}
          registerGetView={(fn) => { getViewRef.current = fn }}
          registerReset={(fn) => { resetViewRef.current = fn }}
          onBgError={onBgError}
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
        <button type="button" onClick={() => { onPersistState?.(state); onClose() }} className={btn} style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕</button>
      </div>

      {/* Left 场景 panel — scene tree (cameras + mannequins) with hide/lock/select */}
      <div className="absolute left-0 top-12 bottom-0 flex w-56 flex-col" style={{ background: `${CANVAS_TOKENS.bg.panel}f2`, borderRight: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <div className="px-3 py-2 font-mono text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>场景</div>
        <div className="px-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索对象" className="w-full rounded-md px-2 py-1.5 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {[
            ...state.cameras.map((c) => ({ id: c.id, key: camKey(c.id), label: c.label, glyph: '▣', accent: CANVAS_TOKENS.accent, camera: true })),
            ...state.mannequins.map((m) => ({ id: m.id, key: m.id, label: m.label, glyph: '人', accent: m.color, camera: false })),
            ...state.props.map((p) => ({ id: p.id, key: p.id, label: p.label, glyph: '◫', accent: p.color, camera: false })),
          ]
            .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))
            .map((o) => {
              const sel = selectedId === o.key || selectedId === tgtKey(o.id)
              return (
                <div key={o.key} className="group flex items-center gap-1 rounded-md px-1.5 py-1" style={{ background: sel ? CANVAS_TOKENS.bg.hover : 'transparent' }}>
                  <button type="button" onClick={() => selectSceneObject(o.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]" style={{ color: sel ? o.accent : CANVAS_TOKENS.text.primary, opacity: hiddenIds[o.id] ? 0.4 : 1 }}>
                    <span style={{ color: o.accent }}>{o.glyph}</span>
                    <span className="truncate">{o.label}</span>
                  </button>
                  {o.camera ? <button type="button" title="进入机位视角" onClick={() => enterCameraView(o.id)} className="px-1 text-[11px]" style={{ color: CANVAS_TOKENS.accent }}>◎</button> : null}
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

      {/* previz 镜头检查器 — 选中镜头且没选中场景对象时显示 */}
      {selectedShot && !selectedMannequin && !selectedCamera && !selectedProp ? (
        <PrevizShotPanel
          shot={selectedShot}
          shots={state.shots}
          actorInfos={[...state.mannequins, ...state.props].map((a) => ({ id: a.id, label: a.label }))}
          onPatch={patchShot}
          onDelete={deleteShot}
          onSetCamera={setShotCamera}
          onSetActors={setShotActors}
          onJump={jumpToShotEnd}
          onAddCameraWaypoint={addCameraWaypoint}
          onAddActorWaypoint={addActorWaypoint}
          onClearActorWaypoints={clearActorWaypoints}
          onApplyCameraMove={applyShotCameraMove}
          trackingTargetLabel={activeTrackingTargetLabel}
        />
      ) : null}

      {/* 道具检查器 */}
      {selectedProp ? <PropPanel prop={selectedProp} mode={mode} onMode={setMode} onPatch={commitProp} /> : null}

      {/* Rig panel — pose presets + per-joint sliders, shown on mannequin select */}
      {selectedMannequin ? (
        <RigPanel mannequin={selectedMannequin} mode={mode} onMode={setMode} onCommit={commitMannequin} onApplyPose={applyPose} onSetJointAxis={setJointAxis} />
      ) : null}

      {/* Camera inspector — shown when a camera/target is selected */}
      {selectedCamera && selectedCamId ? (
        <CameraPanel
          camera={selectedCamera}
          cameraId={selectedCamId}
          cameras={state.cameras}
          mannequins={state.mannequins}
          props={state.props}
          saving={saving}
          onCommit={commitCamera}
          onSwitch={(cid) => setSelectedId(camKey(cid))}
          onView={enterCameraView}
          onSend={sendShot}
          onApplyPreset={applyCameraPreset}
          onApplyFraming={applyCameraFraming}
        />
      ) : null}

      {/* 3D场景 props — shown when nothing is selected */}
      {!selectedMannequin && !selectedCamera && !selectedShot && !selectedProp ? (
        <div className="absolute right-4 top-16 bottom-16 w-60 overflow-y-auto rounded-xl p-3" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
          <div className="mb-2 font-mono text-[12px]" style={{ color: CANVAS_TOKENS.text.primary }}>3D场景</div>
          {([['角色标签', showLabels, setShowLabels], ['网格', showGrid, setShowGrid], ['地面', showGround, setShowGround], ['运镜线', showCameraPath, setShowCameraPath], ['调度线', showActorPaths, setShowActorPaths]] as const).map(([label, val, set]) => (
            <button key={label} type="button" onClick={() => set(!val)} className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[12px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>
              <span>{label}</span>
              <span style={{ color: val ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.muted }}>{val ? '● 开' : '○ 关'}</span>
            </button>
          ))}

          {/* 全景背景 */}
          <div className="mt-3 mb-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>全景背景</div>
          {bg.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bg.url} alt="背景" className="mb-2 h-20 w-full rounded-md object-cover" style={{ border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
          ) : null}
          <div className="mb-2 flex gap-1">
            <button type="button" onClick={() => bgInputRef.current?.click()} className="flex-1 rounded-md py-1.5 text-[11px]" style={{ background: CANVAS_TOKENS.accent, color: CANVAS_TOKENS.accentText }}>{bg.url ? '换图' : '上传场景图'}</button>
            {bg.url ? <button type="button" onClick={() => setBackground({ mode: 'none', key: null, url: null })} className="rounded-md px-2 py-1.5 text-[11px]" style={{ background: CANVAS_TOKENS.bg.hover, color: '#FF8A8A' }}>移除</button> : null}
          </div>
          {bg.url ? (
            <div className="mb-2 flex gap-1">
              {(['flat', 'sphere'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setBackground({ mode: m })} className="flex-1 rounded-md py-1 text-[11px]" style={{ background: bg.mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover, color: bg.mode === m ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.secondary }}>
                  {m === 'flat' ? '平面背景' : '全景球'}
                </button>
              ))}
            </div>
          ) : null}
          {bg.url && bg.mode === 'sphere' ? <SliderRow label="水平旋转" value={bg.rotationDeg ?? 0} min={0} max={360} unit="°" onChange={(v) => setBackground({ rotationDeg: v })} /> : null}
          {bg.url && bg.mode === 'sphere' ? <SliderRow label="球形半径" value={bg.radius ?? 60} min={8} max={120} unit="" onChange={(v) => setBackground({ radius: v })} /> : null}
          <label className="mt-1 flex items-center justify-between text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
            <span>天空颜色</span>
            <input type="color" value={bg.skyColor ?? '#0A0A0B'} onChange={(e) => setBackground({ skyColor: e.target.value })} className="h-6 w-10 rounded" />
          </label>

          {bg.key ? (
            <button type="button" onClick={convertToPanorama} disabled={panoBusy} className="mt-2 w-full rounded-md py-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.accent, border: `1px solid ${CANVAS_TOKENS.accent}55` }}>
              {panoBusy ? 'AI 转全景中…' : '✨ AI 识图转 360 全景'}
            </button>
          ) : null}

          {/* import a connected 720全景图 image node as the 全景球 background */}
          {upstreamImages.length > 0 ? (
            <div className="mt-2">
              <div className="mb-1 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>从上游图片导入全景</div>
              <div className="space-y-1">
                {upstreamImages.map((u) => (
                  <button key={u.runId} type="button" onClick={() => importFromUpstream(u.runId)} disabled={panoBusy} className="flex w-full items-center gap-2 rounded-md p-1 text-left text-[12px] disabled:opacity-50" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.url} alt={u.label} className="h-8 w-12 shrink-0 rounded object-cover" />
                    <span className="truncate">{u.label} → 全景球</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-2 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>上传平面场景图 → AI 转全景球，人物即站在场景中</div>
        </div>
      ) : null}

      <input ref={bgInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickBackground} />

      {/* AI 导演路线方案面板 */}
      {routesOpen && onGenerateRoutes ? (
        <RoutePlansPanel
          onClose={() => setRoutesOpen(false)}
          castLabels={state.mannequins.map((m) => m.label)}
          onGenerate={(description, inputMode) => onGenerateRoutes(description, inputMode, state.mannequins.map((m) => m.label), state.props.map((p) => p.label))}
          onApply={applyRoutePlan}
        />
      ) : null}

      {blockingOpen && onGenerateBlocking ? (
        <BlockingPanel initialDescription={initialBlockingDescription} onClose={() => setBlockingOpen(false)} onGenerate={onGenerateBlocking} onApply={applyBlockingDraft} />
      ) : null}

      {/* previz 时间轴 — 有镜头或选中镜头时常驻；空序列只显示「+」入口 */}
      <PrevizTimeline
        shots={state.shots}
        selectedShotId={selectedShotId}
        playback={playback}
        onSelectShot={selectShot}
        onAddShot={addShot}
        onToggleRoutes={onGenerateRoutes ? () => setRoutesOpen((v) => !v) : undefined}
        routesOpen={routesOpen}
        exporting={exporting}
        exportAspect={exportAspect}
        onExportAspect={setExportAspect}
        onExport={onExportPreviz ? exportPreviz : undefined}
        downloadAfterExport={downloadAfterExport}
        onDownloadAfterExport={setDownloadAfterExport}
      />

      {/* close dock dropdowns on outside click */}
      {addMenu || aspectMenu ? <div className="absolute inset-0 z-[9]" onClick={() => { setAddMenu(false); setAspectMenu(false) }} /> : null}

      {/* Bottom dock — all tools (LibTV layout) */}
      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl px-2 py-1.5" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
        <DockBtn label="选择" active={!selectedId} onClick={() => setSelectedId(null)}><Glyph name="pointer" /></DockBtn>
        <div className="relative">
          <DockBtn label="添加角色" active={addMenu} onClick={() => { setAddMenu((v) => !v); setAspectMenu(false) }}><Glyph name="person" /></DockBtn>
          {addMenu ? (
            <div className="absolute bottom-12 left-0 max-h-80 w-40 overflow-y-auto rounded-xl" style={{ background: CANVAS_TOKENS.bg.popover, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
              {BODY_TYPES.map((b) => (
                <button key={b.key} type="button" onClick={() => addMannequin(b.key)} className="block w-full px-3 py-2 text-left text-[12px] hover:bg-white/5" style={{ color: CANVAS_TOKENS.text.primary }}>{b.label}</button>
              ))}
              <div className="px-3 py-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted, borderTop: `1px solid ${CANVAS_TOKENS.hairline}` }}>道具</div>
              {PROP_KINDS.map((k) => (
                <button key={k.key} type="button" onClick={() => { addProp(k.key); setAddMenu(false) }} className="block w-full px-3 py-2 text-left text-[12px] hover:bg-white/5" style={{ color: CANVAS_TOKENS.text.primary }}>{k.label}</button>
              ))}
            </div>
          ) : null}
        </div>
        <DockBtn label="场景背景（上传场景图）" onClick={() => bgInputRef.current?.click()}><Glyph name="panorama" /></DockBtn>
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
        <DockBtn label="AI识图导入（上传场景图 → 转全景）" onClick={() => (bg.key ? convertToPanorama() : bgInputRef.current?.click())}><Glyph name="aiimport" /></DockBtn>
        {onGenerateBlocking ? <DockBtn label="AI 排戏（描述生成角色、遮挡与机位）" active={blockingOpen} onClick={() => { setBlockingOpen((value) => !value); setRoutesOpen(false) }}><Glyph name="blocking" /></DockBtn> : null}
        {blockingUndoState ? <button type="button" onClick={undoBlocking} className="rounded-md px-2 py-1 font-mono text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: '#F4C44E', border: `1px solid #F4C44E55` }}>撤销 AI 排戏</button> : null}
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
