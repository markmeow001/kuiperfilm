/**
 * Phase 2.5 (2026-06-10) — Skill picker React Query hooks.
 *
 * useSkills(filters)                       — list with installation state
 * useSkill(slug)                            — detail incl. config
 * useInstallSkill()                         — POST install
 * useUpdateSkillInstallation()              — PATCH enable/disable
 * useUninstallSkill()                       — DELETE
 *
 * All four mutations invalidate the skills list cache on success so
 * any open Skill picker instances re-render with fresh state.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'

export interface SkillRow {
  id: string
  slug: string
  name: string
  nameEn: string | null
  description: string
  descriptionEn: string | null
  thumbnailUrl: string | null
  authorType: 'official' | 'community'
  authorDisplay: string
  isFeatured: boolean
  popularityScore: number
  installCount: number
  installed: boolean
  installationId: string | null
  enabled: boolean
  installedAt: string | null
}

export interface SkillDetail extends SkillRow {
  status: 'draft' | 'published' | 'archived'
  config: unknown
}

interface SkillFilters {
  installed?: boolean
  featured?: boolean
  workspaceId?: string | null
}

function buildListUrl(filters: SkillFilters): string {
  const sp = new URLSearchParams()
  if (typeof filters.installed === 'boolean') sp.set('installed', String(filters.installed))
  if (typeof filters.featured === 'boolean') sp.set('featured', String(filters.featured))
  if (filters.workspaceId) sp.set('workspaceId', filters.workspaceId)
  const qs = sp.toString()
  return `/api/skills${qs ? `?${qs}` : ''}`
}

export function useSkills(filters: SkillFilters = {}) {
  return useQuery({
    queryKey: queryKeys.skills.list(filters),
    queryFn: async (): Promise<{ skills: SkillRow[] }> => {
      const res = await fetch(buildListUrl(filters))
      if (!res.ok) throw new Error(`useSkills failed: ${res.status}`)
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useSkill(slug: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.skills.detail(slug ?? ''),
    enabled: Boolean(slug),
    queryFn: async (): Promise<{ skill: SkillDetail }> => {
      const res = await fetch(`/api/skills/${slug}`)
      if (!res.ok) throw new Error(`useSkill failed: ${res.status}`)
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useInstallSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (skillId: string) => {
      const res = await fetch('/api/skill-installations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      })
      if (!res.ok) throw new Error(`install failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.skills.all() })
    },
  })
}

export function useUpdateSkillInstallation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { installationId: string; enabled: boolean }) => {
      const res = await fetch(`/api/skill-installations/${args.installationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: args.enabled }),
      })
      if (!res.ok) throw new Error(`toggle failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.skills.all() })
    },
  })
}

export function useUninstallSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (installationId: string) => {
      const res = await fetch(`/api/skill-installations/${installationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`uninstall failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.skills.all() })
    },
  })
}
