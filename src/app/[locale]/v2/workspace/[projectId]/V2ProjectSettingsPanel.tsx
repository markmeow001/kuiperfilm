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

const RATIO_OPTIONS: Array<{ value: string; label: string; caption: string }> = [
  { value: '9:16', label: '9:16', caption: '豎屏' },
  { value: '16:9', label: '16:9', caption: '橫屏' },
  { value: '1:1', label: '1:1', caption: '方形' },
  { value: '4:3', label: '4:3', caption: '經典' },
]

const CATEGORY_ORDER: PresetCategory[] = [
  'realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western',
]

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

  const presetGroups = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABEL_ZH[cat],
      keys: PRESET_ORDER_BY_CATEGORY[cat],
    }))
  }, [])

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
    </div>
  )
}
