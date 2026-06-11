import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { SkillDetailClient } from './SkillDetailClient'

/**
 * Phase 2.5 (2026-06-10) — Skill detail page.
 *
 * Routed at /[locale]/skills/[slug]. Shows the full Skill description,
 * pipeline stage breakdown, default settings, attribution, install
 * count. Primary CTA: install (if not installed) → 「+ 新增」, else
 * 「開始用此 Skill 建立專案」 → /v2/new?skill=<id>.
 *
 * Required for:
 *   - Card "查看詳情" links from /skills library
 *   - Deep-link sharing of a Skill ("試試 @阿娴 的萌寵打工 Vlog")
 *   - Phase 3.5 marketplace product surface
 *
 * Auth-gated server component. Detail content (config / pipeline)
 * comes from GET /api/skills/[slug] which already enforces draft
 * visibility + workspace privacy.
 */

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { locale, slug } = await params

  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(
      `/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/skills/${slug}`)}`,
    )
  }

  return <SkillDetailClient locale={locale} slug={slug} />
}
