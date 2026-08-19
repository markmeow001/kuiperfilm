import { redirect } from 'next/navigation'
import { SystemStateScreen } from '@/components/system/SystemStateScreen'
import {
  requireProjectPageReadAccess,
  type PageSearchParams,
} from '@/lib/auth/page-access'
import { V2WorkspaceShell } from './V2WorkspaceShell'
import { V2HomeClient } from './V2HomeClient'

const STEP_VALUES = ['home', 'script', 'subjects', 'storyboard', 'voice', 'final'] as const
type StepValue = (typeof STEP_VALUES)[number]

function isStep(value: unknown): value is StepValue {
  return typeof value === 'string' && (STEP_VALUES as readonly string[]).includes(value)
}

const HOME_CONTROL_QUERY_KEYS = new Set(['startAt', 'stay'])

function withForwardedSearchParams(
  pathname: string,
  searchParams: PageSearchParams,
): string {
  const query = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(searchParams)) {
    if (HOME_CONTROL_QUERY_KEYS.has(key)) continue

    if (typeof rawValue === 'string') {
      query.append(key, rawValue)
      continue
    }

    for (const value of rawValue ?? []) {
      query.append(key, value)
    }
  }

  const queryString = query.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
  searchParams?: Promise<PageSearchParams>
}

export default async function V2WorkspaceHomePage({ params, searchParams }: PageProps) {
  const { locale, projectId } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const access = await requireProjectPageReadAccess({
    locale,
    pathname: `/${locale}/v2/workspace/${projectId}`,
    projectId,
    searchParams: resolvedSearchParams,
  })

  if (access.kind === 'forbidden') {
    return <SystemStateScreen state="forbidden" locale={locale} />
  }

  const { startAt } = resolvedSearchParams

  // Deep-link override: `?startAt=<step>` wins and is persisted by the
  // step page itself via useStickyStep, no upsert needed here.
  if (isStep(startAt) && startAt !== 'home') {
    redirect(withForwardedSearchParams(
      `/${locale}/v2/workspace/${projectId}/${startAt}`,
      resolvedSearchParams,
    ))
  }

  return (
    <V2WorkspaceShell projectId={projectId} locale={locale} currentStep="home">
      <V2HomeClient projectId={projectId} locale={locale} />
    </V2WorkspaceShell>
  )
}
