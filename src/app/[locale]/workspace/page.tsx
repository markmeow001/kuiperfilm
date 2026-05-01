/**
 * Phase 12.x.x — legacy workspace landing redirected to v2.
 *
 * The Phase-11 frosted-blue dashboard has been retired in favour of the
 * v2 cinematic palette. Anyone still hitting `/[locale]/workspace`
 * lands here and is bounced to `/[locale]/v2` so there's exactly one
 * canonical entry point.
 *
 * Per-project deep links `/[locale]/workspace/<projectId>` continue to
 * resolve to the legacy NovelPromotionWorkspace shell so existing
 * bookmarks don't break — those will be migrated separately when the
 * v2 workspace pages reach feature parity.
 */
import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function LegacyWorkspaceRedirect({ params }: PageProps) {
  const { locale } = await params
  redirect(`/${locale}/v2`)
}
