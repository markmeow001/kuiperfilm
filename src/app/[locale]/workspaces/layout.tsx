import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Workspace management page — open to any authenticated user.
 * Role-based UI affordances (create / add-member / transfer) are
 * gated client-side based on session.role; the underlying API
 * routes also enforce role checks (defense in depth).
 *
 * Member sees: workspaces they're a member of (read-only).
 * Editor sees: workspaces they own + memberships, can create + manage own.
 * Admin sees: everything, can manage anything, can transfer ownership.
 */
export default async function WorkspacesLayout({
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
    select: { isActive: true },
  })
  if (!user || user.isActive === false) {
    redirect(`/${locale}`)
  }

  return <>{children}</>
}
