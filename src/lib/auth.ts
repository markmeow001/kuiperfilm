import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { logAuthAction } from './logging/semantic'
import { prisma } from './prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authOptions: any = {
  adapter: PrismaAdapter(prisma),
  // 🔥 允许从任意 Host 访问（解决局域网访问问题）
  trustHost: true,
  // 🔥 根据 URL 协议决定是否使用 Secure Cookie
  // 局域网 HTTP 访问时需要关闭，否则 Cookie 无法设置
  useSecureCookies: (process.env.NEXTAUTH_URL || '').startsWith('https://'),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          logAuthAction('LOGIN', credentials?.username || 'unknown', { error: 'Missing credentials' })
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            name: credentials.username
          }
        })

        if (!user || !user.password) {
          logAuthAction('LOGIN', credentials.username, { error: 'User not found' })
          return null
        }

        // 多人系统：被停用的帐号不可登入
        if ((user as { isActive?: boolean }).isActive === false) {
          logAuthAction('LOGIN', credentials.username, { error: 'Account disabled' })
          return null
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          logAuthAction('LOGIN', credentials.username, { error: 'Invalid password' })
          return null
        }

        // 更新最近登入时间（错误不阻断登入流程）
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          })
        } catch (err) {
          logAuthAction('LOGIN', user.name, {
            userId: user.id,
            warning: 'failed to update lastLoginAt',
            error: err instanceof Error ? err.message : String(err),
          })
        }

        logAuthAction('LOGIN', user.name, { userId: user.id, success: true })

        return {
          id: user.id,
          name: user.name,
          role: (user as any).role || 'member',
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    }
  }
}
