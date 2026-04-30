import { V2WorkspaceShell } from '../V2WorkspaceShell'

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
      projectName="未命名劇本"
      draftNumber={6}
    >
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">
          12.7 FinalPage 實作中 — player + timeline + 匯出 mp4
        </p>
      </div>
    </V2WorkspaceShell>
  )
}
