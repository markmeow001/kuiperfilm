'use client'

/**
 * 火山方舟 asset registration chip.
 *
 * Phase 3 (2026-05-23) — sits in character appearance / location image /
 * prop editor rows. Surfaces the four possible arkAssetStatus values
 * (null / pending / processing / active / failed) as a single compact
 * chip with a click action appropriate to each state:
 *
 *   - null            → 「报备火山」 (white outline, click → register)
 *   - 'pending'       → 「排队中…」 (amber, disabled, no click)
 *   - 'processing'    → 「火山审核中…」 (amber spinner, disabled)
 *   - 'active' + matched sourceUrl → 「✓ 已报备」 (green, tooltip shows asset_id)
 *   - 'active' + stale sourceUrl   → 「⚠ 需重新报备」 (yellow, click → re-register)
 *   - 'failed'        → 「✗ 失败」 + tooltip with error, click → retry
 *
 * Sub-100-line component, no internal state — purely render + click
 * delegates to the parent's onRegister callback.
 */
import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

export type ArkAssetTargetType = 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'

export interface ArkAssetRegisterChipProps {
  targetType: ArkAssetTargetType
  targetId: string
  imageUrl: string | null | undefined
  arkAssetId: string | null | undefined
  arkAssetStatus: string | null | undefined
  arkAssetSourceUrl: string | null | undefined
  arkAssetError: string | null | undefined
  onRegister: (args: { targetType: ArkAssetTargetType; targetId: string }) => Promise<void> | void
}

export function ArkAssetRegisterChip(props: ArkAssetRegisterChipProps) {
  const {
    targetType,
    targetId,
    imageUrl,
    arkAssetId,
    arkAssetStatus,
    arkAssetSourceUrl,
    arkAssetError,
    onRegister,
  } = props

  const [submitting, setSubmitting] = useState(false)

  // No image yet — chip just hidden. Caller surface is responsible for
  // teaching the user to generate the image first.
  if (!imageUrl) return null

  const isActiveButStale =
    arkAssetStatus === 'active' && arkAssetSourceUrl && arkAssetSourceUrl !== imageUrl

  async function handleClick() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onRegister({ targetType, targetId })
    } finally {
      setSubmitting(false)
    }
  }

  // Render switch ─────────────────────────────────────────────────────
  if (arkAssetStatus === 'pending' || submitting) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300"
        title="已提交火山,排队中"
      >
        <AppIcon name="loader" className="h-3 w-3 animate-spin" />
        排队中…
      </span>
    )
  }

  if (arkAssetStatus === 'processing') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300"
        title="火山后端正在审核(通常 1-15 分钟)"
      >
        <AppIcon name="loader" className="h-3 w-3 animate-spin" />
        火山审核中…
      </span>
    )
  }

  if (arkAssetStatus === 'active' && !isActiveButStale) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-emerald-400"
        title={`已报备火山 Seedance 2.0\nasset_id: ${arkAssetId ?? '(loading)'}\nSeedance 视频生成时会自动使用 asset:// 引用`}
      >
        <AppIcon name="check" className="h-3 w-3" />
        已报备
      </span>
    )
  }

  if (isActiveButStale) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="inline-flex items-center gap-1 rounded-sm border border-yellow-500/60 bg-yellow-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-yellow-300 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        title="图片已更新,旧的火山 asset 已过期,点这里重新报备"
      >
        <AppIcon name="alert" className="h-3 w-3" />
        需重新报备
      </button>
    )
  }

  if (arkAssetStatus === 'failed') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className="inline-flex items-center gap-1 rounded-sm border border-rose-500/60 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        title={`报备失败: ${arkAssetError ?? '未知错误'}\n点这里重试`}
      >
        <AppIcon name="alert" className="h-3 w-3" />
        ✗ 失败
      </button>
    )
  }

  // null / undefined → not yet registered
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitting}
      className="inline-flex items-center gap-1 rounded-sm border border-stone-700 bg-stone-900/60 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-stone-400 hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      title="向火山方舟注册此图片,通过后 Seedance 2.0 视频生成会用 asset:// 引用(绕过真人人脸检测)"
    >
      <AppIcon name="sparklesAlt" className="h-3 w-3" />
      报备火山
    </button>
  )
}
