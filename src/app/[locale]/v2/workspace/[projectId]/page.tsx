import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { V2WorkspaceShell } from './V2WorkspaceShell'
import { V2HomeClient } from './V2HomeClient'

const STEP_VALUES = ['home', 'script', 'subjects', 'storyboard', 'voice', 'final'] as const
type StepValue = (typeof STEP_VALUES)[number]

function isStep(value: unknown): value is StepValue {
  return typeof value === 'string' && (STEP_VALUES as readonly string[]).includes(value)
}

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams?: Promise<{ startAt?: string; stay?: string }>
}

export default async function V2WorkspaceHomePage({ params, searchParams }: PageProps) {
  const { locale, projectId } = await params
  const { startAt, stay } = (await searchParams) ?? {}

  // Deep-link override: `?startAt=<step>` wins and is persisted by the
  // step page itself via useStickyStep, no upsert needed here.
  if (isStep(startAt) && startAt !== 'home') {
    redirect(`/${locale}/v2/workspace/${projectId}/${startAt}`)
  }

  // 2026-05-13 escape hatch — `?stay=1` means "I really want the home
  // page, do NOT bounce me to last-step". Lets the project-name link
  // in V2EpisodeTabBar (and any other "回首頁" entry point) actually
  // reach home, which is where users set artStyle / videoRatio. Without
  // this, sticky-step would silently redirect home → last-step on
  // every visit and the user could never reach project settings.
  const stayOnHome = stay === '1' || stay === 'true'

  // Sticky-step lookup — per-user, per-project cursor.
  if (!stayOnHome) {
    const session = await getAuthSession()
    if (session?.user?.id) {
      const state = await prisma.userProjectState.findUnique({
        where: {
          userId_projectId: {
            userId: session.user.id,
            projectId,
          },
        },
        select: { lastStep: true },
      })

      if (state && isStep(state.lastStep) && state.lastStep !== 'home') {
        redirect(`/${locale}/v2/workspace/${projectId}/${state.lastStep}`)
      }
    }
  }

  return (
    <V2WorkspaceShell projectId={projectId} locale={locale} currentStep="home">
      <V2HomeClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
