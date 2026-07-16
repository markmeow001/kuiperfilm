import { redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { LiveCompositeClient } from './LiveCompositeClient'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function LiveCompositePage({ params }: PageProps) {
  const { locale } = await params
  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/live-composite`)}`)
  }
  return <LiveCompositeClient locale={locale} />
}
