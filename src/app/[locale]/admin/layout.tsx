import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAdmin } from '@/lib/auth/user-role'

/**
 * Server-side admin gate. Non-admin sessions get bounced before any
 * admin route handler renders, so we never leak the existence of admin
 * pages to the page tree of regular users.
 *
 * The downstream admin API routes also enforce requireAdminAuth, so this
 * layout is "defense in depth": cosmetic redirect + real ACL on the API.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = (await getServerSession(authOptions)) as
    | { user?: { id?: string } }
    | null
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/${locale}/auth/signin`)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  })
  if (!user || user.isActive === false || !isAdmin(user.role)) {
    redirect(`/${locale}`)
  }

  return <div className="kuiper-studio-page">{children}</div>
}
