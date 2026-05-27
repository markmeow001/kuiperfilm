import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { V2PlaygroundClient } from './V2PlaygroundClient'

/**
 * Phase T-1 (2026-05-27) — Playground / Freedom Mode entry page.
 *
 * Independent of any project. User comes here to type a prompt + drop a
 * couple of reference images, pick a model, and get a single image (T-1)
 * or video (T-2+) out. Saves to PlaygroundRun rows for the history rail.
 *
 * Variant A "fal-faithful" layout — see
 * ~/.gstack/projects/markmeow001-kuiperfilm/designs/playground-20260527/
 * approved.json.
 */
interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function PlaygroundPage({ params }: PageProps) {
  const { locale } = await params

  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/playground`)}`)
  }

  return <V2PlaygroundClient locale={locale} />
}
