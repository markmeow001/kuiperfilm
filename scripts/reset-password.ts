/**
 * Reset a user's password from the CLI.
 *
 * KuiperAI's web UI does not yet expose a "change my password" form
 * for general users. Use this script for any out-of-band password
 * reset on the droplet (or from a dev shell against a dev DB).
 *
 * Usage on the droplet (recommended — password never touches shell history):
 *
 *   read -s -p "New password: " NEW_PASSWORD; echo
 *   docker exec -e NEW_PASSWORD="$NEW_PASSWORD" kuiper-app \
 *     pnpm tsx scripts/reset-password.ts --username admin
 *   unset NEW_PASSWORD
 *
 * The script never accepts the password as a command-line argument
 * because that leaks into shell history and `ps aux`.
 */

import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

interface Args {
  username: string
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--username') {
      args.username = argv[++i]
    }
  }
  if (!args.username) {
    console.error('Usage: tsx scripts/reset-password.ts --username <name>')
    console.error('Required env: NEW_PASSWORD (the new plaintext password)')
    process.exit(1)
  }
  return args as Args
}

function readPassword(): string {
  const password = process.env.NEW_PASSWORD
  if (!password) {
    console.error('Missing NEW_PASSWORD env var. See script header for usage.')
    process.exit(1)
  }
  return password
}

async function main(): Promise<void> {
  const { username } = parseArgs(process.argv.slice(2))
  const password = readPassword()
  if (password.length < 8) {
    console.error('Password must be at least 8 characters')
    process.exit(1)
  }

  const user = await prisma.user.findFirst({ where: { name: username } })
  if (!user) {
    console.error(`User not found: ${username}`)
    process.exit(1)
  }

  const hashed = await bcrypt.hash(password, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  })

  console.log(`[reset-password] OK — user "${username}" (id=${user.id}) password updated`)
  await prisma.$disconnect()
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[reset-password] FAILED: ${msg}`)
  process.exit(1)
})
