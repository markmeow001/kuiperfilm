'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { LiveCompositeProjectSummary } from '@/app/api/live-composite/lib/projects-contract'

interface ProjectPanelProps {
  projectName: string
  hasProject: boolean
  projects: LiveCompositeProjectSummary[]
  busyMessage: string | null
  error: string | null
  disabled: boolean
  onProjectNameChange: (name: string) => void
  onSave: () => void
  onOpen: (id: string) => void
  onRefreshList: () => void
}

export function ProjectPanel({
  projectName,
  hasProject,
  projects,
  busyMessage,
  error,
  disabled,
  onProjectNameChange,
  onSave,
  onOpen,
  onRefreshList,
}: ProjectPanelProps) {
  const [listOpen, setListOpen] = useState(false)
  const busy = busyMessage !== null

  return (
    <div className="relative flex items-center gap-2">
      <input
        aria-label="專案名稱"
        value={projectName}
        placeholder="未命名合成"
        disabled={disabled || busy}
        onChange={(event) => onProjectNameChange(event.target.value)}
        className="h-8 w-40 rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-stone-200 placeholder:text-stone-600 focus:border-cyan-400/50 focus:outline-none disabled:opacity-40"
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={onSave}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-cyan-400 px-3 text-xs font-medium text-stone-950 hover:bg-cyan-300 disabled:opacity-40"
      >
        <AppIcon name="cloudUpload" className="h-3.5 w-3.5" />
        {hasProject ? '儲存' : '儲存新專案'}
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          const next = !listOpen
          setListOpen(next)
          if (next) onRefreshList()
        }}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-stone-300 hover:bg-white/[0.06] disabled:opacity-40"
      >
        <AppIcon name="folderOpen" className="h-3.5 w-3.5" />開啟
      </button>

      {busy ? <span role="status" className="text-xs text-cyan-300">{busyMessage}</span> : null}
      {!busy && error ? <span role="alert" className="max-w-64 truncate text-xs text-red-300" title={error}>{error}</span> : null}

      {listOpen ? (
        <div className="absolute right-0 top-10 z-30 max-h-80 w-72 overflow-y-auto rounded-xl border border-white/10 bg-stone-950 p-2 shadow-2xl">
          <div className="px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-500">我的合成專案</div>
          {projects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-stone-500">尚未儲存過任何合成專案。</div>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setListOpen(false)
                  onOpen(project.id)
                }}
                className="flex w-full flex-col rounded-lg px-2 py-2 text-left hover:bg-white/[0.06]"
              >
                <span className="truncate text-xs text-stone-200">{project.name}</span>
                <span className="truncate text-[11px] text-stone-500">
                  {project.videoName ?? '（未綁定影片）'} · {new Date(project.updatedAt).toLocaleString('zh-TW')}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
