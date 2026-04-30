import { V2WorkspaceShell } from '../V2WorkspaceShell'

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
      projectName="未命名劇本"
      draftNumber={2}
    >
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">
          12.3 ScriptPage 實作中 — 將接 useNovelPromotionProject + 4 種起始方式 + 22 個 styleProfile preset
        </p>
      </div>
    </V2WorkspaceShell>
  )
}
