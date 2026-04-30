import { V2WorkspaceShell } from '../V2WorkspaceShell'

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
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">
          12.5 StoryboardPage 實作中(Phase 12 keystone) — 3 欄 layout + Kling multi-shot 自動分組
        </p>
      </div>
    </V2WorkspaceShell>
  )
}
