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

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { queryKeys } from '@/lib/query/keys'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'
import { useEpisodePreservingHref } from '../hooks/useEpisodePreservingHref'
import { BulkEpisodeUploadButton } from './BulkEpisodeUploadButton'

interface V2ScriptClientProps {
  projectId: string
  locale?: string
}

interface NovelDataLike {
  novelText?: string | null
  episodes?: Array<{ id: string; episodeNumber?: number | null; novelText?: string | null }> | null
}

interface ProjectDataLike {
  novelPromotionData?: NovelDataLike | null
}

export function V2ScriptClient({ projectId, locale = 'zh-TW' }: V2ScriptClientProps) {
  const t = useTranslations('v2Script')
  const queryClient = useQueryClient()
  const projectQuery = useProjectData(projectId)
  const project = projectQuery.data as ProjectDataLike | undefined
  const novelData = project?.novelPromotionData ?? null
  const { currentEpisodeId, currentEpisode, episodes } = useCurrentEpisode(projectId)
  const buildHref = useEpisodePreservingHref()
  // Phase 12.5 — viewer-role users see disabled buttons + a hint tooltip.
  const { canEdit } = useProjectAccess(projectId)
  const viewerTip = canEdit ? undefined : t('viewerHint')

  const [novelText, setNovelText] = useState('')
  const [savedText, setSavedText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creatingEpisode, setCreatingEpisode] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Re-sync textarea when the active episode changes via the tab bar.
  useEffect(() => {
    if (!novelData) return
    const text = currentEpisode?.novelText ?? novelData.novelText ?? ''
    setNovelText(text)
    setSavedText(text)
    setErrorMsg(null)
  }, [currentEpisodeId, currentEpisode?.novelText, novelData])

  async function ensureEpisode(): Promise<string | null> {
    if (currentEpisodeId) return currentEpisodeId
    setCreatingEpisode(true)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('firstEpisodeName') }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setErrorMsg(t('errors.createEpisode', { status: res.status, detail: text || t('errors.unknown') }))
        return null
      }
      const json = (await res.json()) as { episode?: { id?: string } }
      const newId = json.episode?.id ?? null
      if (!newId) {
        setErrorMsg(t('errors.createEpisodeNoId'))
        return null
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      return newId
    } catch (err) {
      setErrorMsg(t('errors.createEpisodeException', { reason: (err as Error).message }))
      return null
    } finally {
      setCreatingEpisode(false)
    }
  }

  async function saveTo(episodeId: string, text: string): Promise<boolean> {
    setSaving(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: text }),
      })
      if (!res.ok) {
        const text2 = await res.text().catch(() => '')
        setErrorMsg(t('errors.save', { status: res.status, detail: text2 || t('errors.unknown') }))
        return false
      }
      setSavedText(text)
      return true
    } catch (err) {
      setErrorMsg(t('errors.saveException', { reason: (err as Error).message }))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const id = await ensureEpisode()
    if (!id) return
    await saveTo(id, novelText)
    // Refresh project data so the episode tab bar picks up the new row
    // when this was a first-time create.
    if (id !== currentEpisodeId) {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    }
  }

  function handleBlur() {
    if (!currentEpisodeId) return
    if (savedText === novelText) return
    void saveTo(currentEpisodeId, novelText)
  }

  if (projectQuery.isLoading) {
    return (
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">{t('loading')}</p>
      </div>
    )
  }

  const charCount = novelText.length
  const isDirty = savedText !== novelText
  const hasContent = novelText.trim().length > 0

  return (
    <div className="px-12 py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* Left column: paste + save */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-fraunces text-sm italic text-amber-500/80">
                {currentEpisode ? `${currentEpisode.name}` : t('noEpisodeSelected')}
              </div>
              <div className="mt-0.5 font-mono text-[14px] tracking-wider text-stone-600">
                {episodes.length === 0 ? t('promptCreate') : t('promptPaste')}
              </div>
            </div>
            <div className="flex items-center gap-3 font-mono text-[14px]">
              <BulkEpisodeUploadButton
                projectId={projectId}
                hasExistingEpisodes={episodes.length > 0}
                canEdit={canEdit}
                viewerTip={viewerTip}
              />
              <span className="text-stone-600">{t('chars', { count: charCount })}</span>
              {currentEpisodeId ? (
                saving ? (
                  <span className="text-amber-500/70">{t('saving')}</span>
                ) : isDirty && hasContent ? (
                  <span className="text-stone-500">{t('unsaved')}</span>
                ) : !isDirty && hasContent ? (
                  <span className="text-emerald-500/70">{t('savedOk')}</span>
                ) : null
              ) : null}
            </div>
          </div>

          <textarea
            value={novelText}
            onChange={(e) => setNovelText(e.target.value)}
            onBlur={handleBlur}
            readOnly={!canEdit}
            title={viewerTip}
            placeholder={
              currentEpisode
                ? t('placeholder.withEpisode', { ep: currentEpisode.episodeNumber ?? 1 })
                : t('placeholder.withoutEpisode')
            }
            className={`h-[420px] w-full resize-none rounded-sm border border-amber-900/30 bg-stone-950 px-5 py-4 font-serif-cn text-base leading-relaxed text-stone-200 placeholder:text-stone-700 focus:border-amber-500/60 focus:outline-none ${
              !canEdit ? 'cursor-not-allowed opacity-70' : ''
            }`}
          />

          {errorMsg ? (
            <p className="mt-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-sm text-rose-300">
              {errorMsg}
            </p>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || creatingEpisode || !hasContent || !isDirty || !canEdit}
              title={viewerTip}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="check" className="h-4 w-4" />
              {creatingEpisode ? t('save.creating') : saving ? t('save.saving') : t('save.label')}
            </button>

            {!isDirty && hasContent && currentEpisodeId ? (
              <Link
                href={buildHref(`/${locale}/v2/workspace/${projectId}/subjects`)}
                className="font-mono text-xs tracking-wider text-stone-500 transition-colors hover:text-amber-300"
              >
                {t('nextStep')}
              </Link>
            ) : null}
          </div>
        </div>

        {/* Right column: workflow guide */}
        <aside className="space-y-4 self-start rounded-sm border border-stone-800/60 bg-stone-900/30 p-5">
          <div>
            <div className="mb-1 font-fraunces text-sm italic text-amber-500/80">{t('workflow.title')}</div>
            <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-stone-600">
              {t('workflow.summary')}
            </div>
          </div>
          <ol className="space-y-3 font-serif-cn text-xs leading-relaxed text-stone-400">
            <li>
              <span className="mr-2 font-mono text-amber-500/70">01</span>
              {t.rich('workflow.step1', { em: (chunks) => <span className="text-amber-300">{chunks}</span> })}
            </li>
            <li>
              <span className="mr-2 font-mono text-amber-500/70">02</span>
              {t.rich('workflow.step2', { em: (chunks) => <span className="text-amber-300">{chunks}</span> })}
            </li>
            <li>
              <span className="mr-2 font-mono text-amber-500/70">03</span>
              {t.rich('workflow.step3', { em: (chunks) => <span className="text-amber-300">{chunks}</span> })}
            </li>
            <li>
              <span className="mr-2 font-mono text-amber-500/70">04</span>
              {t.rich('workflow.step4', { em: (chunks) => <span className="text-amber-300">{chunks}</span> })}
            </li>
          </ol>
          <div className="border-t border-stone-800/60 pt-3 font-fraunces text-[11px] italic text-stone-600">
            {t('workflow.footerPrefix')}<Link href={`/${locale}/v2/workspace/${projectId}?stay=1`} className="ml-1 text-amber-500/80 hover:text-amber-300">{t('workflow.footerLink')}</Link>{t('workflow.footerSuffix')}
          </div>
        </aside>
      </div>
    </div>
  )
}
