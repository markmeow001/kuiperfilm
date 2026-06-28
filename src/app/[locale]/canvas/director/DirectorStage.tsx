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
import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { Mannequin } from './Mannequin'
import { SliderRow } from './SliderRow'
import { Vec3Field } from './Vec3Field'
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint, type Pose } from './pose-presets'
import { CAMERA_PRESETS, aspectRatio, computePreset } from './camera-presets'
import {
  type DirectorStageState,
  type StageAspect,
  type StageCamera,
  type StageMannequin,
  type TransformMode,
  type Vec3,
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

interface SceneProps {
  state: DirectorStageState
  selectedId: string | null
  mode: TransformMode
  onSelect: (id: string | null) => void
  onCommitMannequin: (id: string, patch: Partial<StageMannequin>) => void
  onCommitCamera: (id: string, patch: Partial<StageCamera>) => void
  registerCapture: (fn: (cameraId: string) => string | null) => void
  registerGetView: (fn: () => { position: Vec3; target: Vec3; fov: number }) => void
}

function SceneContents({ state, selectedId, mode, onSelect, onCommitMannequin, onCommitCamera, registerCapture, registerGetView }: SceneProps) {
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

  useEffect(() => {
    registerCapture(capture)
    registerGetView(getView)
    return () => { registerCapture(() => null) }
  }, [registerCapture, registerGetView, capture, getView])

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

  useEffect(() => {
    if (!selectedObject && orbitRef.current) orbitRef.current.enabled = true
  }, [selectedObject])

  const isCamOrTarget = Boolean(selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')))

  return (
    <>
      <color attach="background" args={[CANVAS_TOKENS.bg.canvas]} />
      <hemisphereLight args={['#ffffff', '#2a2a30', 0.85]} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#15151a" roughness={1} />
      </mesh>

      {/* Helpers — hidden during capture */}
      <group ref={helpersRef}>
        <Grid args={[40, 40]} cellSize={0.5} cellColor="#2a2a32" sectionSize={2} sectionColor="#3a3a46" fadeDistance={28} infiniteGrid position={[0, 0.001, 0]} />
        {state.cameras.map((cam) => (
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
            {/* manual look-at gizmo — hidden when following a character */}
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

      {/* Mannequins — wrapping group owns transform + selection */}
      {state.mannequins.map((m) => (
        <group
          key={m.id}
          ref={(el) => { if (el) mannequinRefs.current[m.id] = el; else delete mannequinRefs.current[m.id] }}
          position={m.position}
          rotation={m.rotation}
          scale={m.scale}
          onClick={(e) => { e.stopPropagation(); onSelect(m.id) }}
        >
          <Mannequin data={m} selected={selectedId === m.id} />
        </group>
      ))}

      {selectedObject ? (
        <TransformControls
          ref={transformRef}
          object={selectedObject}
          mode={isCamOrTarget ? 'translate' : mode}
          onObjectChange={commitSelected}
          // Disable orbit while dragging the gizmo (drei doesn't auto-toggle a
          // makeDefault OrbitControls); the effect below re-enables it if the
          // gizmo unmounts mid-drag so orbit can never get stuck off.
          onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false }}
          onMouseUp={() => { if (orbitRef.current) orbitRef.current.enabled = true }}
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
  const captureRef = useRef<((cameraId: string) => string | null) | null>(null)
  const getViewRef = useRef<(() => { position: Vec3; target: Vec3; fov: number }) | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [rootSize, setRootSize] = useState({ w: 0, h: 0 })

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

  const addMannequin = useCallback(() => setState((s) => ({ ...s, mannequins: [...s.mannequins, makeMannequin(uid(), s.mannequins.length)] })), [])
  const addCamera = useCallback(() => setState((s) => ({ ...s, cameras: [...s.cameras, makeCamera(uid(), s.cameras.length)] })), [])

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
    const view = preset.current ? getViewRef.current?.() ?? null : null
    if (preset.current && !view) { setToast('视角未就绪，请稍候'); return }
    setState((s) => {
      const cam = s.cameras.find((c) => c.id === camId)
      const focusId = cam?.lookAtMannequinId ?? null
      const shot = computePreset(preset, focusPoint(s.mannequins, focusId), facingOf(s.mannequins, focusId), view)
      // A preset sets an explicit position+target, so clear follow — otherwise
      // effectiveTarget would override the preset's framing.
      return { ...s, cameras: s.cameras.map((c) => (c.id === camId ? { ...c, position: shot.position, target: shot.target, fov: shot.fov, roll: shot.roll, lookAtMannequinId: null } : c)) }
    })
  }, [])
  const setAspect = useCallback((a: StageAspect) => setState((s) => ({ ...s, aspect: a })), [])

  const btn = 'rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors'
  const isMannequinSelected = Boolean(selectedMannequin)

  return (
    <div ref={rootRef} className="fixed inset-0 z-50" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <Canvas shadows gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [3.5, 2.6, 5.5], fov: 45 }} onPointerMissed={() => setSelectedId(null)}>
        <SceneContents
          state={state}
          selectedId={selectedId}
          mode={mode}
          onSelect={setSelectedId}
          onCommitMannequin={commitMannequin}
          onCommitCamera={commitCamera}
          registerCapture={(fn) => { captureRef.current = fn }}
          registerGetView={(fn) => { getViewRef.current = fn }}
        />
      </Canvas>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex h-12 items-center justify-between px-4" style={{ background: `${CANVAS_TOKENS.bg.panel}cc`, borderBottom: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2 font-mono text-[13px]">
          <span style={{ color: CANVAS_TOKENS.accent }}>◐</span>
          <span style={{ color: CANVAS_TOKENS.text.primary }}>导演台</span>
          <span className="text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>· 持久场景 · 每个机位 = 一帧（共用站位）</span>
          {castLabels.length > 0 ? (
            <span className="ml-2 rounded px-2 py-0.5 text-[10px]" style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>
              卡司：{castLabels.join('、')}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
            <span>画幅</span>
            <select
              value={state.aspect ?? 'auto'}
              onChange={(e) => setAspect(e.target.value as StageAspect)}
              className="rounded px-1.5 py-1 text-[11px] outline-none"
              style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
            >
              {STAGE_ASPECTS.map((a) => <option key={a} value={a}>{a === 'auto' ? '自适应' : a}</option>)}
            </select>
          </label>
          <button type="button" onClick={onClose} className={btn} style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕ 关闭</button>
        </div>
      </div>

      {/* Framing overlay — exactly the centered max-fit crop region (mirrors
          capture()'s crop math against the measured stage size). */}
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

      {/* Left tool rail */}
      <div className="absolute left-4 top-16 flex flex-col gap-1.5 rounded-xl p-2" style={{ background: `${CANVAS_TOKENS.bg.card}e6`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <button type="button" onClick={addMannequin} className={btn} style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>＋ 人偶</button>
        <button type="button" onClick={addCamera} className={btn} style={{ color: CANVAS_TOKENS.accent, background: CANVAS_TOKENS.bg.hover }}>＋ 机位</button>
        <button type="button" onClick={removeSelected} disabled={!selectedId} className={btn} style={{ color: selectedId ? '#FF8A8A' : CANVAS_TOKENS.text.muted, background: CANVAS_TOKENS.bg.hover, opacity: selectedId ? 1 : 0.4 }}>✕ 删除选中</button>
        <div className="my-1 h-px" style={{ background: CANVAS_TOKENS.hairline }} />
        {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} disabled={!isMannequinSelected && m !== 'translate'} className={btn} style={{ color: mode === m ? '#06222A' : CANVAS_TOKENS.text.secondary, background: mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover, opacity: !isMannequinSelected && m !== 'translate' ? 0.4 : 1 }}>
            {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
          </button>
        ))}
      </div>

      {/* Camera list — each row sends one frame sharing the blocking */}
      <div className="absolute bottom-5 left-4 w-60 rounded-xl p-2" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
        <div className="mb-1 flex items-center justify-between px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
          <span>机位（截图 → 发送一帧）</span>
          {sentTotal > 0 ? <span style={{ color: CANVAS_TOKENS.accent }}>已发送 {sentTotal} 帧</span> : null}
        </div>
        {state.mannequins.length === 0 ? (
          <div className="mb-1 px-1 text-[10px]" style={{ color: CANVAS_TOKENS.gold }}>先按左上「＋人偶」加角色，才能发送</div>
        ) : null}
        {state.cameras.map((cam) => {
          const sel = selectedId === camKey(cam.id) || selectedId === tgtKey(cam.id)
          return (
            <div key={cam.id} className="mb-1 rounded-md p-1" style={{ background: sel ? CANVAS_TOKENS.bg.hover : 'transparent' }}>
              <div className="flex items-center justify-between gap-1">
                <button type="button" onClick={() => setSelectedId(camKey(cam.id))} className="flex-1 truncate text-left text-[12px]" style={{ color: sel ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.primary }}>
                  ◢ {cam.label}
                </button>
                <button type="button" onClick={() => sendShot(cam.id)} disabled={saving} className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}>
                  {saving ? '…' : '发送'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Rig panel — pose presets + per-joint sliders, shown on mannequin select */}
      {selectedMannequin ? (
        <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <span className="font-mono text-[12px]" style={{ color: selectedMannequin.color }}>{selectedMannequin.label} · 姿势</span>
            <button type="button" onClick={() => applyPose(selectedMannequin.id, REST_POSE)} className="rounded px-2 py-0.5 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>重置</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
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

      {/* Toast — send feedback (the spawned frame is behind this fullscreen stage) */}
      {toast ? (
        <div
          className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg px-4 py-2 font-mono text-[12px]"
          style={{ background: `${CANVAS_TOKENS.bg.popover}f5`, border: `1px solid ${CANVAS_TOKENS.accent}66`, color: CANVAS_TOKENS.text.primary, boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {toast}
        </div>
      ) : null}

      {/* Hint */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
        左键选中 · 拖 gizmo 摆位 · ◢青锥=机位 / ●金球=注视点 · 加多个机位 → 每个发送一帧（站位一致）
      </div>
    </div>
  )
}
