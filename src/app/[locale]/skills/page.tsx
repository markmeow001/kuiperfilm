import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { SkillsLibraryClient } from './SkillsLibraryClient'

/**
 * Phase 2.5 (2026-06-10) — Skill library page.
 *
 * Independent of any project. User comes here to:
 *   1. See their installed Skills (「我的 Skill」)
 *   2. Toggle each Skill enabled / disabled
 *   3. Browse + install featured / community Skills
 *   4. Read each Skill's full description before installing
 *
 * Mirrors flova.ai's /zh-TW/skills page (verified 2026-06-03 logged-in
 * walkthrough — see IMPL_PREP/R-skill-primitive.md §2).
 *
 * Entry points:
 *   - V2NewProjectClient picker → "Skill 庫" link → here
 *   - Top-nav (future) → "Skill" entry
 *   - Workspace home active-Skill chip → "更換" → here
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function SkillsPage({ params }: PageProps) {
  const { locale } = await params

  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/skills`)}`)
  }

  return <SkillsLibraryClient locale={locale} />
}
