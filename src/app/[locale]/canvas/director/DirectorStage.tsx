'use client'

/**
 * 导演台 3D stage (M2a) — fullscreen blocking editor.
 *
 * Arrange 素体 mannequins (move/rotate/scale), position a shot camera + its
 * look-at target, then 截图 the camera POV → sent to the canvas as a reference
 * image. Director-orbit view only; live 机位视角 toggle + per-joint rig = M2b.
 *
 * Capture hides all helpers (grid/gizmos/transform controls) imperatively,
 * renders the scene from a temp camera built from state.camera, grabs the
 * canvas buffer (preserveDrawingBuffer), then restores — so the screenshot is a
 * clean shot with no UI furniture.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { Mannequin } from './Mannequin'
import { SliderRow } from './SliderRow'
import { POSE_PRESETS, REST_POSE, RIG_SLIDER_GROUPS, type Joint, type Pose } from './pose-presets'
import {
  type DirectorStageState,
  type StageMannequin,
  type TransformMode,
  type Vec3,
  makeMannequin,
} from './stage-types'

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m_${Date.now()}_${Math.round(Math.random() * 1e6)}`

const CAMERA_ID = '__camera__'
const TARGET_ID = '__target__'

interface SceneProps {
  state: DirectorStageState
  selectedId: string | null
  mode: TransformMode
  onSelect: (id: string | null) => void
  onCommitMannequin: (id: string, patch: Partial<StageMannequin>) => void
  onCommitCamera: (patch: Partial<DirectorStageState['camera']>) => void
  registerCapture: (fn: () => string | null) => void
}

function SceneContents({ state, selectedId, mode, onSelect, onCommitMannequin, onCommitCamera, registerCapture }: SceneProps) {
  const { gl, scene } = useThree()
  const helpersRef = useRef<THREE.Group>(null)
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const mannequinRefs = useRef<Record<string, THREE.Group | null>>({})
  const cameraGizmoRef = useRef<THREE.Group>(null)
  const targetGizmoRef = useRef<THREE.Mesh>(null)
  const transformRef = useRef<React.ComponentRef<typeof TransformControls>>(null)

  // Live camera in a ref so the (stable) capture closure reads current values
  // without being re-created each render (C1: no side-effect-during-render).
  const cameraStateRef = useRef(state.camera)
  cameraStateRef.current = state.camera

  const capture = useCallback((): string | null => {
    const canvas = gl.domElement
    const aspect = canvas.width / canvas.height || 1
    const cam = new THREE.PerspectiveCamera(cameraStateRef.current.fov, aspect, 0.05, 1000)
    cam.position.set(...cameraStateRef.current.position)
    cam.lookAt(new THREE.Vector3(...cameraStateRef.current.target))
    // Hide all UI furniture for a clean plate. Synchronous render + toDataURL —
    // R3F's rAF loop can't interleave, so the buffer read is clean and the next
    // frame restores the orbit view.
    const helpers = helpersRef.current
    const tc = transformRef.current as unknown as THREE.Object3D | null
    const prevHelpers = helpers?.visible
    const prevTc = tc?.visible
    if (helpers) helpers.visible = false
    if (tc) tc.visible = false
    gl.render(scene, cam)
    const url = gl.domElement.toDataURL('image/png')
    if (helpers && prevHelpers !== undefined) helpers.visible = prevHelpers
    if (tc && prevTc !== undefined) tc.visible = prevTc
    return url
  }, [gl, scene])

  useEffect(() => {
    registerCapture(capture)
    return () => registerCapture(() => null)
  }, [registerCapture, capture])

  const selectedObject: THREE.Object3D | null =
    selectedId === CAMERA_ID
      ? cameraGizmoRef.current
      : selectedId === TARGET_ID
        ? targetGizmoRef.current
        : selectedId
          ? mannequinRefs.current[selectedId] ?? null
          : null

  // Camera gizmo orientation: point it at the target.
  const camQuat = useMemo(() => {
    const m = new THREE.Matrix4().lookAt(
      new THREE.Vector3(...state.camera.position),
      new THREE.Vector3(...state.camera.target),
      new THREE.Vector3(0, 1, 0),
    )
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }, [state.camera.position, state.camera.target])

  const commitSelected = useCallback(() => {
    const obj = selectedObject
    if (!obj) return
    if (selectedId === CAMERA_ID) {
      onCommitCamera({ position: obj.position.toArray() as Vec3 })
    } else if (selectedId === TARGET_ID) {
      onCommitCamera({ target: obj.position.toArray() as Vec3 })
    } else if (selectedId) {
      onCommitMannequin(selectedId, {
        position: obj.position.toArray() as Vec3,
        rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        scale: obj.scale.x,
      })
    }
  }, [selectedObject, selectedId, onCommitCamera, onCommitMannequin])

  // Safety: when the transform target disappears (deselect / mannequin deleted
  // mid-drag), drei's 'dragging-changed(false)' that re-enables OrbitControls
  // can be skipped on unmount → orbit stuck disabled. Restore it whenever there
  // is no transform target. (C2)
  useEffect(() => {
    if (!selectedObject && orbitRef.current) orbitRef.current.enabled = true
  }, [selectedObject])

  return (
    <>
      <color attach="background" args={[CANVAS_TOKENS.bg.canvas]} />
      <hemisphereLight args={['#ffffff', '#2a2a30', 0.8]} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />

      {/* Ground (kept in shot) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#15151a" roughness={1} />
      </mesh>

      {/* Helpers — hidden during capture */}
      <group ref={helpersRef}>
        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellColor="#2a2a32"
          sectionSize={2}
          sectionColor="#3a3a46"
          fadeDistance={28}
          infiniteGrid
          position={[0, 0.001, 0]}
        />
        {/* shot camera gizmo */}
        <group
          ref={cameraGizmoRef}
          position={state.camera.position}
          quaternion={camQuat}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(CAMERA_ID)
          }}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.12, 0.28, 4]} />
            <meshStandardMaterial color={CANVAS_TOKENS.accent} emissive={CANVAS_TOKENS.accent} emissiveIntensity={selectedId === CAMERA_ID ? 0.5 : 0.15} />
          </mesh>
        </group>
        {/* look-at target gizmo */}
        <mesh
          ref={targetGizmoRef}
          position={state.camera.target}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(TARGET_ID)
          }}
        >
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color={CANVAS_TOKENS.gold} emissive={CANVAS_TOKENS.gold} emissiveIntensity={selectedId === TARGET_ID ? 0.6 : 0.2} />
        </mesh>
      </group>

      {/* Mannequins — wrapping group owns transform + selection */}
      {state.mannequins.map((m) => (
        <group
          key={m.id}
          ref={(el) => {
            if (el) mannequinRefs.current[m.id] = el
            else delete mannequinRefs.current[m.id]
          }}
          position={m.position}
          rotation={m.rotation}
          scale={m.scale}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(m.id)
          }}
        >
          <Mannequin data={m} selected={selectedId === m.id} />
        </group>
      ))}

      {/* Transform gizmo on the selected object. drei auto-disables the
          makeDefault'd OrbitControls during a drag (via 'dragging-changed'), so
          we don't toggle orbit manually (that could leave it stuck disabled if
          the gizmo unmounts mid-drag — see the safety effect below). Commit on
          objectChange so an interrupted/unmounted drag never loses the move. */}
      {selectedObject ? (
        <TransformControls
          ref={transformRef}
          object={selectedObject}
          mode={selectedId === CAMERA_ID || selectedId === TARGET_ID ? 'translate' : mode}
          onObjectChange={commitSelected}
        />
      ) : null}

      <OrbitControls ref={orbitRef} makeDefault target={[0, 1, 0]} enablePan />
    </>
  )
}

interface DirectorStageProps {
  initialState: DirectorStageState
  onClose: () => void
  onSend: (dataUrl: string, state: DirectorStageState) => void
  saving?: boolean
}

export function DirectorStage({ initialState, onClose, onSend, saving }: DirectorStageProps) {
  const [state, setState] = useState<DirectorStageState>(initialState)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const captureRef = useRef<(() => string | null) | null>(null)

  const addMannequin = useCallback(() => {
    setState((s) => ({ ...s, mannequins: [...s.mannequins, makeMannequin(uid(), s.mannequins.length)] }))
  }, [])

  const removeSelected = useCallback(() => {
    if (!selectedId || selectedId === CAMERA_ID || selectedId === TARGET_ID) return
    setState((s) => ({ ...s, mannequins: s.mannequins.filter((m) => m.id !== selectedId) }))
    setSelectedId(null)
  }, [selectedId])

  const commitMannequin = useCallback((id: string, patch: Partial<StageMannequin>) => {
    setState((s) => ({ ...s, mannequins: s.mannequins.map((m) => (m.id === id ? { ...m, ...patch } : m)) }))
  }, [])

  const commitCamera = useCallback((patch: Partial<DirectorStageState['camera']>) => {
    setState((s) => ({ ...s, camera: { ...s.camera, ...patch } }))
  }, [])

  const selectedMannequin = state.mannequins.find((m) => m.id === selectedId) ?? null

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

  const handleSend = useCallback(() => {
    const url = captureRef.current?.()
    if (url) onSend(url, state)
  }, [onSend, state])

  const btn = 'rounded-md px-3 py-1.5 font-mono text-[12px] transition-colors'
  const isMannequinSelected = Boolean(selectedId && selectedId !== CAMERA_ID && selectedId !== TARGET_ID)

  return (
    <div className="fixed inset-0 z-50" style={{ background: CANVAS_TOKENS.bg.canvas }}>
      <Canvas
        shadows
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [3.5, 2.6, 5.5], fov: 45 }}
        onPointerMissed={() => setSelectedId(null)}
      >
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
      <div
        className="absolute inset-x-0 top-0 flex h-12 items-center justify-between px-4"
        style={{ background: `${CANVAS_TOKENS.bg.panel}cc`, borderBottom: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-2 font-mono text-[13px]">
          <span style={{ color: CANVAS_TOKENS.accent }}>◐</span>
          <span style={{ color: CANVAS_TOKENS.text.primary }}>导演台</span>
          <span className="text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>· 站位 / 机位 → 截图当参考图</span>
        </div>
        <button type="button" onClick={onClose} className={btn} style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}>
          ✕ 关闭
        </button>
      </div>

      {/* Left tool rail */}
      <div
        className="absolute left-4 top-16 flex flex-col gap-1.5 rounded-xl p-2"
        style={{ background: `${CANVAS_TOKENS.bg.card}e6`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}
      >
        <button type="button" onClick={addMannequin} className={btn} style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}>＋ 人偶</button>
        <button type="button" onClick={removeSelected} disabled={!isMannequinSelected} className={btn} style={{ color: isMannequinSelected ? '#FF8A8A' : CANVAS_TOKENS.text.muted, background: CANVAS_TOKENS.bg.hover, opacity: isMannequinSelected ? 1 : 0.4 }}>✕ 删除</button>
        <div className="my-1 h-px" style={{ background: CANVAS_TOKENS.hairline }} />
        {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={!isMannequinSelected && m !== 'translate'}
            className={btn}
            style={{
              color: mode === m ? '#06222A' : CANVAS_TOKENS.text.secondary,
              background: mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover,
              opacity: !isMannequinSelected && m !== 'translate' ? 0.4 : 1,
            }}
          >
            {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
          </button>
        ))}
      </div>

      {/* FOV slider (camera) */}
      <div
        className="absolute bottom-20 left-4 flex items-center gap-2 rounded-xl px-3 py-2 font-mono text-[11px]"
        style={{ background: `${CANVAS_TOKENS.bg.card}e6`, border: `1px solid ${CANVAS_TOKENS.hairline}`, color: CANVAS_TOKENS.text.secondary, backdropFilter: 'blur(8px)' }}
      >
        <span>FOV</span>
        <input type="range" min={18} max={90} step={1} value={state.camera.fov} onChange={(e) => commitCamera({ fov: Number(e.target.value) })} />
        <span style={{ color: CANVAS_TOKENS.accent }}>{state.camera.fov}°</span>
      </div>

      {/* Rig panel — pose presets + per-joint sliders (M2b), shown when a
          mannequin is selected */}
      {selectedMannequin ? (
        <div
          className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl"
          style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}
        >
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
            <span className="font-mono text-[12px]" style={{ color: selectedMannequin.color }}>{selectedMannequin.label} · 姿势</span>
            <button
              type="button"
              onClick={() => applyPose(selectedMannequin.id, REST_POSE)}
              className="rounded px-2 py-0.5 font-mono text-[10px]"
              style={{ color: CANVAS_TOKENS.text.secondary, background: CANVAS_TOKENS.bg.hover }}
            >
              重置
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {/* Pose presets */}
            <div className="mb-1 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>预设姿势</div>
            <div className="mb-3 grid grid-cols-3 gap-1">
              {POSE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPose(selectedMannequin.id, preset.pose)}
                  className="rounded py-1 text-[11px] transition-colors hover:opacity-80"
                  style={{ color: CANVAS_TOKENS.text.primary, background: CANVAS_TOKENS.bg.hover }}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Per-joint rig sliders */}
            {RIG_SLIDER_GROUPS.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="mb-0.5 px-1 font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{g.group}</div>
                {g.rows.map((row) => (
                  <SliderRow
                    key={`${row.joint}-${row.axis}`}
                    label={row.label}
                    value={(selectedMannequin.pose ?? REST_POSE).joints[row.joint][row.axis] * RAD2DEG}
                    min={-180}
                    max={180}
                    onChange={(deg) => setJointAxis(selectedMannequin.id, row.joint, row.axis, deg * DEG2RAD)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Hint */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.muted }}>
        左键选中 · 拖拽 gizmo 摆位 · 选 ◢青锥=机位 / ●金球=注视点 · 滚轮缩放 · 右键平移
      </div>

      {/* Send button */}
      <button
        type="button"
        onClick={handleSend}
        disabled={state.mannequins.length === 0 || saving}
        className="absolute bottom-16 right-4 rounded-lg px-5 py-2.5 font-mono text-[13px] font-semibold disabled:opacity-40"
        style={{ background: CANVAS_TOKENS.accent, color: '#06222A' }}
      >
        {saving ? '发送中…' : '截图 → 发送到画布'}
      </button>
    </div>
  )
}
