'use client'

/**
 * Phase 12.x.x / Stage B — v2 ScriptPage stripped to paste + save.
 *
 * Per the unified flow agreed with the user:
 *   - ScriptPage's only job is "貼劇本 + 存檔" per episode.
 *   - 畫面比例 + 風格 moved up to project home (V2ProjectSettingsPanel).
 *   - The AI analyze pipeline is no longer triggered here — Subjects step
 *     (Stage C) and Storyboard step (Stage D) get their own dedicated
 *     analyze CTAs.
 *
 * Behaviour:
 *   - Textarea hydrates from current episode's novelText (URL-driven via
 *     useCurrentEpisode); switching episodes via the tab bar re-syncs.
 *   - "儲存" button writes to /api/novel-promotion/[projectId]/episodes/[id]
 *     PATCH. Auto-creates the first episode if none exists yet (safety net
 *     for users who type before clicking "+ 新建劇集" in the tab bar).
 *   - Auto-save on blur is preserved as a courtesy; the explicit button is
 *     the supported commit path.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'
import { BulkEpisodeUploadButton } from './BulkEpisodeUploadButton'
import { ScreenplayWorkspace, type ScreenplaySaveState } from './ScreenplayWorkspace'
import {
  useScreenplayDraftController,
  type ScreenplayDraftSnapshot,
  type ScreenplaySaveIssue,
  type ScreenplaySaveIssueKind,
} from './useScreenplayDraftController'
import styles from '../PlanningWorkspace.module.css'

interface V2ScriptClientProps {
  projectId: string
  locale?: string
}

interface PendingFirstSaveRecovery {
  snapshot: ScreenplayDraftSnapshot
  targetEpisodeId: string | null
  issue: ScreenplaySaveIssue
}

export function V2ScriptClient({ projectId, locale = 'zh-TW' }: V2ScriptClientProps) {
  const t = useTranslations('v2Script')
  const router = useRouter()
  const projectQuery = useProjectData(projectId)
  const { currentEpisodeId, currentEpisode, episodes } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  // Phase 12.5 — viewer-role users see disabled buttons + a hint tooltip.
  const access = useProjectAccess(projectId)
  const { canEdit } = access
  const viewerTip = canEdit ? undefined : t('viewerHint')

  const [creatingEpisode, setCreatingEpisode] = useState(false)
  const [pendingFirstSaveRecovery, setPendingFirstSaveRecovery] = useState<PendingFirstSaveRecovery | null>(null)
  const pendingFirstEpisodeIdRef = useRef<string | null>(null)
  const draft = useScreenplayDraftController({
    projectId,
    episodeId: currentEpisodeId,
    // An empty episode is intentionally empty. Do not inherit legacy
    // project-level novelText into a selected episode.
    sourceText: currentEpisode?.novelText ?? '',
    canEdit,
  })

  useEffect(() => {
    if (currentEpisodeId && currentEpisodeId === pendingFirstEpisodeIdRef.current) {
      pendingFirstEpisodeIdRef.current = null
    }
  }, [currentEpisodeId])

  function rememberFirstSaveIssue(
    snapshot: ScreenplayDraftSnapshot,
    issue: ScreenplaySaveIssue,
    targetEpisodeId: string | null = null,
  ) {
    setPendingFirstSaveRecovery({ snapshot, issue, targetEpisodeId })
    draft.reportIssue(issue, snapshot)
  }

  async function ensureEpisode(snapshot: ScreenplayDraftSnapshot): Promise<string | null> {
    if (snapshot.episodeId) return snapshot.episodeId
    // If creation succeeded but the first PATCH did not, retry that same
    // server episode instead of creating a duplicate before the project
    // query has had a successful refresh.
    if (pendingFirstEpisodeIdRef.current) return pendingFirstEpisodeIdRef.current
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      rememberFirstSaveIssue(snapshot, { kind: 'offline' })
      return null
    }
    setCreatingEpisode(true)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('firstEpisodeName') }),
      })
      if (!res.ok) {
        rememberFirstSaveIssue(
          snapshot,
          res.status >= 500
            ? { kind: 'create-unknown', status: res.status }
            : issueForStatus(res.status),
        )
        return null
      }
      let json: { episode?: { id?: string } }
      try {
        json = (await res.json()) as { episode?: { id?: string } }
      } catch {
        rememberFirstSaveIssue(snapshot, { kind: 'create-unknown' })
        return null
      }
      const newId = json.episode?.id ?? null
      if (!newId) {
        rememberFirstSaveIssue(snapshot, { kind: 'create-unknown' })
        return null
      }
      pendingFirstEpisodeIdRef.current = newId
      return newId
    } catch (error) {
      rememberFirstSaveIssue(snapshot, {
        kind: typeof navigator !== 'undefined' && navigator.onLine === false
          ? 'offline'
          : error instanceof TypeError
            ? 'create-unknown'
            : 'server',
      })
      return null
    } finally {
      setCreatingEpisode(false)
    }
  }

  async function handleSave() {
    if (!canEdit) return
    const snapshot = draft.captureSnapshot()
    // Existing episodes enter the episode-scoped controller immediately.
    // Avoid yielding through ensureEpisode(), otherwise a very fast episode
    // switch can make the pending save borrow the newly selected tab's draft.
    if (snapshot.episodeId) {
      const result = await draft.saveToEpisode(snapshot.episodeId, snapshot)
      if (result.ok && pendingFirstSaveRecovery?.targetEpisodeId === snapshot.episodeId) {
        // A newer explicit save supersedes the older failed first-save
        // snapshot. Leaving that recovery visible could later overwrite the
        // newly saved version with stale text.
        setPendingFirstSaveRecovery(null)
      }
      return
    }
    await persistFirstSnapshot(snapshot)
  }

  async function persistFirstSnapshot(
    snapshot: ScreenplayDraftSnapshot,
    knownEpisodeId?: string | null,
    verifiedIssue?: 'session' | 'access' | 'create-unknown',
  ) {
    const id = knownEpisodeId ?? await ensureEpisode(snapshot)
    if (!id) return
    draft.adoptSnapshotForEpisode(id, snapshot)
    const result = await draft.saveToEpisode(id, snapshot, verifiedIssue)
    if (result.ok) {
      setPendingFirstSaveRecovery(null)
      return
    }
    if (result.issue) rememberFirstSaveIssue(snapshot, result.issue, id)
  }

  function handleBlur() {
    if (!currentEpisodeId || !draft.canSave) return
    void draft.saveToEpisode(currentEpisodeId)
  }

  async function handleIssueRecovery() {
    const pendingRecovery = pendingFirstSaveRecovery
    if (pendingRecovery?.issue.kind === 'create-unknown') {
      const { snapshot } = pendingRecovery
      const hadCurrentEpisodeBeforeReconcile = currentEpisodeId !== null
      const result = await projectQuery.refetch()
      const reconciledEpisodeIds = verifiedEpisodeIds(result)
      if (!reconciledEpisodeIds || reconciledEpisodeIds.length > 1) return
      // Another tab/add flow already selected an episode before reconciliation.
      // A sole returned id may belong to that independent action, not the
      // response-lost auto-create. Never guess and overwrite it.
      if (hadCurrentEpisodeBeforeReconcile) return
      if (reconciledEpisodeIds[0]) {
        pendingFirstEpisodeIdRef.current = reconciledEpisodeIds[0]
        draft.adoptSnapshotForEpisode(reconciledEpisodeIds[0], snapshot)
        await persistFirstSnapshot(snapshot, reconciledEpisodeIds[0], 'create-unknown')
        return
      }
      // Zero episodes proves the POST did not commit. Clear the block but
      // leave the next POST to a separate, explicit Save action.
      draft.clearBlockingIssue('create-unknown')
      setPendingFirstSaveRecovery(null)
      return
    }
    const effectiveIssue = pendingRecovery?.issue ?? draft.issue
    const recoverySnapshot = pendingRecovery?.targetEpisodeId
      ? draft.captureSnapshotForEpisode(pendingRecovery.targetEpisodeId)
      : pendingRecovery
        ? currentEpisodeId === null
          ? draft.captureSnapshot()
          : pendingRecovery.snapshot
        : undefined
    const blockingKind = effectiveIssue?.kind === 'session' || effectiveIssue?.kind === 'access'
      ? effectiveIssue.kind
      : null
    if (blockingKind) {
      const result = await access.refetch()
      // Re-enable save only when the existing read-only access endpoint has
      // positively verified both the session and current edit role. A failed,
      // null or viewer response leaves the draft and blocking issue untouched.
      if (hasVerifiedEditAccess(result)) {
        if (pendingRecovery && !recoverySnapshot) return
        draft.clearBlockingIssue(blockingKind)
        if (pendingRecovery && recoverySnapshot) {
          await persistFirstSnapshot(
            recoverySnapshot,
            pendingRecovery.targetEpisodeId,
            blockingKind,
          )
        }
      }
      return
    }
    if (pendingRecovery) {
      // If the target draft is no longer present locally, keep recovery
      // blocked. Replaying an older captured value could overwrite a newer
      // target version that this component can no longer verify.
      if (!recoverySnapshot) return
      await persistFirstSnapshot(recoverySnapshot, pendingRecovery.targetEpisodeId)
      return
    }
    await handleSave()
  }

  if (projectQuery.isLoading || access.isLoading) {
    return (
      <div className={`kuiper-screenplay min-h-full bg-[var(--production-paper)] px-[var(--workspace-gutter)] py-8 text-[var(--production-ink)] ${styles.planningRoot}`}>
        <UiStatePanel
          state="loading"
          locale={locale}
          title={t('states.loadingTitle')}
          description={t('states.loadingDescription')}
        />
      </div>
    )
  }

  if (projectQuery.isError && !projectQuery.data) {
    return (
      <div className={`kuiper-screenplay min-h-full bg-[var(--production-paper)] px-[var(--workspace-gutter)] py-8 text-[var(--production-ink)] ${styles.planningRoot}`}>
        <UiStatePanel
          state="error"
          locale={locale}
          title={t('states.loadErrorTitle')}
          description={t('states.loadErrorDescription')}
          details={projectQuery.error instanceof Error ? projectQuery.error.message : t('errors.unknown')}
          primaryAction={(
            <button
              type="button"
              onClick={() => void projectQuery.refetch()}
              className="kuiper-dashboard-primary min-h-11 px-4 text-[14px]"
            >
              {t('states.retry')}
            </button>
          )}
        />
      </div>
    )
  }

  if (access.isError) {
    return (
      <div className={`kuiper-screenplay min-h-full bg-[var(--production-paper)] px-[var(--workspace-gutter)] py-8 text-[var(--production-ink)] ${styles.planningRoot}`}>
        <UiStatePanel
          state="error"
          locale={locale}
          title={t('states.accessErrorTitle')}
          description={t('states.accessErrorDescription')}
          details={access.error?.message ?? t('errors.unknown')}
          primaryAction={(
            <button
              type="button"
              onClick={() => void access.refetch()}
              className="kuiper-dashboard-primary min-h-11 px-4 text-[14px]"
            >
              {t('states.accessRetry')}
            </button>
          )}
        />
      </div>
    )
  }

  if (!access.allowed) {
    return (
      <div className={`kuiper-screenplay min-h-full bg-[var(--production-paper)] px-[var(--workspace-gutter)] py-8 text-[var(--production-ink)] ${styles.planningRoot}`}>
        <UiStatePanel
          state="permission"
          locale={locale}
          title={t('states.permissionTitle')}
          description={t('states.permissionDescription')}
        />
      </div>
    )
  }

  const charCount = draft.value.length
  const hasContent = draft.value.trim().length > 0
  const activeIssue = pendingFirstSaveRecovery?.issue ?? draft.issue
  const saveState: ScreenplaySaveState = !canEdit
    ? 'readonly'
    : draft.isSaving || creatingEpisode
      ? 'saving'
      : draft.isDirty
        ? 'dirty'
        : !hasContent
          ? 'empty'
          : 'saved'
  const statusLabel = t(`status.${saveState}`)
  const nextPrerequisites = [
    { id: 'episode', label: t('next.requirements.episode'), met: Boolean(currentEpisodeId) },
    { id: 'content', label: t('next.requirements.content'), met: hasContent },
    {
      id: 'saved',
      label: t('next.requirements.saved'),
      met: hasContent && draft.exactSaved && !creatingEpisode,
    },
  ]
  const unmetRequirementCount = nextPrerequisites.filter((item) => !item.met).length
  const nextReady = unmetRequirementCount === 0 && !activeIssue
  const nextDisabledReason = !currentEpisodeId
    ? t('next.blocked.episode')
    : !hasContent
      ? t('next.blocked.empty')
      : draft.isSaving || creatingEpisode
        ? t('next.blocked.saving')
        : activeIssue
          ? t('next.blocked.saveFailed')
          : draft.isDirty
            ? t('next.blocked.unsaved')
            : undefined

  const issueCopy = activeIssue ? saveIssueCopy(activeIssue.kind, t) : null
  const backgroundRefreshMessage = projectQuery.isError && projectQuery.data
    ? t('states.refreshErrorDescription')
    : undefined

  return (
    <ScreenplayWorkspace
      locale={locale}
      episodeTitle={currentEpisode?.name ?? t('noEpisodeSelected')}
      episodeContext={currentEpisode
        ? t('episodeContext', {
            current: currentEpisode.episodeNumber,
            total: episodes.length,
          })
        : t('noEpisodeContext')}
      characterCountLabel={t('chars', { count: charCount })}
      statusLabel={statusLabel}
      saveState={saveState}
      value={draft.value}
      placeholder={currentEpisode
        ? t('placeholder.withEpisode', { ep: currentEpisode.episodeNumber ?? 1 })
        : t('placeholder.withoutEpisode')}
      canEdit={canEdit}
      viewerTip={viewerTip}
      saveDisabled={creatingEpisode || !draft.canSave}
      errorMessage={activeIssue ? t('states.draftPreserved') : null}
      backgroundRefreshMessage={backgroundRefreshMessage}
      bulkUpload={(
        <BulkEpisodeUploadButton
          projectId={projectId}
          existingEpisodeCount={episodes.length}
          canEdit={canEdit}
          viewerTip={viewerTip}
          tone="studio"
        />
      )}
      nextReady={nextReady}
      nextDisabledReason={nextDisabledReason}
      nextPrerequisites={nextPrerequisites}
      copy={{
        headerEyebrow: t('header.eyebrow'),
        headerDescription: episodes.length === 0 ? t('promptCreate') : t('promptPaste'),
        modesLabel: t('modes.label'),
        editorMode: t('modes.editor'),
        guideMode: t('modes.guide'),
        editorLabel: t('editor.label'),
        editorHint: t('editor.hint'),
        emptyHint: t('editor.emptyHint'),
        readOnlyTitle: t('editor.readOnlyTitle'),
        readOnlyDescription: t('editor.readOnlyDescription'),
        saveLabel: creatingEpisode ? t('save.creating') : t('save.label'),
        savingLabel: t('save.saving'),
        errorTitle: issueCopy?.title ?? t('states.saveErrorTitle'),
        errorDescription: issueCopy?.description ?? t('states.saveErrorDescription'),
        retrySaveLabel: issueCopy?.actionLabel ?? t('states.retrySave'),
        workflowEyebrow: t('workflow.eyebrow'),
        workflowTitle: t('workflow.title'),
        workflowSummary: t('workflow.summary'),
        workflowSteps: [1, 2, 3, 4].map((number) => ({
          id: `workflow-${number}`,
          content: t.rich(`workflow.step${number}`, {
            em: (chunks) => <strong>{chunks}</strong>,
          }),
        })),
        workflowFooter: (
          <>
            {t('workflow.footerPrefix')}
            <Link href={`/${locale}/v2/workspace/${projectId}?stay=1`} className="mx-1">
              {t('workflow.footerLink')}
            </Link>
            {t('workflow.footerSuffix')}
          </>
        ),
        nextEyebrow: t('next.eyebrow'),
        nextTitle: t('next.title'),
        nextDescription: t('next.description'),
        nextLabel: t('next.label'),
        prerequisitesLabel: t('next.prerequisitesLabel'),
        prerequisitesSummary: unmetRequirementCount === 0
          ? t('next.allComplete', { count: nextPrerequisites.length })
          : t('next.incomplete', { count: unmetRequirementCount }),
        metLabel: t('next.met'),
        unmetLabel: t('next.unmet'),
      }}
      onValueChange={draft.setValue}
      onEditorBlur={handleBlur}
      onSave={() => void handleSave()}
      onRetrySave={() => void handleIssueRecovery()}
      onNext={() => router.push(buildHref(`/${locale}/v2/workspace/${projectId}/subjects`))}
    />
  )
}

type Translate = (key: string) => string

function hasVerifiedEditAccess(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('data' in result)) return false
  const queryResult = result as { data?: unknown; isSuccess?: unknown; isError?: unknown }
  // React Query may retain the last successful data when a refetch fails.
  // Never treat that stale snapshot as a successful access re-verification.
  if (queryResult.isSuccess !== true || queryResult.isError === true) return false
  const data = queryResult.data
  if (!data || typeof data !== 'object') return false
  const access = data as { allowed?: unknown; canEdit?: unknown }
  return access.allowed === true && access.canEdit === true
}

function saveIssueCopy(kind: ScreenplaySaveIssueKind, t: Translate) {
  if (kind === 'offline') {
    return { title: t('states.offlineTitle'), description: t('states.offlineDescription') }
  }
  if (kind === 'session') {
    return {
      title: t('states.sessionTitle'),
      description: t('states.sessionDescription'),
      actionLabel: t('states.sessionAction'),
    }
  }
  if (kind === 'access') {
    return {
      title: t('states.accessChangedTitle'),
      description: t('states.accessChangedDescription'),
      actionLabel: t('states.accessChangedAction'),
    }
  }
  if (kind === 'network') {
    return { title: t('states.networkTitle'), description: t('states.networkDescription') }
  }
  if (kind === 'create-unknown') {
    return {
      title: t('states.createUnknownTitle'),
      description: t('states.createUnknownDescription'),
      actionLabel: t('states.createUnknownAction'),
    }
  }
  return { title: t('states.saveErrorTitle'), description: t('states.saveErrorDescription') }
}

function issueForStatus(status: number): ScreenplaySaveIssue {
  if (status === 401) return { kind: 'session', status }
  if (status === 403) return { kind: 'access', status }
  return { kind: 'server', status }
}

function verifiedEpisodeIds(result: unknown): string[] | null {
  if (!result || typeof result !== 'object') return null
  const queryResult = result as { data?: unknown; isSuccess?: unknown; isError?: unknown }
  if (queryResult.isSuccess !== true || queryResult.isError === true) return null
  const data = queryResult.data
  if (!data || typeof data !== 'object') return null
  const novelPromotionData = (data as { novelPromotionData?: unknown }).novelPromotionData
  if (!novelPromotionData || typeof novelPromotionData !== 'object') return null
  const episodes = (novelPromotionData as { episodes?: unknown }).episodes
  if (!Array.isArray(episodes)) return null
  const ids: string[] = []
  for (const episode of episodes) {
    if (!episode || typeof episode !== 'object') return null
    const id = (episode as { id?: unknown }).id
    if (typeof id !== 'string' || id.length === 0) return null
    ids.push(id)
  }
  return ids
}
