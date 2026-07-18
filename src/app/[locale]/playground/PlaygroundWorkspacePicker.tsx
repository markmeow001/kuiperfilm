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

export function PlaygroundWorkspacePicker({ workspaceId }: { workspaceId: string | null }) {
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
    <label className="flex items-center gap-2 text-xs text-text-tertiary">
      <span className="hidden md:inline">生成记录</span>
      <select
        aria-label="Playground 工作区"
        value={workspaceId ?? ''}
        disabled={error}
        onChange={(event) => select(event.target.value)}
        className="h-9 max-w-44 rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 text-sm text-text-primary outline-none transition-colors focus:border-primary-500/50 disabled:opacity-40"
      >
        <option value="">个人</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>
  )
}
