'use client'

/**
 * /m/playground — mobile conversational image generation (the mobile HOME).
 *
 * Chat-style Playground: prompt in, image out, thread = run history.
 * Auth mirrors /m/projects (client-side session gate → mobile signin).
 */
import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { MobilePlaygroundChat } from './MobilePlaygroundChat'

export default function MobilePlaygroundPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/${locale}/m/auth/signin?callbackUrl=/${locale}/m/playground`)
    }
  }, [status, router, locale])

  if (status !== 'authenticated') {
    return (
      <p className="pt-20 text-center font-mono text-[12px] text-stone-500">載入中…</p>
    )
  }

  return <MobilePlaygroundChat locale={locale} />
}
