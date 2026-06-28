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
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint, type Pose } from './pose-presets'
import {
  type DirectorStageState,
  type StageCamera,
  type StageMannequin,
  type TransformMode,
  type Vec3,
  makeCamera,
  makeMannequin,
} from './stage-types'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const camKey = (id: string) => `cam:${id}`
const tgtKey = (id: string) => `tgt:${id}`

function lookAtQuat(position: Vec3, target: Vec3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...position), new THREE.Vector3(...target), new THREE.Vector3(0, 1, 0))
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

interface SceneProps {
  state: DirectorStageState
  selectedId: string | null
  mode: TransformMode
  onSelect: (id: string | null) => void
  onCommitMannequin: (id: string, patch: Partial<StageMannequin>) => void
  onCommitCamera: (id: string, patch: Partial<StageCamera>) => void
  registerCapture: (fn: (cameraId: string) => string | null) => void
}

function SceneContents({ state, selectedId, mode, onSelect, onCommitMannequin, onCommitCamera, registerCapture }: SceneProps) {
  const { gl, scene } = useThree()
  const helpersRef = useRef<THREE.Group>(null)
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const transformRef = useRef<React.ComponentRef<typeof TransformControls>>(null)
  const mannequinRefs = useRef<Record<string, THREE.Group | null>>({})
  const camGizmoRefs = useRef<Record<string, THREE.Group | null>>({})
  const tgtGizmoRefs = useRef<Record<string, THREE.Mesh | null>>({})

  // Live cameras in a ref so the stable capture closure reads current values.
  const camerasRef = useRef(state.cameras)
  camerasRef.current = state.cameras

  const capture = useCallback((cameraId: string): string | null => {
    const sc = camerasRef.current.find((c) => c.id === cameraId)
    if (!sc) return null
    const canvas = gl.domElement
    const aspect = canvas.width / canvas.height || 1
    const cam = new THREE.PerspectiveCamera(sc.fov, aspect, 0.05, 1000)
    cam.position.set(...sc.position)
    cam.lookAt(new THREE.Vector3(...sc.target))
    const helpers = helpersRef.current
    const tc = transformRef.current as unknown as THREE.Object3D | null
    const ph = helpers?.visible
    const pt = tc?.visible
    if (helpers) helpers.visible = false
    if (tc) tc.visible = false
    gl.render(scene, cam)
    const url = gl.domElement.toDataURL('image/png')
    if (helpers && ph !== undefined) helpers.visible = ph
    if (tc && pt !== undefined) tc.visible = pt
    return url
  }, [gl, scene])

  useEffect(() => {
    registerCapture(capture)
    return () => registerCapture(() => null)
  }, [registerCapture, capture])

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
              quaternion={lookAtQuat(cam.position, cam.target)}
              onClick={(e) => { e.stopPropagation(); onSelect(camKey(cam.id)) }}
            >
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.12, 0.28, 4]} />
                <meshStandardMaterial color={CANVAS_TOKENS.accent} emissive={CANVAS_TOKENS.accent} emissiveIntensity={selectedId === camKey(cam.id) ? 0.55 : 0.18} />
              </mesh>
            </group>
            <mesh
              ref={(el) => { if (el) tgtGizmoRefs.current[cam.id] = el; else delete tgtGizmoRefs.current[cam.id] }}
              position={cam.target}
              onClick={(e) => { e.stopPropagation(); onSelect(tgtKey(cam.id)) }}
            >
              <sphereGeometry args={[0.07, 12, 12]} />
              <meshStandardMaterial color={CANVAS_TOKENS.gold} emissive={CANVAS_TOKENS.gold} emissiveIntensity={selectedId === tgtKey(cam.id) ? 0.6 : 0.2} />
            </mesh>
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
  onSendShot: (dataUrl: string, label: string, state: DirectorStageState) => void
  /** Names of character nodes wired into the director (the cast), for display. */
  castLabels?: string[]
  saving?: boolean
}

export function DirectorStage({ initialState, onClose, onSendShot, castLabels = [], saving }: DirectorStageProps) {
  const [state, setState] = useState<DirectorStageState>(initialState)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const captureRef = useRef<((cameraId: string) => string | null) | null>(null)

  const addMannequin = useCallback(() => setState((s) => ({ ...s, mannequins: [...s.mannequins, makeMannequin(uid(), s.mannequins.length)] })), [])
  const addCamera = useCallback(() => setState((s) => ({ ...s, cameras: [...s.cameras, makeCamera(uid(), s.cameras.length)] })), [])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    if (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) {
      const cid = selectedId.slice(4)
      setState((s) => (s.cameras.length <= 1 ? s : { ...s, cameras: s.cameras.filter((c) => c.id !== cid) }))
    } else {
      setState((s) => ({ ...s, mannequins: s.mannequins.filter((m) => m.id !== selectedId) }))
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

  const sendShot = useCallback((cameraId: string) => {
    const cam = state.cameras.find((c) => c.id === cameraId)
    const url = captureRef.current?.(cameraId)
    if (url && cam) onSendShot(url, cam.label, state)
  }, [onSendShot, state])

  const selectedMannequin = state.mannequins.find((m) => m.id === selectedId) ?? null
  const selectedCamId = selectedId && (selectedId.startsWith('cam:') || selectedId.startsWith('tgt:')) ? selectedId.slice(4) : null
  const selectedCamera = selectedCamId ? state.cameras.find((c) => c.id === selectedCamId) ?? null : null

  const btn = 'rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors'
  const isMannequinSelected = Boolean(selectedMannequin)

  return (
    <div className="fixed inset-0 z-50" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <Canvas shadows gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [3.5, 2.6, 5.5], fov: 45 }} onPointerMissed={() => setSelectedId(null)}>
        <SceneContents
          state={state}
          selectedId={selectedId}
          mode={mode}
          onSelect={setSelectedId}
          onCommitMannequin={commitMannequin}
          onCommitCamera={commitCamera}
          registerCapture={(fn) => { captureRef.current = fn }}
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
        <button type="button" onClick={onClose} className={btn} style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>✕ 关闭</button>
      </div>

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
        <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>机位（截图 → 发送到画布当一帧）</div>
        {state.cameras.map((cam) => {
          const sel = selectedId === camKey(cam.id) || selectedId === tgtKey(cam.id)
          return (
            <div key={cam.id} className="mb-1 rounded-md p-1" style={{ background: sel ? CANVAS_TOKENS.bg.hover : 'transparent' }}>
              <div className="flex items-center justify-between gap-1">
                <button type="button" onClick={() => setSelectedId(camKey(cam.id))} className="flex-1 truncate text-left text-[12px]" style={{ color: sel ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.primary }}>
                  ◢ {cam.label}
                </button>
                <button type="button" onClick={() => sendShot(cam.id)} disabled={state.mannequins.length === 0 || saving} className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold disabled:opacity-40" style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}>
                  发送
                </button>
              </div>
              {sel && selectedCamera?.id === cam.id ? (
                <SliderRow label="FOV" value={cam.fov} min={18} max={90} unit="°" onChange={(v) => commitCamera(cam.id, { fov: v })} />
              ) : null}
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

      {/* Hint */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
        左键选中 · 拖 gizmo 摆位 · ◢青锥=机位 / ●金球=注视点 · 加多个机位 → 每个发送一帧（站位一致）
      </div>
    </div>
  )
}
