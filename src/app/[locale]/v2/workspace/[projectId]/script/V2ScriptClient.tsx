'use client'

/**
 * Phase 12.3 — v2 ScriptPage (劇本) client implementation.
 *
 * Functional MVP version:
 *  - 4 起始方式 chips (a/b/c/d) — UI only; all routes go through the
 *    same analyze mutation behind the scenes
 *  - 小說 / 一句話 textarea (controlled, persisted via update-config)
 *  - 畫面比例 chips bound to NovelPromotionProject.videoRatio
 *  - 22 styleProfile preset chips — clicking one calls the existing
 *    style-profile PATCH (same as ConfigStage's StyleProfilePanel)
 *  - 「生成劇本」 button calls useAnalyzeProjectAssets({ episodeId })
 *
 * Layout: ported from ~/Downloads/kino_mockup.jsx ScriptPage(); both
 * columns wrapped in V2WorkspaceShell from the parent server page.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useUpdateProjectConfig, useAnalyzeProjectAssets } from '@/lib/query/mutations/useProjectConfigMutations'
import { useStyleProfile } from '@/lib/query/hooks/useStyleProfile'
import { useUpdateStyleProfile } from '@/lib/query/mutations/updateStyleProfile'
import { queryKeys } from '@/lib/query/keys'
import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetKey,
  type PresetCategory,
} from '@/lib/style-profile/presets'

interface V2ScriptClientProps {
  projectId: string
}

interface NovelDataLike {
  novelText?: string | null
  videoRatio?: string | null
  episodes?: Array<{ id: string; episodeNumber?: number | null }> | null
}

interface ProjectDataLike {
  novelPromotionData?: NovelDataLike | null
}

const RATIO_OPTIONS: Array<{ value: string; label: string; caption: string }> = [
  { value: '9:16', label: '9:16', caption: '豎屏' },
  { value: '16:9', label: '16:9', caption: '橫屏' },
  { value: '1:1', label: '1:1', caption: '方形' },
  { value: '4:3', label: '4:3', caption: '經典' },
]

const START_METHODS: Array<{ key: string; label: string; desc: string; icon: 'sparkles' | 'cloudUpload' | 'image' | 'edit' }> = [
  { key: 'idea', label: '一句話想法', desc: '新手友好', icon: 'sparkles' },
  { key: 'novel', label: '導入小說', desc: 'AI 自動拆解', icon: 'cloudUpload' },
  { key: 'storyboard', label: '導入分鏡', desc: '專業團隊', icon: 'image' },
  { key: 'blank', label: '空白手寫', desc: '完全自定義', icon: 'edit' },
]

const CATEGORY_ORDER: PresetCategory[] = ['realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western']

export function V2ScriptClient({ projectId }: V2ScriptClientProps) {
  const queryClient = useQueryClient()
  const projectQuery = useProjectData(projectId)
  const styleQuery = useStyleProfile(projectId)
  const updateConfig = useUpdateProjectConfig(projectId)
  const updateStyle = useUpdateStyleProfile(projectId)
  const analyze = useAnalyzeProjectAssets(projectId)
  const [creatingEpisode, setCreatingEpisode] = useState(false)

  const project = projectQuery.data as ProjectDataLike | undefined
  const novelData = project?.novelPromotionData ?? null
  const firstEpisodeId = novelData?.episodes?.[0]?.id ?? null

  const [novelText, setNovelText] = useState('')
  const [activeMethod, setActiveMethod] = useState<string>('novel')
  const [hasInitialized, setHasInitialized] = useState(false)

  useEffect(() => {
    if (hasInitialized) return
    if (!novelData) return
    setNovelText(novelData.novelText ?? '')
    setHasInitialized(true)
  }, [hasInitialized, novelData])

  const videoRatio = novelData?.videoRatio ?? '9:16'
  const selectedPresetKey = (styleQuery.data?.stylePresetKey ?? null) as PresetKey | null
  const selectedPresetLabel = selectedPresetKey
    ? STYLE_PROFILE_PRESETS[selectedPresetKey].zhLabel
    : null

  const charCount = novelText.length

  const presetGroups = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABEL_ZH[cat],
      keys: PRESET_ORDER_BY_CATEGORY[cat],
    }))
  }, [])

  async function saveNovelTextToEpisode(episodeId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novelText: text }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        // eslint-disable-next-line no-console
        console.warn('[v2-script] save novelText failed', res.status, t)
        return false
      }
      return true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[v2-script] save novelText error', err)
      return false
    }
  }

  function handleSaveNovelText() {
    // Debounced manual save — store the textarea value into the FIRST episode's
    // novelText (only if the episode already exists). Project-level PATCH does
    // NOT accept novelText (allowedProjectFields whitelist), so going through
    // /episodes/[id] PATCH is the only path the analyze worker can read.
    if (!firstEpisodeId) return // nothing to save into yet — handleAnalyze creates one
    void saveNovelTextToEpisode(firstEpisodeId, novelText)
  }

  function handleRatioChange(value: string) {
    updateConfig.mutate({ key: 'videoRatio', value })
  }

  function handleApplyPreset(key: PresetKey) {
    const entry = STYLE_PROFILE_PRESETS[key]
    updateStyle.mutate({
      stylePositivePrompt: entry.positivePrompt,
      styleNegativePrompt: entry.negativePrompt,
      stylePresetKey: key,
    })
  }

  async function ensureEpisode(): Promise<string | null> {
    if (firstEpisodeId) return firstEpisodeId
    setCreatingEpisode(true)
    try {
      const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '第 1 集' }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        alert(`建立 episode 失敗 (${res.status}):${text || '未知錯誤'}`)
        return null
      }
      const json = (await res.json()) as { episode?: { id?: string } }
      const newId = json.episode?.id ?? null
      if (!newId) {
        alert('建立 episode 失敗:server 沒回 episode id')
        return null
      }
      // Refresh project data so episodes list picks up the new row.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      return newId
    } catch (err) {
      alert(`建立 episode 失敗:${(err as Error).message}`)
      return null
    } finally {
      setCreatingEpisode(false)
    }
  }

  async function handleAnalyze() {
    if (!novelText.trim()) {
      alert('請先輸入劇本內容')
      return
    }
    const episodeId = await ensureEpisode()
    if (!episodeId) return
    // Save novelText to the EPISODE row (analyze worker reads firstEpisode.novelText).
    const saved = await saveNovelTextToEpisode(episodeId, novelText)
    if (!saved) {
      alert('保存劇本失敗,請稍後重試')
      return
    }
    analyze.mutate({ episodeId })
  }

  if (projectQuery.isLoading) {
    return (
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">載入中…</p>
      </div>
    )
  }

  return (
    <div className="px-12 py-10">
      {/* Method chips */}
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {START_METHODS.map((m) => {
          const active = m.key === activeMethod
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveMethod(m.key)}
              className={`flex items-center gap-3 rounded-sm border px-4 py-3 text-left transition-all ${
                active
                  ? 'border-amber-500/40 bg-amber-500/8'
                  : 'border-stone-800/50 bg-stone-900/30 hover:border-stone-700'
              }`}
            >
              <AppIcon name={m.icon} className={`h-4 w-4 ${active ? 'text-amber-400' : 'text-stone-500'}`} />
              <div>
                <div className={`font-serif-cn text-sm ${active ? 'text-amber-100' : 'text-stone-300'}`}>
                  {m.label}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-stone-600">{m.desc}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left: input + ratio + style */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="font-fraunces text-sm italic text-amber-500/80">Your Spark</div>
            <div className="font-mono text-[10px] text-stone-600">{charCount} chars</div>
          </div>
          <textarea
            value={novelText}
            onChange={(e) => setNovelText(e.target.value)}
            onBlur={handleSaveNovelText}
            placeholder="輸入小說片段、一句話想法,或分鏡腳本…"
            className="h-48 w-full resize-none rounded-sm border border-amber-900/30 bg-stone-950 px-5 py-4 font-serif-cn text-base leading-relaxed text-stone-200 focus:border-amber-500/60 focus:outline-none"
          />

          <div className="mt-6 space-y-4">
            <div>
              <div className="mb-2 font-mono text-[10px] tracking-wider text-stone-500">畫面比例 · ASPECT</div>
              <div className="flex gap-2">
                {RATIO_OPTIONS.map((r) => {
                  const active = r.value === videoRatio
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => handleRatioChange(r.value)}
                      className={`rounded-sm border px-3 py-2 font-mono text-xs transition-all ${
                        active
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                          : 'border-stone-800 text-stone-500 hover:border-stone-700'
                      }`}
                    >
                      {r.label}
                      <span className="ml-1.5 font-serif-cn text-[10px] opacity-70">{r.caption}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 font-mono text-[10px] tracking-wider text-stone-500">
                畫面風格 · STYLE
                {selectedPresetLabel ? (
                  <span className="ml-2 font-serif-cn text-amber-400">({selectedPresetLabel})</span>
                ) : null}
              </div>
              <div className="space-y-3">
                {presetGroups.map((group) => (
                  <div key={group.category}>
                    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-stone-600">
                      {group.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.keys.map((key) => {
                        const entry = STYLE_PROFILE_PRESETS[key]
                        const active = key === selectedPresetKey
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleApplyPreset(key)}
                            disabled={updateStyle.isPending}
                            className={`rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                              active
                                ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                                : 'border-stone-800 text-stone-400 hover:border-stone-700'
                            }`}
                          >
                            {entry.zhLabel}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyze.isPending || updateConfig.isPending || creatingEpisode || !novelText.trim()}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="sparklesAlt" className="h-4 w-4" />
            {creatingEpisode ? '建立 episode…' : analyze.isPending ? '生成中…' : '生成劇本'}
          </button>

          {analyze.isError ? (
            <p className="mt-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {(analyze.error as Error)?.message ?? '生成劇本失敗'}
            </p>
          ) : null}
          {analyze.isSuccess ? (
            <p className="mt-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              已送出分析任務,可進「主體」 / 「分鏡」 step 查看結果
            </p>
          ) : null}
        </div>

        {/* Right: AI Draft preview (placeholder) */}
        <div className="relative">
          <div className="absolute -top-3 left-4 bg-stone-900 px-3 font-fraunces text-sm italic text-amber-500/80">
            AI Draft
          </div>
          <div className="max-h-[600px] overflow-y-auto rounded-sm border border-amber-900/20 bg-stone-900/40 p-6">
            {analyze.isPending || analyze.isSuccess ? (
              <div className="space-y-3">
                <div className="font-mono text-[10px] tracking-wider text-amber-600/70">STATUS</div>
                <p className="font-serif-cn text-sm text-stone-300">
                  分析任務已提交。後台 LLM 正在拆解角色 / 場景 / 分鏡。完成後切到
                  <span className="text-amber-400"> 「主體」 </span>
                  step 看結果。
                </p>
              </div>
            ) : (
              <p className="font-serif-cn text-sm text-stone-500">
                點左側「生成劇本」開始。系統會自動拆解角色、場景、分鏡並產生 prompt。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
