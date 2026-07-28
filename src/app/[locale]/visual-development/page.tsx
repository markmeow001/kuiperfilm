import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { VisualDevelopmentClient } from './VisualDevelopmentClient'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function VisualDevelopmentPage({ params }: PageProps) {
  const { locale } = await params
  const session = await getAuthSession()

  if (!session?.user?.id) {
    const callbackUrl = `/${locale}/visual-development`
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }

  return <VisualDevelopmentClient locale={locale} />
}
