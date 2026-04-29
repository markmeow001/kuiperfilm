'use client'

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

type ThemeChoice = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'kuiper-theme'

function readStoredChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function applyChoice(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
}

function nextChoice(current: ThemeChoice): ThemeChoice {
  if (current === 'light') return 'dark'
  if (current === 'dark') return 'system'
  return 'light'
}

function iconNameFor(choice: ThemeChoice): 'sun' | 'moon' | 'sparkles' {
  if (choice === 'light') return 'sun'
  if (choice === 'dark') return 'moon'
  return 'sparkles'
}

function labelFor(choice: ThemeChoice): string {
  if (choice === 'light') return '亮色'
  if (choice === 'dark') return '暗色'
  return '跟隨系統'
}

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = readStoredChoice()
    setChoice(stored)
    setMounted(true)
  }, [])

  function handleClick(): void {
    const next = nextChoice(choice)
    setChoice(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    applyChoice(next)
  }

  // Render a fixed light-mode placeholder until hydration, so SSR
  // markup matches and we don't flash an icon mismatch.
  const display: ThemeChoice = mounted ? choice : 'system'

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`主題:${labelFor(display)}(點擊循環:亮色 → 暗色 → 跟隨系統)`}
      aria-label={`切換主題,目前:${labelFor(display)}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-ghost-hover-bg)] hover:text-[var(--glass-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-stroke-focus)]"
    >
      <AppIcon name={iconNameFor(display)} className="h-4 w-4" />
      <span className="sr-only">{labelFor(display)}</span>
    </button>
  )
}
