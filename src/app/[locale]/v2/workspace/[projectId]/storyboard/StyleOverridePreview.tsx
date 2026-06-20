'use client'

/**
 * Phase 1 step 3 — per-group visual-style override thumbnail, hoisted out of
 * GroupCard.tsx. Pure presentational leaf: takes a styleId, renders the
 * style's thumbnail (or a category-letter fallback). No parent state /
 * closures, so the relocation is fully tsc-verified with zero behaviour
 * change.
 */

import { useTranslations } from 'next-intl'
import { visualStyles } from '@/lib/style-library'

export function StyleOverridePreview({ styleId }: { styleId: string }) {
  const t = useTranslations('v2Storyboard.groupCard')
  const style = visualStyles.find((s) => s.id === styleId)
  if (!style) return null
  return style.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={style.thumbnailUrl}
      alt={style.nameZh}
      title={`${style.category} · ${style.nameZh}`}
      loading="lazy"
      className="h-10 w-8 rounded-sm border border-stone-800 object-cover"
    />
  ) : (
    <span
      title={`${style.category} · ${style.nameZh} ${t('style.thumbnailPending')}`}
      className="flex h-10 w-8 items-center justify-center rounded-sm border border-stone-800 bg-stone-900/60 font-mono text-[14px] tracking-wider text-stone-600"
    >
      {style.category}
    </span>
  )
}
