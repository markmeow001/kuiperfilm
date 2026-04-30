import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2StoryboardClient } from './V2StoryboardClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2StoryboardPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="storyboard"
      projectName="未命名劇本"
      draftNumber={4}
    >
      <V2StoryboardClient projectId={projectId} />
    </V2WorkspaceShell>
  )
}
