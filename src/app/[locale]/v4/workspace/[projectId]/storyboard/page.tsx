import { V4StoryboardClient } from './V4StoryboardClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V4StoryboardPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return <V4StoryboardClient projectId={projectId} locale={locale} />
}
