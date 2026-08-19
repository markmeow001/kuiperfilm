'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { UserRole } from '@/lib/auth/user-role'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useProjectProps } from '@/lib/query/hooks/useProjectAssets'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import { ProjectHomeContent } from './ProjectHomeContent'
import { V2ProjectSettingsPanel } from './V2ProjectSettingsPanel'
import { ProjectCollaboratorsModal } from './ProjectCollaboratorsModal'
import { ProjectAuditLogModal } from './ProjectAuditLogModal'
import { buildProjectHomeModel, type ProjectHomeProject } from './project-home-model'
import { useProjectHomeEpisodes } from './useProjectHomeEpisodes'

interface V2HomeClientProps {
  projectId: string
  locale: string
}

function StatePage({ children }: { children: ReactNode }) {
  return (
    <div className="kuiper-dashboard min-h-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">{children}</div>
    </div>
  )
}

export function V2HomeClient({ projectId, locale }: V2HomeClientProps) {
  const t = useTranslations('v2Production.projectStates')
  const projectQuery = useProjectData(projectId)
  const access = useProjectAccess(projectId)
  const episodesQuery = useProjectHomeEpisodes(projectId)
  const propsQuery = useProjectProps(projectId)
  const [collabModalOpen, setCollabModalOpen] = useState(false)
  const [auditModalOpen, setAuditModalOpen] = useState(false)

  if (access.isLoading || projectQuery.isLoading) {
    return (
      <StatePage>
        <UiStatePanel
          state="loading"
          locale={locale}
          title={t('loadingTitle')}
          description={t('loadingDescription')}
        />
      </StatePage>
    )
  }

  if (access.isError) {
    return (
      <StatePage>
        <UiStatePanel
          state="error"
          locale={locale}
          title={t('accessErrorTitle')}
          description={t('accessErrorDescription')}
          details={access.error?.message ?? t('accessErrorUnknown')}
          primaryAction={
            <button
              type="button"
              className="kuiper-dashboard-primary px-4 text-[14px]"
              onClick={() => void access.refetch()}
            >
              {t('accessRetry')}
            </button>
          }
        />
      </StatePage>
    )
  }

  if (!access.allowed) {
    return (
      <StatePage>
        <UiStatePanel
          state="permission"
          locale={locale}
          title={t('permissionTitle')}
          description={t('permissionDescription')}
          primaryAction={
            <button
              type="button"
              className="kuiper-dashboard-primary px-4 text-[14px]"
              onClick={() => void access.refetch()}
            >
              {t('permissionRetry')}
            </button>
          }
        />
      </StatePage>
    )
  }

  if (projectQuery.isError && !projectQuery.data) {
    const message = projectQuery.error instanceof Error
      ? projectQuery.error.message
      : t('projectErrorUnknown')
    return (
      <StatePage>
        <UiStatePanel
          state="error"
          locale={locale}
          title={t('projectErrorTitle')}
          description={t('projectErrorDescription')}
          details={message}
          primaryAction={
            <button
              type="button"
              className="kuiper-dashboard-primary px-4 text-[14px]"
              onClick={() => void projectQuery.refetch()}
            >
              {t('reload')}
            </button>
          }
        />
      </StatePage>
    )
  }

  if (!projectQuery.data) {
    return (
      <StatePage>
        <UiStatePanel
          state="error"
          locale={locale}
          title={t('missingTitle')}
          description={t('missingDescription')}
        />
      </StatePage>
    )
  }

  const project = projectQuery.data as ProjectHomeProject
  const episodes = episodesQuery.data ?? null
  const propsCount = propsQuery.data?.length ?? null
  const model = buildProjectHomeModel(project, episodes, propsCount)
  const canManageCollaborators = access.role === UserRole.OWNER || access.role === UserRole.ADMIN
  const partialIssues: string[] = []
  if (projectQuery.isError) {
    partialIssues.push(
      projectQuery.error instanceof Error
        ? t('projectIssue', { message: projectQuery.error.message })
        : t('projectIssueUnknown'),
    )
  }
  if (episodesQuery.isError) {
    partialIssues.push(
      episodesQuery.error instanceof Error
        ? t('episodeIssue', { message: episodesQuery.error.message })
        : t('episodeIssueUnknown'),
    )
  }
  if (propsQuery.isError) {
    partialIssues.push(
      propsQuery.error instanceof Error
        ? t('propIssue', { message: propsQuery.error.message })
        : t('propIssueUnknown'),
    )
  }

  return (
    <>
      <ProjectHomeContent
        project={project}
        projectId={projectId}
        locale={locale}
        episodes={episodes}
        model={model}
        canEdit={access.canEdit}
        canManageCollaborators={canManageCollaborators}
        isSupplementalLoading={
          (episodesQuery.isLoading && episodesQuery.data === undefined)
          || (propsQuery.isLoading && propsQuery.data === undefined)
        }
        partialIssues={partialIssues}
        settingsPanel={<V2ProjectSettingsPanel projectId={projectId} />}
        onOpenCollaborators={() => setCollabModalOpen(true)}
        onOpenAudit={() => setAuditModalOpen(true)}
      />

      {collabModalOpen ? (
        <ProjectCollaboratorsModal
          projectId={projectId}
          workspaceId={project.workspaceId ?? null}
          onClose={() => setCollabModalOpen(false)}
        />
      ) : null}

      {auditModalOpen ? (
        <ProjectAuditLogModal
          projectId={projectId}
          onClose={() => setAuditModalOpen(false)}
        />
      ) : null}
    </>
  )
}
