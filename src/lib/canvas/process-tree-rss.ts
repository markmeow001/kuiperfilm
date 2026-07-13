import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

interface ProcessRow {
  pid: number
  ppid: number
  rssBytes: number
  command: string
}

function parsePsRows(stdout: string): ProcessRow[] {
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) throw new Error(`STORYBOARD_RSS_PS_PARSE_FAILED:${line}`)
    return { pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024, command: match[4] }
  })
}

async function readLinuxDirectChildren(pid: number): Promise<number[]> {
  const taskIds = await readdir(`/proc/${pid}/task`)
  const children = new Set<number>()
  await Promise.all(taskIds.map(async (taskId) => {
    const text = await readFile(`/proc/${pid}/task/${taskId}/children`, 'utf8')
    for (const value of text.trim().split(/\s+/).filter(Boolean)) children.add(Number(value))
  }))
  return [...children]
}

async function readLinuxCommand(pid: number): Promise<string> {
  return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ')
}

async function linuxTreeRssBytes(rootPid: number): Promise<number> {
  const visited = new Set<number>()
  const visit = async (pid: number): Promise<number> => {
    if (visited.has(pid)) return 0
    visited.add(pid)
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const rssKb = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1])
    if (!Number.isFinite(rssKb)) throw new Error(`STORYBOARD_RSS_STATUS_INVALID:${pid}`)
    const children = await readLinuxDirectChildren(pid)
    const childTotals = await Promise.all(children.map(visit))
    return rssKb * 1024 + childTotals.reduce((sum, value) => sum + value, 0)
  }
  return visit(rootPid)
}

async function psRows(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync('ps', ['-o', 'pid=,ppid=,rss=,command=', '-A'], { maxBuffer: 8 * 1024 * 1024 })
  return parsePsRows(stdout)
}

function treeRssFromRows(rootPid: number, rows: ProcessRow[]): number {
  const byParent = new Map<number, ProcessRow[]>()
  for (const row of rows) byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row])
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  if (!byPid.has(rootPid)) throw new Error(`STORYBOARD_BROWSER_PROCESS_MISSING:${rootPid}`)
  const visit = (pid: number): number => (byPid.get(pid)?.rssBytes ?? 0) + (byParent.get(pid) ?? []).reduce((sum, child) => sum + visit(child.pid), 0)
  return visit(rootPid)
}

export async function captureDirectChildPids(parentPid = process.pid): Promise<Set<number>> {
  if (process.platform === 'linux') return new Set(await readLinuxDirectChildren(parentPid))
  if (process.platform === 'darwin') return new Set((await psRows()).filter((row) => row.ppid === parentPid).map((row) => row.pid))
  throw new Error(`STORYBOARD_RSS_PLATFORM_UNSUPPORTED:${process.platform}`)
}

export async function findNewChromiumChildPid(previousChildren: ReadonlySet<number>, parentPid = process.pid): Promise<number> {
  const direct = process.platform === 'linux'
    ? await Promise.all((await readLinuxDirectChildren(parentPid)).map(async (pid) => ({ pid, command: await readLinuxCommand(pid) })))
    : (await psRows()).filter((row) => row.ppid === parentPid).map(({ pid, command }) => ({ pid, command }))
  const matches = direct.filter(({ pid, command }) => !previousChildren.has(pid) && /(?:chrome|chromium|headless_shell)/i.test(command))
  if (matches.length !== 1) throw new Error(`STORYBOARD_BROWSER_PID_UNRESOLVED:${matches.map((match) => match.pid).join(',')}`)
  return matches[0].pid
}

export async function readProcessTreeRssBytes(rootPid: number): Promise<number> {
  if (process.platform === 'linux') return linuxTreeRssBytes(rootPid)
  if (process.platform === 'darwin') return treeRssFromRows(rootPid, await psRows())
  throw new Error(`STORYBOARD_RSS_PLATFORM_UNSUPPORTED:${process.platform}`)
}

export const processTreeRssTestUtils = { parsePsRows, treeRssFromRows }
