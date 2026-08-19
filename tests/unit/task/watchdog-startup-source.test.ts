import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('task watchdog startup source', () => {
  it('starts only the canonical instrumentation watchdog in dev and production', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const instrumentation = fs.readFileSync(path.join(root, 'src/instrumentation.ts'), 'utf8')
    const reconciliation = fs.readFileSync(path.join(root, 'src/lib/task/reconcile.ts'), 'utf8')

    expect(pkg.scripts.dev).not.toContain('watchdog')
    expect(pkg.scripts.start).not.toContain('watchdog')
    expect(pkg.scripts).not.toHaveProperty('dev:watchdog')
    expect(pkg.scripts).not.toHaveProperty('start:watchdog')
    expect(instrumentation.match(/startTaskWatchdog\(\)/g)).toHaveLength(1)
    expect(reconciliation.match(/setInterval\(/g)).toHaveLength(1)
    expect(reconciliation.match(/reconcileNextTerminalVoiceLinePublication\(\{/g) ?? []).toHaveLength(1)
  })

  it('replays only acknowledged queued tasks and compensates invalid rows safely', () => {
    const root = process.cwd()
    const instrumentation = fs.readFileSync(path.join(root, 'src/instrumentation.ts'), 'utf8')

    expect(instrumentation).toContain('enqueuedAt: { not: null }')
    expect(instrumentation).not.toMatch(
      /status:\s*['"]processing['"][\s\S]{0,300}status:\s*['"]queued['"]/,
    )
    expect(instrumentation).toContain('const replayCutoff = new Date()')
    expect(instrumentation).toContain("orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]")
    expect(instrumentation).toContain('createdAt: { lte: replayCutoff }')
    expect(instrumentation).toContain('createdAt: { gt: replayCursor.createdAt }')
    expect(instrumentation).toContain('id: { gt: replayCursor.id }')
    expect(instrumentation).toContain("const { failActiveTaskAndRollback } = await import('@/lib/task/service')")
    expect(instrumentation.match(/failActiveTaskAndRollback\(\{/g)).toHaveLength(2)
    expect(instrumentation).not.toMatch(
      /prisma\.task\.update\(\{[\s\S]*?status:\s*TASK_STATUS\.FAILED[\s\S]*?INVALID_TASK_TYPE/,
    )
  })
})
