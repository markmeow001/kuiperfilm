'use client'

/**
 * previz 播放时钟 — rAF 驱动的全片时间轴。
 *
 * timeSec 一律是「全片秒数」（跨镜头累计）；'shot' 模式把可播区间钳制在选中
 * 镜头的 [startSec, endSec]，'scene' 模式跑完整序列。三消费方：
 *  - UI（时间读数/进度条）读 state `timeSec`（节流 ~10Hz，避免面板 60fps 重渲）
 *  - 3D 驱动层每帧读 `getTimeSec()`（ref，不经 React state — 铁则：播放期间
 *    不逐帧 setState 场景对象）
 *  - 播放到区间尾自动 pause 并停在尾帧（再按预演从区间头重放）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { totalDurationSec, type StageShot } from './previz-types'

export type PlaybackMode = 'shot' | 'scene'

export interface PrevizPlayback {
  /** 预演模式开着（3D 层被 evalShot 驱动、orbit 锁定） */
  active: boolean
  playing: boolean
  rate: number
  mode: PlaybackMode
  /** 全片秒数（UI 用，节流更新） */
  timeSec: number
  /** 当前模式可播区间 [rangeStartSec, rangeEndSec] */
  rangeStartSec: number
  rangeEndSec: number
  /** 每帧精确时钟（3D 驱动层用） */
  getTimeSec: () => number
  enter: (mode: PlaybackMode) => void
  exit: () => void
  toggle: () => void
  seek: (sec: number) => void
  setRate: (rate: number) => void
}

const UI_TICK_MS = 100

/** 选中镜头在全片时间轴上的 [start, end]；无镜头 → [0, 0]。 */
function shotRange(shots: StageShot[], index: number): [number, number] {
  let acc = 0
  for (let i = 0; i < shots.length; i++) {
    const dur = shots[i].durationSec
    if (i === index) return [acc, acc + dur]
    acc += dur
  }
  return [0, acc]
}

export function usePrevizPlayback(shots: StageShot[], selectedShotIndex: number): PrevizPlayback {
  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<PlaybackMode>('shot')
  const [rate, setRate] = useState(1)
  const [timeSec, setTimeSec] = useState(0)
  const timeRef = useRef(0)
  const rateRef = useRef(rate)
  rateRef.current = rate

  const sceneEnd = totalDurationSec(shots)
  const [rangeStartSec, rangeEndSec] = useMemo(
    () => (mode === 'shot' && selectedShotIndex >= 0 && selectedShotIndex < shots.length ? shotRange(shots, selectedShotIndex) : [0, sceneEnd]),
    [mode, selectedShotIndex, shots, sceneEnd],
  )
  const rangeRef = useRef<[number, number]>([rangeStartSec, rangeEndSec])
  rangeRef.current = [rangeStartSec, rangeEndSec]
  const sceneEndRef = useRef(sceneEnd)
  sceneEndRef.current = sceneEnd

  /** 模式区间内钳制（播放 tick / 区间变更效应用）。 */
  const setTime = useCallback((sec: number) => {
    const [lo, hi] = rangeRef.current
    const clamped = Math.min(Math.max(sec, lo), hi)
    timeRef.current = clamped
    setTimeSec(clamped)
  }, [])

  /**
   * seek 只对全片边界钳制，不对当前模式区间钳制 —— seek 常与
   * onSelectShot 同一个事件里连发（时间轴「上一镜/下一镜」），此时
   * rangeRef 还是旧镜头的区间；用旧区间钳会把目标秒数拉去错误的位置
   * （review 2026-07-13 HIGH#1）。渲染提交后，下方的区间变更 effect 会
   * 再按新区间收一次口。
   */
  const setTimeSceneClamped = useCallback((sec: number) => {
    const clamped = Math.min(Math.max(sec, 0), sceneEndRef.current)
    timeRef.current = clamped
    setTimeSec(clamped)
  }, [])

  // rAF loop — advances timeRef every frame, mirrors into state ~10Hz.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let lastUi = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const [lo, hi] = rangeRef.current
      const next = timeRef.current + dt * rateRef.current
      if (next >= hi) {
        timeRef.current = hi
        setTimeSec(hi)
        setPlaying(false)
        return
      }
      timeRef.current = Math.max(next, lo)
      if (now - lastUi >= UI_TICK_MS) {
        lastUi = now
        setTimeSec(timeRef.current)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Shots edited while previewing (duration change / delete) → keep time legal.
  useEffect(() => {
    if (!active) return
    setTime(timeRef.current)
  }, [active, rangeStartSec, rangeEndSec, setTime])

  const enter = useCallback((m: PlaybackMode) => {
    setMode(m)
    setActive(true)
    setPlaying(false)
  }, [])

  const exit = useCallback(() => {
    setActive(false)
    setPlaying(false)
  }, [])

  const toggle = useCallback(() => {
    setActive(true)
    setPlaying((p) => {
      if (p) return false
      // replay from range start when parked at the range end
      const [lo, hi] = rangeRef.current
      if (hi - timeRef.current < 1e-3) {
        timeRef.current = lo
        setTimeSec(lo)
      }
      return true
    })
  }, [])

  const seek = useCallback((sec: number) => {
    setActive(true)
    setTimeSceneClamped(sec)
  }, [setTimeSceneClamped])

  const getTimeSec = useCallback(() => timeRef.current, [])

  return { active, playing, rate, mode, timeSec, rangeStartSec, rangeEndSec, getTimeSec, enter, exit, toggle, seek, setRate }
}
