import { V2WorkspaceShell } from './V2WorkspaceShell'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V2WorkspaceHomePage({ params }: PageProps) {
  const { locale, projectId } = await params

  return (
    <V2WorkspaceShell
      projectId={projectId}
      locale={locale}
      currentStep="home"
      projectName="未命名劇本"
    >
      <div className="px-12 py-10">
        <div className="max-w-3xl">
          <p className="mb-2 font-fraunces text-lg italic text-stone-400">A new kind of studio.</p>
          <p className="font-serif-cn text-base leading-relaxed text-stone-300">
            從一句靈感到一部成片,不再需要切換軟體。
            <span className="text-amber-500/80">劇本、分鏡、配音、剪輯</span>
            ,全都在這裡。
          </p>
          <p className="mt-8 font-mono text-xs tracking-wider text-stone-500">
            Phase 12 work-in-progress · 目前接資料中,各 step 預計依序開放
          </p>
        </div>
      </div>
    </V2WorkspaceShell>
  )
}
