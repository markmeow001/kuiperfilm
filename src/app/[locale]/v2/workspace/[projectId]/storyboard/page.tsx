import { SystemStateScreen } from '@/components/system/SystemStateScreen'
import {
  requireProjectPageReadAccess,
  type PageSearchParams,
} from '@/lib/auth/page-access'
import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2StoryboardClient } from './V2StoryboardClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams?: Promise<PageSearchParams>
}

export default async function V2StoryboardPage({ params, searchParams }: PageProps) {
  const { locale, projectId } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const access = await requireProjectPageReadAccess({
    locale,
    pathname: `/${locale}/v2/workspace/${projectId}/storyboard`,
    projectId,
    searchParams: resolvedSearchParams,
  })

  if (access.kind === 'forbidden') {
    return <SystemStateScreen state="forbidden" locale={locale} />
  }

  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="storyboard"
      draftNumber={4}
    >
      <V2StoryboardClient projectId={projectId} />
    </V2WorkspaceShell>
  )
}
