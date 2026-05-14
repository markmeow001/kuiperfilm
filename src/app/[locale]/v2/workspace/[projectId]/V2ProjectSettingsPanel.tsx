'use client'

/**
 * Phase 12.x.x / Stage B — project-level settings panel.
 *
 * Lifts videoRatio + style-preset chips out of ScriptPage so the user
 * sets them once when the project is created and never has to revisit
 * inside the per-episode script flow. Used inline on the project home
 * (and reusable elsewhere if Stage A's new-project form ever wants
 * inline preview).
 */

import { useMemo } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { useUpdateProjectConfig } from '@/lib/query/mutations/useProjectConfigMutations'
import { useStyleProfile } from '@/lib/query/hooks/useStyleProfile'
import { useUpdateStyleProfile } from '@/lib/query/mutations/updateStyleProfile'
import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetKey,
  type PresetCategory,
} from '@/lib/style-profile/presets'
import { visualStyles, lightingPresets } from '@/lib/style-library'

const RATIO_OPTIONS: Array<{ value: string; label: string; caption: string }> = [
  { value: '9:16', label: '9:16', caption: '豎屏' },
  { value: '16:9', label: '16:9', caption: '橫屏' },
  { value: '1:1', label: '1:1', caption: '方形' },
  { value: '4:3', label: '4:3', caption: '經典' },
]

const CATEGORY_ORDER: PresetCategory[] = [
  'realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western',
]

// Phase B — visual style library category labels (matches DB.category enum).
const LIBRARY_CATEGORY_LABEL: Record<string, string> = {
  A: '寫實影視',
  B: '日韓動畫',
  C: '中國風',
  D: '歐美動畫',
  E: 'CG / 3D',
  F: '插畫 / 遊戲',
  G: '紀實 / 風格化',
}
const LIBRARY_CATEGORY_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

interface ProjectShape {
  novelPromotionData?: {
    videoRatio?: string | null
  } | null
}

interface V2ProjectSettingsPanelProps {
  projectId: string
}

export function V2ProjectSettingsPanel({ projectId }: V2ProjectSettingsPanelProps) {
  const projectQuery = useProjectData(projectId)
  const styleQuery = useStyleProfile(projectId)
  const updateConfig = useUpdateProjectConfig(projectId)
  const updateStyle = useUpdateStyleProfile(projectId)

  const project = projectQuery.data as ProjectShape | undefined
  const videoRatio = project?.novelPromotionData?.videoRatio ?? '9:16'
  const selectedPresetKey = (styleQuery.data?.stylePresetKey ?? null) as PresetKey | null
  const selectedPresetLabel = selectedPresetKey
    ? STYLE_PROFILE_PRESETS[selectedPresetKey].zhLabel
    : null

  const selectedVisualStyleId = styleQuery.data?.visualStyleId ?? null
  const selectedLightingPresetId = styleQuery.data?.lightingPresetId ?? null
  const selectedVisualStyleLabel = useMemo(() => {
    if (!selectedVisualStyleId) return null
    const hit = visualStyles.find((s) => s.id === selectedVisualStyleId)
    return hit?.nameZh ?? null
  }, [selectedVisualStyleId])

  const presetGroups = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABEL_ZH[cat],
      keys: PRESET_ORDER_BY_CATEGORY[cat],
    }))
  }, [])

  const libraryGroups = useMemo(() => {
    return LIBRARY_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: LIBRARY_CATEGORY_LABEL[cat] ?? cat,
      styles: visualStyles
        .filter((s) => s.category === cat && s.isActive !== false)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    })).filter((group) => group.styles.length > 0)
  }, [])

  const sortedLightings = useMemo(
    () =>
      lightingPresets
        .filter((l) => l.isActive !== false)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [],
  )

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

  function handleApplyVisualStyle(styleId: string | null) {
    updateStyle.mutate({ visualStyleId: styleId })
  }

  function handleApplyLighting(lightingId: string | null) {
    updateStyle.mutate({ lightingPresetId: lightingId })
  }

  return (
    <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-6">
      <div className="mb-4 flex items-center gap-2">
        <AppIcon name="sparklesAlt" className="h-4 w-4 text-amber-500/80" />
        <span className="font-fraunces text-sm italic text-amber-500/80">Project Settings</span>
      </div>

      {/* Video ratio */}
      <div className="mb-5">
        <div className="mb-2 font-mono text-[14px] tracking-wider text-stone-500">
          畫面比例 · ASPECT
        </div>
        <div className="flex flex-wrap gap-2">
          {RATIO_OPTIONS.map((r) => {
            const active = r.value === videoRatio
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => handleRatioChange(r.value)}
                disabled={updateConfig.isPending}
                className={`rounded-sm border px-3 py-2 font-mono text-xs transition-all disabled:opacity-50 ${
                  active
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                    : 'border-stone-800 text-stone-500 hover:border-stone-700'
                }`}
              >
                {r.label}
                <span className="ml-1.5 font-serif-cn text-[14px] opacity-70">{r.caption}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Style preset */}
      <div>
        <div className="mb-2 font-mono text-[14px] tracking-wider text-stone-500">
          畫面風格 · STYLE
          {selectedPresetLabel ? (
            <span className="ml-2 font-serif-cn text-amber-400">({selectedPresetLabel})</span>
          ) : null}
        </div>
        <div className="space-y-3">
          {presetGroups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-stone-600">
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

      {/* Phase B — visual style library (29 curated styles + 8 lightings) */}
      <div className="mt-6 border-t border-stone-800/60 pt-5">
        <div className="mb-2 flex items-center justify-between font-mono text-[14px] tracking-wider text-stone-500">
          <span>
            視覺風格庫 · VISUAL STYLE LIBRARY
            {selectedVisualStyleLabel ? (
              <span className="ml-2 font-serif-cn text-amber-400">({selectedVisualStyleLabel})</span>
            ) : null}
          </span>
          {selectedVisualStyleId ? (
            <button
              type="button"
              onClick={() => handleApplyVisualStyle(null)}
              disabled={updateStyle.isPending}
              className="rounded-sm border border-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-500 hover:border-stone-700 disabled:opacity-50"
            >
              CLEAR
            </button>
          ) : null}
        </div>
        <p className="mb-3 font-serif-cn text-[12px] leading-relaxed text-stone-600">
          選一個風格會在 Kling 生成時注入文本級風格錨點，疊加在現有畫面風格之上。未選 = 跟原本一樣。
        </p>
        <div className="space-y-3">
          {libraryGroups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 font-mono text-[12px] uppercase tracking-wider text-stone-600">
                {group.category} · {group.label}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.styles.map((style) => {
                  const active = style.id === selectedVisualStyleId
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => handleApplyVisualStyle(style.id)}
                      disabled={updateStyle.isPending}
                      title={style.styleAnchor}
                      className={`rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                        active
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                          : 'border-stone-800 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      {style.nameZh}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Lighting preset row */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[12px] uppercase tracking-wider text-stone-600">
            <span>光影預設 · LIGHTING</span>
            {selectedLightingPresetId ? (
              <button
                type="button"
                onClick={() => handleApplyLighting(null)}
                disabled={updateStyle.isPending}
                className="rounded-sm border border-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-500 hover:border-stone-700 disabled:opacity-50"
              >
                CLEAR
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sortedLightings.map((lighting) => {
              const active = lighting.id === selectedLightingPresetId
              return (
                <button
                  key={lighting.id}
                  type="button"
                  onClick={() => handleApplyLighting(lighting.id)}
                  disabled={updateStyle.isPending}
                  title={lighting.lightingOverride}
                  className={`rounded-sm border px-3 py-1.5 font-serif-cn text-sm transition-all disabled:opacity-50 ${
                    active
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-stone-800 text-stone-400 hover:border-stone-700'
                  }`}
                >
                  {lighting.nameZh}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
