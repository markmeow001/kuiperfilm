'use client'

/**
 * previz 时间轴（导演台底部，工具 dock 上方）——对标截图的
 * 「上一镜 | 预演 | 下一镜 | 速率 | 00:08.5/00:15.0 + 镜头卡片列」。
 * 纯展示 + 回调；时钟由 use-previz-playback 提供。
 */
import { useCallback, useRef } from 'react'
import { CANVAS_TOKENS } from '../lib/canvas-tokens'
import { MAX_SCENE_SEC, SHOT_MIN_SEC, totalDurationSec, type StageShot } from './previz-types'
import type { PrevizPlayback } from './use-previz-playback'

const RATES = [0.5, 1, 1.5, 2]

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

export interface PrevizTimelineProps {
  shots: StageShot[]
  selectedShotId: string | null
  playback: PrevizPlayback
  onSelectShot: (id: string | null) => void
  onAddShot: () => void
}

export function PrevizTimeline({ shots, selectedShotId, playback, onSelectShot, onAddShot }: PrevizTimelineProps) {
  const total = totalDurationSec(shots)
  const remaining = MAX_SCENE_SEC - total
  const selectedIndex = shots.findIndex((s) => s.id === selectedShotId)
  const barRef = useRef<HTMLDivElement>(null)

  const seekFromPointer = useCallback(
    (e: React.PointerEvent) => {
      const el = barRef.current
      if (!el || total <= 0) return
      const rect = el.getBoundingClientRect()
      const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
      playback.seek(frac * total)
    },
    [playback, total],
  )

  const step = useCallback(
    (dir: -1 | 1) => {
      if (shots.length === 0) return
      const next = selectedIndex < 0 ? (dir > 0 ? 0 : shots.length - 1) : Math.min(Math.max(selectedIndex + dir, 0), shots.length - 1)
      onSelectShot(shots[next].id)
      // 跳到该镜头起点
      let acc = 0
      for (let i = 0; i < next; i++) acc += shots[i].durationSec
      playback.seek(acc)
    },
    [shots, selectedIndex, onSelectShot, playback],
  )

  const btn = 'rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-40'

  return (
    <div
      className="absolute bottom-[72px] left-1/2 z-10 w-[min(860px,calc(100%-32px))] -translate-x-1/2 rounded-xl px-3 pb-2 pt-1.5"
      style={{ background: `${CANVAS_TOKENS.bg.card}f0`, border: `1px solid ${CANVAS_TOKENS.hairline}`, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
    >
      {/* transport + 全局进度 */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <button type="button" className={btn} disabled={shots.length === 0} onClick={() => step(-1)} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>上一镜</button>
        <button
          type="button"
          className={btn}
          disabled={shots.length === 0}
          onClick={playback.toggle}
          style={{ background: playback.playing ? CANVAS_TOKENS.accent : CANVAS_TOKENS.bg.hover, color: playback.playing ? CANVAS_TOKENS.accentText : CANVAS_TOKENS.text.primary }}
        >
          {playback.playing ? '⏸ 暂停' : '▶ 预演'}
        </button>
        <button type="button" className={btn} disabled={shots.length === 0} onClick={() => step(1)} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.text.secondary }}>下一镜</button>
        <select
          value={playback.rate}
          onChange={(e) => playback.setRate(Number(e.target.value))}
          className="rounded-md px-1.5 py-1 font-mono text-[11px] outline-none"
          style={{ background: CANVAS_TOKENS.bg.input, color: CANVAS_TOKENS.text.primary, border: `1px solid ${CANVAS_TOKENS.hairline}` }}
        >
          {RATES.map((r) => <option key={r} value={r}>{r.toFixed(1)}x</option>)}
        </select>
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: CANVAS_TOKENS.bg.hover }}>
          {(['shot', 'scene'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="rounded-md px-2 py-0.5 font-mono text-[10px]"
              onClick={() => playback.enter(m)}
              style={{ background: playback.active && playback.mode === m ? CANVAS_TOKENS.bg.card : 'transparent', color: playback.active && playback.mode === m ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.muted }}
            >
              {m === 'shot' ? '播放镜头' : '播放全片'}
            </button>
          ))}
        </div>
        {playback.active ? (
          <button type="button" className={btn} onClick={playback.exit} style={{ background: CANVAS_TOKENS.bg.hover, color: CANVAS_TOKENS.gold }}>退出预演</button>
        ) : null}
        <span className="ml-auto font-mono text-[11px]" style={{ color: CANVAS_TOKENS.text.secondary }}>
          {fmt(playback.timeSec)} / {fmt(total)}
          <span className="ml-2" style={{ color: remaining < SHOT_MIN_SEC ? '#FF8A8A' : CANVAS_TOKENS.text.muted }}>余 {remaining.toFixed(1)}s</span>
        </span>
      </div>

      {/* 全局 scrub 条（按镜头分段着色） */}
      <div ref={barRef} className="mb-1.5 flex h-2 w-full cursor-pointer overflow-hidden rounded-full" style={{ background: CANVAS_TOKENS.bg.input }} onPointerDown={seekFromPointer}>
        {total > 0
          ? shots.map((s) => {
              let acc = 0
              for (const x of shots) { if (x.id === s.id) break; acc += x.durationSec }
              const playedInShot = Math.min(Math.max(playback.timeSec - acc, 0), s.durationSec)
              return (
                <div key={s.id} className="relative h-full" style={{ width: `${(s.durationSec / total) * 100}%`, borderRight: `1px solid ${CANVAS_TOKENS.bg.card}` }}>
                  <div className="h-full" style={{ width: `${(playedInShot / s.durationSec) * 100}%`, background: s.id === selectedShotId ? CANVAS_TOKENS.accent : `${CANVAS_TOKENS.accent}88` }} />
                </div>
              )
            })
          : null}
      </div>

      {/* 镜头卡片列 */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {shots.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelectShot(s.id === selectedShotId ? null : s.id)}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-left"
            style={{
              background: s.id === selectedShotId ? CANVAS_TOKENS.bg.hover : CANVAS_TOKENS.bg.app,
              border: `1px solid ${s.id === selectedShotId ? CANVAS_TOKENS.accent : CANVAS_TOKENS.hairline}`,
              minWidth: 120,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] font-semibold" style={{ color: s.id === selectedShotId ? CANVAS_TOKENS.accent : CANVAS_TOKENS.text.primary }}>{s.label || `${String(i + 1).padStart(2, '0')} 镜头`}</span>
              <span className="font-mono text-[10px]" style={{ color: CANVAS_TOKENS.text.muted }}>{s.durationSec.toFixed(1)}s</span>
            </div>
            {s.note ? <div className="mt-0.5 truncate text-[10px]" style={{ color: CANVAS_TOKENS.text.muted, maxWidth: 150 }}>{s.note}</div> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={onAddShot}
          disabled={remaining < SHOT_MIN_SEC}
          title={remaining < SHOT_MIN_SEC ? `全片已满 ${MAX_SCENE_SEC}s（R2V 参考视频上限）` : '以当前摆位+机位新建镜头'}
          className="shrink-0 rounded-lg px-4 font-mono text-[16px] disabled:opacity-40"
          style={{ background: CANVAS_TOKENS.bg.app, border: `1px dashed ${CANVAS_TOKENS.hairline}`, color: CANVAS_TOKENS.text.secondary, minHeight: 44 }}
        >
          +
        </button>
      </div>
    </div>
  )
}
