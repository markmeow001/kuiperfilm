import { V2HomeClient } from './V2HomeClient'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function V2RootPage({ params }: PageProps) {
  const { locale } = await params
  return <V2HomeClient locale={locale} />
}
