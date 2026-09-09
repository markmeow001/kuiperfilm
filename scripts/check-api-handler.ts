import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const API_ROOT = 'src/app/api'

const ALLOWLIST = new Set([
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/files/[...path]/route.ts',
  'src/app/api/system/boot-id/route.ts',
])

// Walk with fs rather than shelling out: the guard is the first step of
// test:regression, so a missing ripgrep used to take the whole gate down
// with a `command not found` that looked like a real violation.
function collectRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectRouteFiles(path, found)
    } else if (entry.name === 'route.ts') {
      found.push(path)
    }
  }
  return found
}

function main() {
  const files = collectRouteFiles(API_ROOT).sort()

  const missing: string[] = []

  for (const file of files) {
    if (ALLOWLIST.has(file)) continue
    // Match the sanctioned handler family: apiHandler (session auth) and
    // publicApiHandler (API-key auth, src/lib/api-keys/public-api-handler.ts).
    const hasApiHandler = /apiHandler|publicApiHandler/.test(readFileSync(file, 'utf8'))
    if (!hasApiHandler) {
      missing.push(file)
    }
  }

  if (missing.length > 0) {
    _ulogError('[check-api-handler] missing apiHandler in:')
    for (const file of missing) {
      _ulogError(`- ${file}`)
    }
    process.exit(1)
  }

  _ulogInfo(`[check-api-handler] ok total=${files.length} allowlist=${ALLOWLIST.size}`)
}

main()
