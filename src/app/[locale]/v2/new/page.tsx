import { V2NewProjectClient } from './V2NewProjectClient'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function V2NewProjectPage({ params }: PageProps) {
  const { locale } = await params
  return <V2NewProjectClient locale={locale} />
}
