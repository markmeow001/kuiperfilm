'use client'

import { AppIcon } from '@/components/ui/icons'
import styles from './LiveCompositeShell.module.css'

export type LiveCompositeMode = 'depth-rebuild' | 'mask-composite'

interface LiveCompositeModeSelectorProps {
  value: LiveCompositeMode
  onChange: (mode: LiveCompositeMode) => void
  disabled?: boolean
}

const MODES: ReadonlyArray<{
  value: LiveCompositeMode
  label: string
  description: string
  badge: string
  icon: 'sparklesAlt' | 'brush'
}> = [
  {
    value: 'depth-rebuild',
    label: 'AI 深度重建',
    description: '換演員、服裝與場景，不必先畫人物遮罩。',
    badge: '推薦',
    icon: 'sparklesAlt',
  },
  {
    value: 'mask-composite',
    label: '精修遮罩合成',
    description: '保留原演員像素，逐段檢查頭髮、手指與遮擋。',
    badge: '進階',
    icon: 'brush',
  },
]

export function LiveCompositeModeSelector({
  value,
  onChange,
  disabled = false,
}: LiveCompositeModeSelectorProps) {
  return (
    <div
      className={styles.modeNav}
      role="radiogroup"
      aria-label="實拍處理方式"
      data-live-composite-mode-nav
    >
      {MODES.map((mode) => {
        const selected = value === mode.value
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${mode.label}：${mode.description}`}
            title={mode.description}
            disabled={disabled}
            onClick={() => onChange(mode.value)}
            className={`${styles.modeButton} ${selected ? styles.modeButtonActive : ''}`.trim()}
          >
            <AppIcon name={mode.icon} className={styles.modeIcon} />
            <span className={styles.modeLabel}>{mode.label}</span>
            <span className={styles.modeBadge}>{mode.badge}</span>
          </button>
        )
      })}
    </div>
  )
}
