import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { V2JobCenterClient } from './V2JobCenterClient'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams?: Promise<{ projectId?: string }>
}

export default async function V2JobsPage({ params, searchParams }: PageProps) {
  const [{ locale }, query, session] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ projectId?: string }>({}),
    getAuthSession(),
  ])

  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`)
  }

  const requestedProjectId = typeof query.projectId === 'string'
    ? query.projectId.trim()
    : ''

  return (
    <V2JobCenterClient
      locale={locale}
      initialProjectId={requestedProjectId || null}
    />
  )
}
