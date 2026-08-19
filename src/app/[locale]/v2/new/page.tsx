import { V2NewProjectClient } from './V2NewProjectClient'
import {
  requireAuthenticatedPageAccess,
  type PageSearchParams,
} from '@/lib/auth/page-access'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<PageSearchParams>
}

export default async function V2NewProjectPage({ params, searchParams }: PageProps) {
  const [{ locale }, query] = await Promise.all([params, searchParams])

  await requireAuthenticatedPageAccess({
    locale,
    pathname: `/${locale}/v2/new`,
    searchParams: query,
  })

  return <V2NewProjectClient locale={locale} />
}
