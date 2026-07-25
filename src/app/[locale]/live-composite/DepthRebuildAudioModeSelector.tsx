'use client'

import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'

interface AudioModeOption {
  value: SourceAudioMode
  label: string
  description: string
  requiresSourceAudio: boolean
}

const AUDIO_MODE_OPTIONS: readonly AudioModeOption[] = [
  {
    value: 'preserve',
    label: '保留原始同期聲',
    description: '成片沿用原片的對白、音樂與雜音；不會自動降噪或修復收音。',
    requiresSourceAudio: true,
  },
  {
    value: 'reference-only',
    label: '只拿原音對口型',
    description: '原音只供口型、停頓與節奏參考；成片保持靜音，方便後期配音與混音。',
    requiresSourceAudio: true,
  },
  {
    value: 'generate',
    label: '讓 AI 重新生聲音',
    description: '移除原片音軌，由 Seedance 生成新的人聲與環境聲；原對白可能改變。',
    requiresSourceAudio: false,
  },
]

interface DepthRebuildAudioModeSelectorProps {
  value: SourceAudioMode
  sourceAudioDetected: boolean | null
  disabled: boolean
  onChange: (value: SourceAudioMode) => void
}

export function DepthRebuildAudioModeSelector({
  value,
  sourceAudioDetected,
  disabled,
  onChange,
}: DepthRebuildAudioModeSelectorProps) {
  const sourceStatus = sourceAudioDetected === true
    ? '已偵測到原片音軌。'
    : sourceAudioDetected === false
      ? '原片沒有可用音軌；前兩項暫不可選。'
      : '正在確認原片音軌；目前可先選 AI 重新生成。'

  return (
    <fieldset className="mt-4" disabled={disabled}>
      <legend className="text-xs font-medium text-stone-300">聲音怎麼處理</legend>
      <p
        id="depth-rebuild-source-audio-status"
        className={`mt-1 text-xs leading-5 ${
          sourceAudioDetected === true ? 'text-emerald-300/85' : 'text-amber-200/80'
        }`}
      >
        {sourceStatus}
      </p>
      <div
        role="radiogroup"
        aria-describedby="depth-rebuild-source-audio-status"
        className="mt-2 grid gap-2"
      >
        {AUDIO_MODE_OPTIONS.map((option) => {
          const unavailable = option.requiresSourceAudio && sourceAudioDetected !== true
          const checked = value === option.value
          return (
            <label
              key={option.value}
              className={`relative flex gap-3 rounded-lg border px-3 py-3 transition-colors ${
                checked
                  ? 'border-cyan-300/45 bg-cyan-300/[0.075]'
                  : 'border-white/10 bg-white/[0.025]'
              } ${
                disabled || unavailable
                  ? 'cursor-not-allowed opacity-45'
                  : 'cursor-pointer hover:border-cyan-300/30 hover:bg-cyan-300/[0.045]'
              }`}
            >
              <input
                type="radio"
                name="depth-rebuild-source-audio-mode"
                value={option.value}
                checked={checked}
                disabled={disabled || unavailable}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-300"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-stone-100">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-stone-500">
                  {option.description}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
