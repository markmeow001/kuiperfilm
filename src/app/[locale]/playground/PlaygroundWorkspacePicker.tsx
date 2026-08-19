'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface WorkspaceOption {
  id: string
  name: string
}

interface RawWorkspace {
  id?: unknown
  name?: unknown
}

function normalizeWorkspaces(payload: unknown): WorkspaceOption[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const root = payload as { workspaces?: unknown; workspaceMemberships?: unknown }
  const combined = [root.workspaces, root.workspaceMemberships]
    .flatMap((value) => Array.isArray(value) ? value : []) as RawWorkspace[]
  const seen = new Set<string>()
  const result: WorkspaceOption[] = []
  for (const item of combined) {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || seen.has(item.id)) continue
    seen.add(item.id)
    result.push({ id: item.id, name: item.name })
  }
  return result
}

interface PlaygroundWorkspacePickerProps {
  workspaceId: string | null
  label: string
  historyLabel: string
  personalLabel: string
}

export function PlaygroundWorkspacePicker({
  workspaceId,
  label,
  historyLabel,
  personalLabel,
}: PlaygroundWorkspacePickerProps) {
  const router = useRouter()
  const [options, setOptions] = useState<WorkspaceOption[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/workspaces', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setOptions(normalizeWorkspaces(await response.json()))
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(true)
      })
    return () => controller.abort()
  }, [])

  function select(nextWorkspaceId: string) {
    const url = new URL(window.location.href)
    if (nextWorkspaceId) url.searchParams.set('ws', nextWorkspaceId)
    else url.searchParams.delete('ws')
    router.replace(`${url.pathname}${url.search}`)
  }

  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--darkroom-muted)]">
      <span className="hidden lg:inline">{historyLabel}</span>
      <select
        aria-label={label}
        value={workspaceId ?? ''}
        disabled={error}
        onChange={(event) => select(event.target.value)}
        className="min-h-11 min-w-0 max-w-44 rounded-lg border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] px-3 text-[13px] text-[var(--darkroom-text)] outline-none transition-colors focus-visible:border-[var(--process-cyan)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)] disabled:opacity-40"
      >
        <option value="">{personalLabel}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}
