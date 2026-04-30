import { V2WorkspaceShell } from '../V2WorkspaceShell'

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
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">
          12.6 VoicePage 實作中 — filter rail + voice grid + tuning slider
        </p>
      </div>
    </V2WorkspaceShell>
  )
}
