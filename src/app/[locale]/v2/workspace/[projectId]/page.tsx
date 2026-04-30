import { V2WorkspaceShell } from './V2WorkspaceShell'
import { V2HomeClient } from './V2HomeClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2WorkspaceHomePage({ params }: PageProps) {
  const { locale, projectId } = await params

  return (
    <V2WorkspaceShell projectId={projectId} locale={locale} currentStep="home">
      <V2HomeClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
