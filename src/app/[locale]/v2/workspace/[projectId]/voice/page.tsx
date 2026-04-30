import { V2WorkspaceShell } from '../V2WorkspaceShell'
import { V2VoiceClient } from './V2VoiceClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2VoicePage({ params }: PageProps) {
  const { locale, projectId } = await params
  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="voice"
      projectName="未命名劇本"
      draftNumber={5}
    >
      <V2VoiceClient projectId={projectId} />
    </V2WorkspaceShell>
  )
}
