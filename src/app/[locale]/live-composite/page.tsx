import { notFound, redirect } from 'next/navigation'
import { getAuthSession } from '@/lib/api-auth'
import { locales, type Locale } from '@/i18n/routing'
import { LiveCompositeClient } from './LiveCompositeClient'

interface PageProps {
  params: Promise<{ locale: string }>
}

function isSupportedLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value)
}

export default async function LiveCompositePage({ params }: PageProps) {
  const { locale } = await params
  if (!isSupportedLocale(locale)) notFound()
  const session = await getAuthSession()
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin?callbackUrl=${encodeURIComponent(`/${locale}/live-composite`)}`)
  }
  return <LiveCompositeClient locale={locale} userId={session.user.id} />
}
