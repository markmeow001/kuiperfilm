import { SystemStateScreen } from '@/components/system/SystemStateScreen'

export default async function ForbiddenPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <SystemStateScreen state="forbidden" locale={locale} />
}
