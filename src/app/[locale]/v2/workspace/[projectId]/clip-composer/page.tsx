import { SystemStateScreen } from '@/components/system/SystemStateScreen'
import {
  requireProjectPageReadAccess,
  type PageSearchParams,
} from '@/lib/auth/page-access'
import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2ClipComposerClient } from './V2ClipComposerClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams?: Promise<PageSearchParams>
}

export default async function V2ClipComposerPage({ params, searchParams }: PageProps) {
  const { locale, projectId } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const access = await requireProjectPageReadAccess({
    locale,
    pathname: `/${locale}/v2/workspace/${projectId}/clip-composer`,
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
      currentStep="final"
      draftNumber={6}
    >
      <V2ClipComposerClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
