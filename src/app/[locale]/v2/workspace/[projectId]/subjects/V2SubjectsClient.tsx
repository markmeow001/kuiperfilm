'use client'

/**
 * Phase 12.4 — v2 SubjectsPage (主體) client implementation.
 *
 * Tabs across 角色 / 場景 / 道具.  For now 道具 is a stub
 * because Phase 11.3 (props as first-class assets) is still ⏸ —
 * the tab is shown but the grid says "coming Phase 11.3".
 *
 * Each character / location card shows the primary appearance
 * image (from EpisodeCharacter junction or DB), the role / desc,
 * and on hover surfaces "重新生成" + "鎖定" actions. Both routes
 * to existing endpoints.
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import { useProjectCharacters, useProjectLocations } from '@/lib/query/hooks/useProjectAssets'
import { useRegenerateSingleCharacterImage } from '@/lib/query/mutations/character-image-ops-mutations'
import { useRegenerateSingleLocationImage } from '@/lib/query/mutations/location-image-mutations'
import { useConfirmProjectCharacterProfile } from '@/lib/query/mutations/character-profile-mutations'
import { useAnalyzeProjectAssets } from '@/lib/query/mutations/useProjectConfigMutations'
import { useTaskSnapshot } from '@/lib/query/hooks/useTaskStatus'
import { queryKeys } from '@/lib/query/keys'
import { useCurrentEpisode } from '../hooks/useCurrentEpisode'

type Tab = 'character' | 'scene' | 'prop'

interface V2SubjectsClientProps {
  projectId: string
  locale: string
}

interface CharacterLike {
  id: string
  name?: string | null
  role?: string | null
  description?: string | null
  imageUrl?: string | null
  profileConfirmed?: boolean | null
  appearances?: Array<{
    id: string
    appearanceIndex?: number
    imageUrls?: string | null
  }> | null
}

interface LocationLike {
  id: string
  name?: string | null
  description?: string | null
  imageUrl?: string | null
  images?: Array<{ imageUrl?: string | null }> | null
}

function pickCharacterImage(c: CharacterLike): string | null {
  if (c.imageUrl) return c.imageUrl
  const first = c.appearances?.[0]
  if (!first?.imageUrls) return null
  try {
    const parsed = JSON.parse(first.imageUrls) as string[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
  } catch {
    return null
  }
}

function pickLocationImage(l: LocationLike): string | null {
  if (l.imageUrl) return l.imageUrl
  const found = l.images?.find((img) => Boolean(img.imageUrl))
  return found?.imageUrl ?? null
}

export function V2SubjectsClient({ projectId, locale }: V2SubjectsClientProps) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('character')
  const charactersQuery = useProjectCharacters(projectId)
  const locationsQuery = useProjectLocations(projectId)
  const regenChar = useRegenerateSingleCharacterImage(projectId)
  const regenLoc = useRegenerateSingleLocationImage(projectId)
  const confirmProfile = useConfirmProjectCharacterProfile(projectId)
  const analyze = useAnalyzeProjectAssets(projectId)
  const { currentEpisodeId, currentEpisode } = useCurrentEpisode(projectId)

  // Server-side task snapshot — survives page navigation, polled while
  // the worker is in flight, and used as the source of truth for the
  // analyze status banner (instead of the component-local mutation state
  // that resets on unmount).
  const taskSnapshot = useTaskSnapshot({
    projectId,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    type: ['analyze_novel'],
  })
  const taskStatus = taskSnapshot.data?.status ?? null
  const taskProgress = taskSnapshot.data?.progress ?? 0
  const isAnalyzing = taskStatus === 'queued' || taskStatus === 'processing'
  const taskError = taskSnapshot.data?.errorMessage ?? null
  const taskUpdatedAt = taskSnapshot.data?.updatedAt ?? null

  // Poll the snapshot every 3s while worker is running, so the
  // queued → processing → completed transition is observable.
  useEffect(() => {
    if (!isAnalyzing) return
    const interval = setInterval(() => { void taskSnapshot.refetch() }, 3000)
    return () => clearInterval(interval)
  }, [isAnalyzing, taskSnapshot])

  // Detect transition into 'completed' and invalidate character/location
  // queries so the grid picks up the freshly-written rows.
  const previousTaskStatus = useRef(taskStatus)
  useEffect(() => {
    if (previousTaskStatus.current !== 'completed' && taskStatus === 'completed') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
    }
    previousTaskStatus.current = taskStatus
  }, [taskStatus, projectId, queryClient])

  const characters = (charactersQuery.data ?? []) as unknown as CharacterLike[]
  const locations = (locationsQuery.data ?? []) as unknown as LocationLike[]

  function handleAnalyze() {
    if (!currentEpisodeId) {
      alert('還沒有任何集數 — 請先到「劇本」step 貼劇本並儲存')
      return
    }
    analyze.mutate(
      { episodeId: currentEpisodeId },
      {
        onSuccess: () => {
          // Pull the new task into the snapshot immediately so the banner
          // flips from idle → queued without waiting for the 5s staleTime.
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId) })
        },
      },
    )
  }

  function handleRegenChar(c: CharacterLike) {
    const appearanceId = c.appearances?.[0]?.id
    if (!appearanceId) {
      alert('此角色還沒有 appearance,請先回劇本 step 跑分析')
      return
    }
    regenChar.mutate({ characterId: c.id, appearanceId, imageIndex: 0 })
  }

  function handleRegenLoc(l: LocationLike) {
    regenLoc.mutate({ locationId: l.id, imageIndex: 0 })
  }

  function handleConfirmProfile(c: CharacterLike) {
    if (c.profileConfirmed) return // already locked — no-op (un-lock not exposed yet)
    confirmProfile.mutate({ characterId: c.id, generateImage: false })
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'character', label: '角色', count: characters.length },
    { id: 'scene', label: '場景', count: locations.length },
    { id: 'prop', label: '道具', count: 0 },
  ]

  const isLoading = charactersQuery.isLoading || locationsQuery.isLoading

  return (
    <div className="px-12 py-10">
      {/* Analyze CTA strip — Stage C: independent subjects analysis */}
      <div className="mb-6 flex flex-col gap-4 rounded-sm border border-amber-500/30 bg-amber-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-fraunces text-sm italic text-amber-400">
            分析{currentEpisode ? `「${currentEpisode.name}」` : '當前集'}的劇本
          </div>
          <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-500">
            從劇本自動抽出角色 / 場景 — 完成後可在下方卡片點「重新生成」/「鎖定」/上傳替換
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyze.isPending || isAnalyzing || !currentEpisodeId}
            className="flex items-center gap-2 rounded-sm bg-amber-500 px-5 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-4 w-4" />
            {analyze.isPending
              ? '提交中…'
              : isAnalyzing
                ? `分析中… ${taskProgress}%`
                : taskStatus === 'completed'
                  ? '重新分析'
                  : '一鍵分析'}
          </button>
          <Link
            href={`/${locale}/workspace/asset-hub`}
            className="font-mono text-[10px] tracking-wider text-stone-500 transition-colors hover:text-amber-300"
          >
            或從素材庫導入 →
          </Link>
        </div>
      </div>

      {/* Status banner — reads from server task snapshot, persists across navigation */}
      {analyze.isError ? (
        <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
          提交失敗:{(analyze.error as Error)?.message ?? '未知錯誤'}
        </div>
      ) : taskStatus === 'failed' ? (
        <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
          分析任務失敗:{taskError ?? '未知錯誤'}
        </div>
      ) : isAnalyzing ? (
        <div className="mb-6 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-serif-cn text-sm text-amber-300">
          ⏳ 分析中… 進度 {taskProgress}% (LLM 跑完約 30-90 秒,完成後角色/場景會自動出現)
        </div>
      ) : taskStatus === 'completed' ? (
        <div className="mb-6 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-serif-cn text-sm text-emerald-300">
          ✓ 上次分析已完成{taskUpdatedAt ? ` · ${new Date(taskUpdatedAt).toLocaleTimeString('zh-TW')}` : ''} — 角色 / 場景已寫入下方卡片
        </div>
      ) : null}

      <div className="mb-8 flex items-center justify-between">
        <div className="flex gap-1 rounded-sm border border-stone-800/50 bg-stone-900/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-sm px-5 py-2 font-serif-cn text-sm transition-all ${
                tab === t.id
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {t.label}
              <span className="ml-2 font-mono text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <Link
          href={`/${locale}/v2/workspace/${projectId}/storyboard`}
          className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-5 py-2 font-serif-cn text-sm text-amber-400 transition-all hover:border-amber-500/60 hover:bg-amber-500/15"
        >
          下一步 → 分鏡 <AppIcon name="chevronRight" className="h-4 w-4" />
        </Link>
      </div>

      {isLoading ? (
        <p className="font-mono text-xs tracking-wider text-stone-500">載入中…</p>
      ) : tab === 'character' ? (
        <SubjectGrid
          items={characters.map((c) => ({
            id: c.id,
            name: c.name ?? '未命名角色',
            caption: c.role ?? '角色',
            description: c.description ?? null,
            imageUrl: pickCharacterImage(c),
            onRegenerate: () => handleRegenChar(c),
            isRegenerating: regenChar.isPending,
            isLocked: Boolean(c.profileConfirmed),
            onLock: () => handleConfirmProfile(c),
            isLocking: confirmProfile.isPending,
          }))}
          emptyHint="此項目還沒有角色 — 點上方「一鍵分析」抽出此集的角色,或從素材庫導入"
        />
      ) : tab === 'scene' ? (
        <SubjectGrid
          items={locations.map((l) => ({
            id: l.id,
            name: l.name ?? '未命名場景',
            caption: '場景',
            description: l.description ?? null,
            imageUrl: pickLocationImage(l),
            onRegenerate: () => handleRegenLoc(l),
            isRegenerating: regenLoc.isPending,
          }))}
          emptyHint="此項目還沒有場景 — 點上方「一鍵分析」抽出此集的場景,或從素材庫導入"
        />
      ) : (
        <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
          <AppIcon name="cube" className="mx-auto mb-3 h-8 w-8 text-stone-600" />
          <p className="font-fraunces text-base italic text-stone-400">道具 first-class 待 Phase 11.3 上線</p>
          <p className="mt-2 font-mono text-[10px] tracking-wider text-stone-600">PROP_ASSETS · COMING SOON</p>
        </div>
      )}
    </div>
  )
}

interface SubjectItem {
  id: string
  name: string
  caption: string
  description: string | null
  imageUrl: string | null
  onRegenerate?: () => void
  isRegenerating?: boolean
  isLocked?: boolean
  onLock?: () => void
  isLocking?: boolean
}

function SubjectGrid({ items, emptyHint }: { items: SubjectItem[]; emptyHint: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-stone-800/50 bg-stone-900/30 p-12 text-center">
        <p className="font-fraunces text-base italic text-stone-400">{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item, i) => (
        <div
          key={item.id}
          className="group overflow-hidden rounded-sm border border-stone-800/50 bg-stone-900/30 transition-all hover:border-amber-500/40"
        >
          <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-stone-800 to-stone-900">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <AppIcon name="image" className="h-8 w-8 text-stone-600" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/30 to-transparent" />
            <div className="absolute left-3 top-3 rounded-sm bg-stone-950/40 px-2 py-1 font-mono text-[9px] tracking-[0.2em] text-stone-300/80 backdrop-blur-sm">
              {String(i + 1).padStart(3, '0')}
            </div>
            <div className="absolute bottom-3 left-3 right-3">
              <div className="font-fraunces text-[11px] italic text-amber-300/90">{item.caption}</div>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="font-serif-cn text-base text-stone-100">{item.name}</div>
            {item.description ? (
              <div className="mt-1 line-clamp-2 font-body text-xs leading-relaxed text-stone-500">
                {item.description}
              </div>
            ) : null}
          </div>
          {item.onRegenerate ? (
            <div className="flex items-center justify-between border-t border-stone-800/50 px-4 pb-3 pt-2">
              <button
                type="button"
                disabled={item.isRegenerating}
                onClick={item.onRegenerate}
                className="font-mono text-[10px] tracking-wider text-stone-500 transition-all hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.isRegenerating ? '提交中…' : '重新生成'}
              </button>
              {item.onLock ? (
                <button
                  type="button"
                  disabled={item.isLocking || item.isLocked}
                  onClick={item.onLock}
                  title={item.isLocked ? '已鎖定 — 之後分鏡會優先綁定此角色檔案' : '鎖定後分鏡會優先綁定此角色檔案'}
                  className={`font-mono text-[10px] tracking-wider transition-all disabled:cursor-not-allowed ${
                    item.isLocked
                      ? 'text-amber-400'
                      : 'text-stone-500 hover:text-amber-400'
                  } ${item.isLocking ? 'opacity-50' : ''}`}
                >
                  {item.isLocking ? '鎖定中…' : item.isLocked ? '✓ 已鎖定' : '⊙ 鎖定'}
                </button>
              ) : (
                <span className="font-mono text-[10px] tracking-wider text-stone-700">—</span>
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
