import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2SubjectsClient } from './V2SubjectsClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2SubjectsPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="subjects"
      draftNumber={3}
    >
      <V2SubjectsClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
