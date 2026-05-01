import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2ScriptClient } from './V2ScriptClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2ScriptPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="script"
      draftNumber={2}
    >
      <V2ScriptClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
