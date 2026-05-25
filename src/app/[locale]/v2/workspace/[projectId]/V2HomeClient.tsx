'use client'

/**
 * Phase 12 — v2 workspace home (project overview).
 *
 * Replaces the OPC/BCP mockup home with a per-project overview:
 *   - project name + creation date
 *   - 6-step progress checklist (read state from project data)
 *   - shortcut chips into each step
 *   - "繼續" CTA jumps to the highest unfinished step
 */

import Link from 'next/link'
import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useProjectCharacters, useProjectLocations } from '@/lib/query/hooks/useProjectAssets'
import { useStoryboards } from '@/lib/query/hooks/useStoryboards'
import { V2_STEPS, type V2StepId } from '@/components/v2/v2-types'
import { V2ProjectSettingsPanel } from './V2ProjectSettingsPanel'
import { ProjectCollaboratorsModal } from './ProjectCollaboratorsModal'

interface V2HomeClientProps {
  projectId: string
  locale: string
}

interface NovelData {
  novelText?: string | null
  videoModel?: string | null
  episodes?: Array<{ id: string; novelText?: string | null }> | null
}
interface ProjectShape {
  name?: string | null
  createdAt?: string | null
  novelPromotionData?: NovelData | null
  // Phase 12.5 — workspace assignment + optional eager-loaded workspace data
  workspaceId?: string | null
  workspace?: { id: string; name: string | null } | null
}

interface PanelLike {
  id: string
  imageUrl?: string | null
  videoUrl?: string | null
}

export function V2HomeClient({ projectId, locale }: V2HomeClientProps) {
  const projectQuery = useProjectData(projectId)
  // Phase 12.5 — show 協作者 management button only to owner / admin.
  // Other roles (ws_owner / editor / viewer) can see the project but
  // can't reshape its grant tree.
  const { role: accessRole } = useProjectAccess(projectId)
  const canManageCollaborators = accessRole === 'owner' || accessRole === 'admin'
  const [collabModalOpen, setCollabModalOpen] = useState(false)
  const charsQuery = useProjectCharacters(projectId)
  const locsQuery = useProjectLocations(projectId)
  const project = projectQuery.data as ProjectShape | undefined
  const firstEpisodeId = project?.novelPromotionData?.episodes?.[0]?.id ?? null
  const storyboardsQuery = useStoryboards(projectId, firstEpisodeId)
  const storyboardsData = storyboardsQuery.data as { storyboards?: Array<{ panels?: PanelLike[] }> } | undefined

  const allPanels = (storyboardsData?.storyboards ?? []).flatMap((s) => s.panels ?? [])
  const panelsWithImage = allPanels.filter((p) => p.imageUrl).length
  const panelsWithVideo = allPanels.filter((p) => p.videoUrl).length

  const charCount = charsQuery.data?.length ?? 0
  const locCount = locsQuery.data?.length ?? 0
  // v2 writes novelText to episodes[0].novelText (project.novelText is never
  // set because PATCH /api/novel-promotion/[id] silently drops the field).
  const episodeNovelText = project?.novelPromotionData?.episodes?.[0]?.novelText ?? null
  const projectNovelText = project?.novelPromotionData?.novelText ?? null
  const hasNovelText = Boolean((episodeNovelText ?? projectNovelText)?.trim())

  const stepStatus: Record<V2StepId, 'done' | 'in-progress' | 'todo'> = {
    home: 'done',
    script: hasNovelText ? 'done' : 'todo',
    subjects: charCount + locCount > 0 ? 'done' : 'todo',
    storyboard: panelsWithImage > 0 ? 'done' : allPanels.length > 0 ? 'in-progress' : 'todo',
    voice: 'todo',
    final: panelsWithVideo > 0 ? 'in-progress' : 'todo',
  }

  // Pick the first non-done step (excluding home) as "繼續" target.
  const nextStep =
    V2_STEPS.find((s) => s.id !== 'home' && stepStatus[s.id] !== 'done')?.id ?? 'final'

  const projectName = project?.name?.trim() ? project.name : '未命名劇本'

  return (
    <div className="px-12 py-10">
      <div className="max-w-5xl">
        <p className="mb-2 font-fraunces text-base italic text-amber-500/80">Project Overview</p>
        <h2 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
          《{projectName}》
        </h2>
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] tracking-wider text-stone-500">
          <span>PROJECT_ID · {projectId}</span>
          {canManageCollaborators ? (
            <button
              type="button"
              onClick={() => setCollabModalOpen(true)}
              className="rounded-sm border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/15"
              title="管理此專案的協作者 (per-project grant)"
            >
              👥 協作者
            </button>
          ) : null}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {V2_STEPS.filter((s) => s.id !== 'home').map((step) => {
            const status = stepStatus[step.id]
            const tone =
              status === 'done'
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : status === 'in-progress'
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-stone-800 bg-stone-900/30'
            const dot =
              status === 'done'
                ? 'bg-emerald-500'
                : status === 'in-progress'
                  ? 'bg-amber-500'
                  : 'bg-stone-700'
            return (
              <Link
                key={step.id}
                href={`/${locale}/v2/workspace/${projectId}/${step.id}`}
                className={`group relative flex items-center gap-4 rounded-sm border px-5 py-4 transition-all hover:-translate-y-0.5 ${tone}`}
              >
                <div className="font-mono text-[11px] tracking-[0.2em] text-stone-500">{step.num}</div>
                <AppIcon name={step.icon} className="h-5 w-5 text-stone-400" />
                <div className="flex-1">
                  <div className="font-serif-cn text-base text-stone-100">{step.label}</div>
                  <div className="font-fraunces text-[11px] italic text-stone-500">{step.subtitle}</div>
                </div>
                <span className={`h-2 w-2 rounded-full ${dot}`} />
              </Link>
            )
          })}
        </div>

        <div className="mt-10">
          <Link
            href={`/${locale}/v2/workspace/${projectId}/${nextStep}`}
            className="inline-flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400"
          >
            繼續到 {V2_STEPS.find((s) => s.id === nextStep)?.label} step
            <AppIcon name="chevronRight" className="h-4 w-4" />
          </Link>
        </div>

        {/* Project-level settings — videoRatio + style preset (Stage B) */}
        <div className="mt-10">
          <V2ProjectSettingsPanel projectId={projectId} />
        </div>

        <div className="mt-12 rounded-sm border border-stone-800/60 bg-stone-900/30 p-6">
          <div className="mb-3 font-fraunces text-sm italic text-amber-500/80">Stats</div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="角色" value={charCount} />
            <Stat label="場景" value={locCount} />
            <Stat label="分鏡" value={allPanels.length} />
            <Stat label="已生視頻" value={panelsWithVideo} />
          </dl>
        </div>
      </div>

      {collabModalOpen ? (
        <ProjectCollaboratorsModal
          projectId={projectId}
          workspaceId={project?.workspaceId ?? null}
          workspaceName={project?.workspace?.name ?? null}
          onClose={() => setCollabModalOpen(false)}
        />
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-serif-cn text-xs text-stone-500">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold text-amber-400">{value}</div>
    </div>
  )
}
