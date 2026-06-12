import { V5StoryboardClient } from './V5StoryboardClient'

interface PageProps {
  params: Promise<{ locale: string; projectId: string }>
}

export default async function V5StoryboardPage({ params }: PageProps) {
  const { locale, projectId } = await params
  return <V5StoryboardClient projectId={projectId} locale={locale} />
}
