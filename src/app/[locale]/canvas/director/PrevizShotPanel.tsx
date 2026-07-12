'use client'

/**
 * previz 镜头检查器（右侧面板，选中镜头时显示）——起幅/落幅两个关键帧的
 * 摄影机与摆位快照按钮、时长/缓动、运镜关键点管理。对标截图的
 * 「运镜关键帧：起幅/落幅 + 当前摄影机视角设为起幅/落幅 + 添加调度点」。
 */
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { MAX_SCENE_SEC, SHOT_MIN_SEC, totalDurationSec, type StageShot } from './previz-types'

export interface PrevizShotPanelProps {
  shot: StageShot
  shots: StageShot[]
  onPatch: (id: string, patch: Partial<StageShot>) => void
  onDelete: (id: string) => void
  /** 把「当前摄影机视角」写进起幅/落幅的 camera。 */
  onSetCamera: (end: 'start' | 'end') => void
  /** 把「当前全体人偶摆位」写进起幅/落幅的 actors。 */
  onSetActors: (end: 'start' | 'end') => void
  /** 时间轴跳到本镜头的起点/终点（预演检查用）。 */
  onJump: (end: 'start' | 'end') => void
  /** 以当前视角位置追加一个运镜关键点。 */
  onAddCameraWaypoint: () => void
}

export function PrevizShotPanel({ shot, shots, onPatch, onDelete, onSetCamera, onSetActors, onJump, onAddCameraWaypoint }: PrevizShotPanelProps) {
  const othersTotal = totalDurationSec(shots) - shot.durationSec
  const maxDur = Math.min(MAX_SCENE_SEC, MAX_SCENE_SEC - othersTotal)
  const waypointCount = shot.cameraWaypoints?.length ?? 0

  const section = 'mb-1 mt-3 px-1 font-mono text-[10px]'
  const rowBtn = 'flex-1 rounded py-1 text-[11px] transition-colors hover:opacity-80'

  return (
    <div className="absolute right-4 top-16 bottom-16 flex w-64 flex-col overflow-hidden rounded-xl" style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${CANVAS_TOKENS.hairline}` }}>
        <span className="font-mono text-[12px]" style={{ color: CANVAS_TOKENS.accent }}>镜头 · {shot.label}</span>
        <button type="button" onClick={() => onDelete(shot.id)} className="rounded px-2 py-0.5 font-mono text-[10px]" style={{ color: '#FF8A8A', background: CANVAS_TOKENS.bg.hover }}>删除</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <label className="block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>名称</span>
          <input value={shot.label} onChange={(e) => onPatch(shot.id, { label: e.target.value })} className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </label>
        <label className="mt-2 block">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>描述（景别/运镜，喂导演指令）</span>
          <input value={shot.note ?? ''} onChange={(e) => onPatch(shot.id, { note: e.target.value })} placeholder="中景 / 极低机位 / 摄像推进" className="mt-0.5 w-full rounded px-2 py-1 text-[12px] outline-none" style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }} />
        </label>

        <div className="mt-2 flex items-center gap-2 py-0.5">
          <span className="w-16 shrink-0 text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>时长</span>
          <input
            type="range"
            min={SHOT_MIN_SEC}
            max={Math.max(maxDur, SHOT_MIN_SEC)}
            step={0.1}
            value={shot.durationSec}
            onChange={(e) => onPatch(shot.id, { durationSec: Math.round(Number(e.target.value) * 10) / 10 })}
            className="min-w-0 flex-1"
            style={{ accentColor: CANVAS_TOKENS.accent, height: 3 }}
          />
          <span className="w-10 shrink-0 text-right font-mono text-[10px]" style={{ color: CANVAS_TOKENS.accent }}>{shot.durationSec.toFixed(1)}s</span>
        </div>
        <div className="mt-1 flex gap-1">
          {(['easeInOut', 'linear'] as const).map((e) => (
            <button key={e} type="button" onClick={() => onPatch(shot.id, { easing: e })} className={rowBtn} style={{ background: (shot.easing ?? 'easeInOut') === e ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover, color: (shot.easing ?? 'easeInOut') === e ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.secondary }}>
              {e === 'easeInOut' ? '缓入缓出' : '匀速'}
            </button>
          ))}
        </div>

        <div className={section} style={{ color: CANVAS_TOKENS.text.muted }}>起幅（镜头开始）</div>
        <div className="flex gap-1">
          <button type="button" onClick={() => onSetCamera('start')} className={rowBtn} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>视角设为起幅</button>
          <button type="button" onClick={() => onSetActors('start')} className={rowBtn} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>摆位设为起幅</button>
        </div>
        <button type="button" onClick={() => onJump('start')} className="mt-1 w-full rounded py-1 text-[11px]" style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>⤓ 查看起幅</button>

        <div className={section} style={{ color: CANVAS_TOKENS.text.muted }}>落幅（镜头结束）</div>
        <div className="flex gap-1">
          <button type="button" onClick={() => onSetCamera('end')} className={rowBtn} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>视角设为落幅</button>
          <button type="button" onClick={() => onSetActors('end')} className={rowBtn} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>摆位设为落幅</button>
        </div>
        <button type="button" onClick={() => onJump('end')} className="mt-1 w-full rounded py-1 text-[11px]" style={{ background: CANVAS_TOKENS.bg.app, color: CANVAS_TOKENS.text.secondary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}>⤒ 查看落幅</button>

        <div className={section} style={{ color: CANVAS_TOKENS.text.muted }}>运镜关键点（起幅 → 落幅 路径）</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onAddCameraWaypoint} className={rowBtn} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.primary }}>+ 当前视角加为运镜点</button>
        </div>
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>已有 {waypointCount} 个</span>
          {waypointCount > 0 ? (
            <button type="button" onClick={() => onPatch(shot.id, { cameraWaypoints: undefined })} className="rounded px-2 py-0.5 text-[10px]" style={{ color: '#FF8A8A', background: CANVAS_TOKENS.bg.hover }}>清空</button>
          ) : null}
        </div>
        <div className="mt-2 px-1 text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>
          流程：摆好人物机位 →「设为起幅」→ 移动到结束状态 →「设为落幅」→ 预演。人物在两幅间自动走位。
        </div>
      </div>
    </div>
  )
}
