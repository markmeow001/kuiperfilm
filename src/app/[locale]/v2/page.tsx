import { V2HomeClient } from './V2HomeClient'
import {
  requireAuthenticatedPageAccess,
  type PageSearchParams,
} from '@/lib/auth/page-access'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<PageSearchParams>
}

export default async function V2RootPage({ params, searchParams }: PageProps) {
  const [{ locale }, query] = await Promise.all([params, searchParams])

  await requireAuthenticatedPageAccess({
    locale,
    pathname: `/${locale}/v2`,
    searchParams: query,
  })

  return <V2HomeClient locale={locale} />
}
