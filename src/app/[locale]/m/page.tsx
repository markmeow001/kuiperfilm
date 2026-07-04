/**
 * /m — mobile home. The conversational Playground IS the mobile home
 * (2026-07-04 user decision: 生圖對話 front and center); 劇集項目 review
 * lives one tap away at /m/projects.
 */
import { redirect } from 'next/navigation'

export default async function MobileHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/m/playground`)
}
