import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2FinalClient } from './V2FinalClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2FinalPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="final"
      draftNumber={6}
    >
      <V2FinalClient projectId={projectId} />
    </V2WorkspaceShell>
  )
}
