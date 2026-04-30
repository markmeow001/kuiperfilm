import { V2WorkspaceShell } from '../V2WorkspaceShell'

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
      projectName="未命名劇本"
      draftNumber={3}
    >
      <div className="px-12 py-10">
        <p className="font-mono text-xs tracking-wider text-stone-500">
          12.4 SubjectsPage 實作中 — 將接 character / location / prop tabs + 重新生成 + 鎖定
        </p>
      </div>
    </V2WorkspaceShell>
  )
}
