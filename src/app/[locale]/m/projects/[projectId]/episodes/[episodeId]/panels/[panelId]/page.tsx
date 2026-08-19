'use client'

/**
 * /m/projects/:p/episodes/:e/panels/:pn — single-panel detail + edit.
 *
 * Phase 2 of mobile review portal. Phase 1 was read-only feed; this
 * page lets the user fix the most common issues from a phone:
 *   - tweak panel description (LLM mis-understood scene)
 *   - fix dialogue line content (typo / wrong speaker)
 *   - kick a re-gen for the image or video when the result is wrong
 *
 * Reuses existing v2 mutation hooks (useRegenerateProjectPanelImage,
 * useGenerateVideo, useUpdateProjectPanel) so the cache-invalidation
 * + task-overlay behavior stays consistent with desktop. Voice-line
 * editing hits PATCH /api/novel-promotion/:p/voice-lines directly
 * (no dedicated hook in the codebase yet — small enough to inline).
 *
 * Skipped on mobile: shotType / cameraMove chip groups, multi-shot
 * grouping, image upload (touch-camera flow is messy), candidate
 * selection. Author those on desktop.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import {
  useRegenerateProjectPanelImage,
  useUpdateProjectPanel,
} from '@/lib/query/mutations/storyboard-panel-mutations'
import { useGenerateVideo } from '@/lib/query/hooks/useStoryboards'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import { MobileVoiceDialogueEditor } from './MobileVoiceDialogueEditor'

interface PanelDetail {
  id: string
  panelIndex: number
  panelNumber: number | null
  storyboardId: string
  imageUrl: string | null
  videoUrl: string | null
  description: string | null
  shotType: string | null
  cameraMove: string | null
}

interface VoiceLine {
  id: string
  lineIndex: number
  speaker: string
  content: string
  matchedPanelId: string | null
}

interface StoryboardLike {
  id: string
  panels?: PanelDetail[]
}

export default function MobilePanelDetailPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams<{
    locale: string
    projectId: string
    episodeId: string
    panelId: string
  }>()
  const locale = params?.locale ?? 'zh'
  const projectId = params?.projectId ?? ''
  const episodeId = params?.episodeId ?? ''
  const panelId = params?.panelId ?? ''
  const tMobileDialogue = useTranslations('v2Voice.mobileDialogue')

  const projectQuery = useProjectData(projectId)
  const projectAccess = useProjectAccess(projectId)
  const canEdit = projectAccess.canEdit
  const project = projectQuery.data as { videoModel?: string | null } | undefined
  const projectVideoModel = project?.videoModel ?? null

  const regenImage = useRegenerateProjectPanelImage(projectId)
  const generateVideo = useGenerateVideo(projectId, episodeId)
  const updatePanel = useUpdateProjectPanel(projectId)

  const [panel, setPanel] = useState<PanelDetail | null>(null)
  const [dialogues, setDialogues] = useState<VoiceLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedToast, setSavedToast] = useState<string | null>(null)

  // local edit state — only flushed to server on save
  const [descDraft, setDescDraft] = useState('')
  const [descDirty, setDescDirty] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/${locale}/m/auth/signin`)
    }
  }, [status, router, locale])

  useEffect(() => {
    if (status !== 'authenticated' || !projectId || !episodeId || !panelId) return
    let alive = true
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [sbRes, vlRes] = await Promise.all([
          fetch(
            `/api/novel-promotion/${projectId}/storyboards?episodeId=${encodeURIComponent(episodeId)}`,
          ),
          fetch(
            `/api/novel-promotion/${projectId}/voice-lines?episodeId=${encodeURIComponent(episodeId)}`,
          ).catch(() => null),
        ])
        if (!sbRes.ok) throw new Error(`HTTP ${sbRes.status}`)
        const sb = (await sbRes.json()) as { storyboards?: StoryboardLike[] }
        const all = (sb.storyboards ?? []).flatMap((s) => s.panels ?? [])
        const found = all.find((p) => p.id === panelId) ?? null
        if (alive) {
          setPanel(found)
          setDescDraft(found?.description ?? '')
          setDescDirty(false)
        }
        if (vlRes && vlRes.ok) {
          const vl = (await vlRes.json()) as { voiceLines?: VoiceLine[] }
          if (alive) {
            setDialogues((vl.voiceLines ?? []).filter((d) => d.matchedPanelId === panelId))
          }
        }
      } catch (err) {
        if (alive) setError((err as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [status, projectId, episodeId, panelId])

  function flashSaved(msg: string) {
    setSavedToast(msg)
    setTimeout(() => setSavedToast(null), 2000)
  }

  async function handleSaveDescription() {
    if (!canEdit) return
    if (!panel || !descDirty) return
    try {
      await updatePanel.mutateAsync({
        panelId: panel.id,
        description: descDraft,
      })
      setPanel({ ...panel, description: descDraft })
      setDescDirty(false)
      flashSaved('描述已儲存')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleRegenImage() {
    if (!canEdit) return
    if (!panel) return
    const isFirstGen = !panel.imageUrl
    try {
      await regenImage.mutateAsync({ panelId: panel.id })
      flashSaved(isFirstGen ? '已送出生成圖片任務' : '已送出重新生成圖片任務')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleGenVideo() {
    if (!canEdit) return
    if (!panel) return
    if (!projectVideoModel) {
      setError('專案沒設定 videoModel，請到 desktop /v2 設定')
      return
    }
    try {
      await generateVideo.mutateAsync({
        storyboardId: panel.storyboardId,
        panelIndex: panel.panelIndex,
        panelId: panel.id,
        videoModel: projectVideoModel,
      })
      flashSaved('已送出生成影片任務')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleSaveDialogue(line: VoiceLine, content: string) {
    if (!canEdit) return
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/voice-lines`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, lineId: line.id, content }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDialogues((prev) =>
        prev.map((d) => (d.id === line.id ? { ...d, content } : d)),
      )
      flashSaved('對白已儲存')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const indexStr = useMemo(() => {
    if (!panel) return '—'
    // Display panelNumber when available (1-indexed, what users
    // expect), otherwise fall back to panelIndex+1 to avoid the
    // confusing "PANEL 00" we used to show for first-in-storyboard
    // panels (panelIndex=0 padded to "00").
    const display = typeof panel.panelNumber === 'number' && panel.panelNumber > 0
      ? panel.panelNumber
      : panel.panelIndex + 1
    return String(display).padStart(2, '0')
  }, [panel])

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center">
        <div className="font-fraunces text-sm italic text-stone-500">載入中…</div>
      </main>
    )
  }
  if (status === 'unauthenticated') return null

  if (!panel) {
    return (
      <main className="px-4 pb-20 pt-6">
        <Link
          href={`/${locale}/m/projects/${projectId}/episodes/${episodeId}`}
          className="font-mono text-[10px] tracking-[0.3em] text-stone-500 active:text-amber-500"
        >
          ← BACK TO EPISODE
        </Link>
        <div className="mt-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-3 font-serif-cn text-sm text-rose-300">
          找不到這個 panel
        </div>
      </main>
    )
  }

  return (
    <main className="px-4 pb-20 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href={`/${locale}/m/projects/${projectId}/episodes/${episodeId}`}
          className="font-mono text-[10px] tracking-[0.3em] text-stone-500 active:text-amber-500"
        >
          ← EPISODE
        </Link>
        <div className="font-mono text-[10px] tracking-wider text-amber-500/80">
          PANEL {indexStr}
        </div>
      </header>

      {/* media */}
      <div className="relative mb-5 aspect-video overflow-hidden rounded-sm border border-amber-900/30 bg-stone-900">
        {panel.videoUrl ? (
          <video
            src={panel.videoUrl}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full bg-stone-950"
          />
        ) : panel.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={panel.imageUrl}
            alt={`Panel ${indexStr}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-fraunces text-sm italic text-stone-600">
            尚未生成
          </div>
        )}
      </div>

      {/* regen actions */}
      {canEdit ? <div className="mb-6 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleRegenImage}
          disabled={regenImage.isPending}
          className="h-12 rounded-sm border border-amber-900/40 bg-stone-900/60 font-serif-cn text-sm text-amber-300 active:bg-stone-900 disabled:opacity-50"
        >
          {regenImage.isPending
            ? '提交中…'
            : panel.imageUrl
              ? '↻ 重新生成圖片'
              : '✨ 生成圖片'}
        </button>
        <button
          type="button"
          onClick={handleGenVideo}
          disabled={generateVideo.isPending || !panel.imageUrl}
          title={!panel.imageUrl ? '需要先有圖片' : ''}
          className="h-12 rounded-sm bg-amber-500 font-serif-cn text-sm font-medium text-stone-950 active:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generateVideo.isPending
            ? '提交中…'
            : panel.videoUrl
              ? '↻ 重新生成影片'
              : '▶ 生成影片'}
        </button>
      </div> : null}

      {/* shot meta (read-only on mobile) */}
      {(panel.shotType || panel.cameraMove) ? (
        <div className="mb-4 rounded-sm border border-stone-800/60 bg-stone-950/40 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
            鏡頭 (desktop 編輯)
          </div>
          <div className="mt-1 font-serif-cn text-sm text-stone-300">
            {[panel.shotType, panel.cameraMove].filter(Boolean).join(' · ')}
          </div>
        </div>
      ) : null}

      {/* description editor */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <label
            htmlFor="desc"
            className="font-mono text-[10px] uppercase tracking-wider text-stone-500"
          >
            描述
          </label>
          {canEdit && descDirty ? (
            <button
              type="button"
              onClick={() => {
                setDescDraft(panel.description ?? '')
                setDescDirty(false)
              }}
              className="font-mono text-[10px] tracking-wider text-stone-500 active:text-stone-300"
            >
              取消變更
            </button>
          ) : null}
        </div>
        <textarea
          id="desc"
          value={descDraft}
          readOnly={!canEdit}
          onChange={(e) => {
            if (!canEdit) return
            setDescDraft(e.target.value)
            setDescDirty(e.target.value !== (panel.description ?? ''))
          }}
          rows={5}
          className="w-full rounded-sm border border-stone-800 bg-stone-950 px-3 py-3 font-serif-cn text-base text-stone-100 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
          placeholder="這個鏡頭發生什麼…"
        />
        {canEdit ? <button
          type="button"
          onClick={handleSaveDescription}
          disabled={!descDirty || updatePanel.isPending}
          className="mt-3 h-11 w-full rounded-sm bg-amber-500 font-serif-cn text-base font-medium text-stone-950 active:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updatePanel.isPending ? '儲存中…' : descDirty ? '儲存描述' : '已儲存'}
        </button> : null}
      </section>

      {/* dialogue editor */}
      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-stone-500">
          <span>{tMobileDialogue('title')}</span>
          {!canEdit ? <span>{tMobileDialogue('readOnly')}</span> : null}
        </div>
        {dialogues.length === 0 ? (
          <div className="rounded-sm border border-stone-800/60 bg-stone-950/40 px-3 py-3 font-fraunces text-xs italic text-stone-500">
            這個 panel 沒有對白
          </div>
        ) : (
          <ul className="space-y-3">
            {dialogues.map((line) => (
              <MobileVoiceDialogueEditor
                key={line.id}
                line={line}
                canEdit={canEdit}
                labels={{
                  contentLabel: tMobileDialogue('contentLabel', { speaker: line.speaker }),
                  cancel: tMobileDialogue('cancel'),
                  save: tMobileDialogue('save'),
                  saving: tMobileDialogue('saving'),
                }}
                onSave={(content) => handleSaveDialogue(line, content)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* error / toast */}
      {error ? (
        <div className="fixed inset-x-4 bottom-4 z-50 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-3 font-serif-cn text-sm text-rose-300 shadow-2xl">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 font-mono text-[10px] uppercase tracking-wider text-rose-200/80"
          >
            關閉
          </button>
        </div>
      ) : null}
      {savedToast && !error ? (
        <div className="fixed inset-x-4 bottom-4 z-50 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-center font-serif-cn text-sm text-emerald-200 shadow-2xl">
          ✓ {savedToast}
        </div>
      ) : null}
    </main>
  )
}
