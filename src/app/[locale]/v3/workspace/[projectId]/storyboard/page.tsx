import { V3StoryboardClient } from './V3StoryboardClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V3StoryboardPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return <V3StoryboardClient projectId={projectId} locale={locale} />
}
