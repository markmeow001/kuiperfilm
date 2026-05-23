'use client'

/**
 * Inline video-model picker for the V2 storyboard 多鏡頭 header row.
 *
 * Single-line layout (intentional — replaces the passive grey
 * "尚未設定 video model · 比例 9:16" status line without adding
 * vertical bloat to the header):
 *
 *   視頻模型: [Seedance][●Kling] [Kling 3.0-Omni ▾] [音頻][多鏡頭][≤10s ¥¥¥]
 *
 * The two family chips are a quick way to switch between Seedance vs
 * Kling without scanning a 14-entry dropdown. Picking a chip auto-
 * selects the first variant in that family if the current selection
 * belongs to the OTHER family — otherwise it leaves the current variant
 * alone (so a user already on Kling 3.0-Omni doesn't get bumped when
 * they click the Kling chip).
 *
 * Capability badges read directly off `VIDEO_MODEL_VARIANTS` so any
 * new variant added there appears here with no UI edit.
 *
 * Persistence: write goes through `useUpdateProjectConfig` (the same
 * hook V1 OverviewView uses). The picker is project-scoped — anyone
 * with edit access on the project can change it. Admin's global
 * default lives in `User.videoModel` (not touched here).
 */

import { useMemo } from 'react'
import { useUpdateProjectConfig } from '@/lib/query/mutations/useProjectConfigMutations'
import {
  VIDEO_MODEL_VARIANTS,
  getVideoModelVariant,
  getVariantsByFamily,
  type VideoModelFamily,
} from '@/lib/video-models/variants'

interface VideoModelPickerInlineProps {
  projectId: string
  /** Current `project.novelPromotionData.videoModel` (provider::modelId). */
  currentVideoModel: string | null | undefined
  /** Aspect ratio shown to the right of the picker; rendered as-is. */
  videoRatio: string
  /** Phase Q (2026-05-21) — project target total video duration in
   *  seconds. Drives script_to_storyboard panel count + auto_group_multi_shot
   *  group count. Pre-Phase-Q this was set on STEP 01 but invisible from
   *  STEP 03 storyboard; user had no signal that targetDuration influenced
   *  shot count. Now editable inline so user can iterate without bouncing
   *  to STEP 01. */
  targetDuration: number | null | undefined
  /** 2026-05-22 — project.videoResolution (480p / 720p / 1080p). Inline
   *  picker only renders when current model is an ARK Seedance 2.0 variant
   *  (the only route where resolution isn't baked into the model id). */
  videoResolution: '480p' | '720p' | '1080p' | null | undefined
}

// 2026-05-22 — keep in sync with V2ProjectSettingsPanel + ark.ts
// ARK_SEEDANCE_MODEL_SPECS.resolutionOptions. Fast variant rejects 1080p.
function modelSupportsResolutionChoice(videoModel: string | null | undefined): boolean {
  return videoModel === 'ark::doubao-seedance-2-0-260128'
    || videoModel === 'ark::doubao-seedance-2-0-fast-260128'
}
function modelSupports1080p(videoModel: string | null | undefined): boolean {
  return videoModel !== 'ark::doubao-seedance-2-0-fast-260128'
}

export function VideoModelPickerInline({
  projectId,
  currentVideoModel,
  videoRatio,
  targetDuration,
  videoResolution,
}: VideoModelPickerInlineProps) {
  const updateConfig = useUpdateProjectConfig(projectId)
  const currentVariant = getVideoModelVariant(currentVideoModel)
  const currentFamily: VideoModelFamily | null = currentVariant?.family ?? null

  const seedanceVariants = useMemo(() => getVariantsByFamily('seedance'), [])
  const klingVariants = useMemo(() => getVariantsByFamily('kling'), [])

  function setVariant(id: string) {
    updateConfig.mutate({ key: 'videoModel', value: id })
  }

  // Switching family auto-picks the family's first variant when the
  // current selection belongs to the OTHER family; otherwise no-op
  // (keeps the user on their current Kling-3.0-Omni etc.).
  function setFamily(target: VideoModelFamily) {
    if (currentFamily === target) return
    const list = target === 'seedance' ? seedanceVariants : klingVariants
    if (list.length === 0) return
    setVariant(list[0].id)
  }

  const chipClass = (active: boolean) =>
    `px-2.5 py-1 font-serif-cn text-[12px] transition-colors ${
      active
        ? 'bg-amber-500/15 text-amber-300'
        : 'text-stone-400 hover:text-amber-400'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[12px] tracking-wider text-stone-500">
      <span className="shrink-0">視頻模型:</span>

      {/* Family chips — segmented control style */}
      <div className="inline-flex overflow-hidden rounded-sm border border-stone-800 bg-stone-900/40">
        <button
          type="button"
          onClick={() => setFamily('seedance')}
          disabled={updateConfig.isPending}
          className={`${chipClass(currentFamily === 'seedance')} ${
            updateConfig.isPending ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          Seedance
        </button>
        <button
          type="button"
          onClick={() => setFamily('kling')}
          disabled={updateConfig.isPending}
          className={`border-l border-stone-800 ${chipClass(currentFamily === 'kling')} ${
            updateConfig.isPending ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          Kling
        </button>
      </div>

      {/* Variant dropdown — filtered by current family. If no family is
          selected yet (unknown id or null), the dropdown shows ALL
          variants so the user can land on one. */}
      <select
        value={currentVariant?.id ?? ''}
        onChange={(event) => setVariant(event.target.value)}
        disabled={updateConfig.isPending}
        className="max-w-[260px] truncate rounded-sm border border-stone-800 bg-stone-900/40 px-2 py-1 font-mono text-[12px] text-stone-300 transition-colors hover:border-amber-500/40 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
      >
        {currentVariant === null && (
          <option value="" disabled>
            選擇模型…
          </option>
        )}
        {(currentFamily === 'seedance' || currentFamily === null
          ? seedanceVariants
          : []
        ).map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
        {(currentFamily === 'kling' || currentFamily === null
          ? klingVariants
          : []
        ).map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      {/* 2026-05-22 — resolution picker. Placed adjacent to the model
          dropdown (user-requested layout) so the visual link between
          "this model" and "at this resolution" reads at a glance.
          Only shown for ARK 2.0 routes (taijiai / atlascloud / fal
          bake resolution into the model id; showing the picker there
          would be misleading). 1080p disabled on Fast variant per
          Volcengine docs. */}
      {modelSupportsResolutionChoice(currentVideoModel) ? (
        <label
          className="flex items-center gap-1.5 whitespace-nowrap"
          title="輸出視頻解析度 — 480p 最省, 720p 預設, 1080p 大約是 720p 的 2.25× token 成本"
        >
          <span className="shrink-0">解析度</span>
          <select
            value={videoResolution ?? '720p'}
            onChange={(e) => {
              const next = e.target.value
              if (next === '480p' || next === '720p' || next === '1080p') {
                updateConfig.mutate({ key: 'videoResolution', value: next })
              }
            }}
            disabled={updateConfig.isPending}
            className="rounded-sm border border-stone-800 bg-stone-900/40 px-1.5 py-0.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
          >
            <option value="480p">480p · 草稿</option>
            <option value="720p">720p · 默認</option>
            <option value="1080p" disabled={!modelSupports1080p(currentVideoModel)}>
              1080p{modelSupports1080p(currentVideoModel) ? ' · 高畫質 ¥¥' : ' (Fast 不支援)'}
            </option>
          </select>
        </label>
      ) : null}

      {/* Capability badges — only render when we know what variant the
          user is on. Falls silent on unknown ids (legacy DB values). */}
      {currentVariant && (
        <div className="flex items-center gap-1">
          {currentVariant.capabilities.audio && (
            <span className="rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
              音頻
            </span>
          )}
          {currentVariant.capabilities.multiShot && (
            <span className="rounded-sm border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-sky-400">
              多鏡頭
            </span>
          )}
          <span
            className="rounded-sm border border-stone-700 bg-stone-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400"
            title={currentVariant.hint || ''}
          >
            ≤{currentVariant.capabilities.maxDurationSec}s · {currentVariant.capabilities.costTier}
          </span>
        </div>
      )}

      {/* Phase Q (2026-05-21) — target duration widget. Editable inline
          so user can change 60/90/120/180s without leaving STEP 03.
          Affects script_to_storyboard panel count + auto_group_multi_shot
          group count on next 重新分析 / 重新切組. Persisted to
          project.targetDuration via useUpdateProjectConfig. */}
      <label
        className="flex items-center gap-1.5 whitespace-nowrap"
        title="整集目標總時長 — 影響分鏡數量與切組策略。改了之後需要按「重新分析」或「重新切組」才會套用到 LLM。"
      >
        <span className="shrink-0">目標</span>
        <select
          value={typeof targetDuration === 'number' && targetDuration > 0 ? targetDuration : 60}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(next) && next > 0) {
              updateConfig.mutate({ key: 'targetDuration', value: next })
            }
          }}
          disabled={updateConfig.isPending}
          className="rounded-sm border border-stone-800 bg-stone-900/40 px-1.5 py-0.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
        >
          <option value={30}>30s</option>
          <option value={60}>1 分鐘</option>
          <option value={90}>1 分半</option>
          <option value={120}>2 分鐘</option>
          <option value={180}>3 分鐘</option>
        </select>
      </label>

      <span className="ml-auto shrink-0">比例 {videoRatio}</span>

      {/* Fallback for unknown / legacy ids — give the user a one-click
          way to land on the recommended Kling Omni without typing. */}
      {currentVideoModel && !currentVariant && (
        <button
          type="button"
          onClick={() => setVariant(VIDEO_MODEL_VARIANTS.find((v) => v.id === 'tencent-vod::Kling-3.0-Omni')?.id ?? VIDEO_MODEL_VARIANTS[0].id)}
          disabled={updateConfig.isPending}
          className="rounded-sm border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-400 hover:bg-amber-500/10"
        >
          目前模型不在清單中 · 點此切到推薦
        </button>
      )}
    </div>
  )
}
