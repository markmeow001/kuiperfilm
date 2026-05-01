'use client'

import type { ComponentProps } from 'react'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { AppIcon } from '@/components/ui/icons'

interface ApiConfigToolbarProps {
  title: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  savingState: ComponentProps<typeof TaskStatusInline>['state'] | null
  savingLabel: string
  savedLabel: string
  saveFailedLabel: string
}

export function ApiConfigToolbar({
  title,
  saveStatus,
  savingState,
  savingLabel,
  savedLabel,
  saveFailedLabel,
}: ApiConfigToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-amber-900/15 px-8 py-5">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-600/80">
          API · CONFIG
        </div>
        <h2 className="mt-1 font-serif-cn text-2xl font-medium text-stone-100">{title}</h2>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {saveStatus === 'saving' && (
          <span className="flex items-center gap-1.5 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-serif-cn text-sm text-amber-300">
            <TaskStatusInline state={savingState} className="[&>span]:sr-only" />
            <span>{savingLabel}</span>
          </span>
        )}
        {saveStatus === 'saved' && (
          <span className="flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-serif-cn text-sm text-emerald-300">
            <AppIcon name="check" className="h-4 w-4" />
            {savedLabel}
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="flex items-center gap-1.5 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-serif-cn text-sm text-rose-300">
            <AppIcon name="close" className="h-4 w-4" />
            {saveFailedLabel}
          </span>
        )}
      </div>
    </div>
  )
}
