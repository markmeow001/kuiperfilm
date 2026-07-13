import { describe, expect, it } from 'vitest'
import { processTreeRssTestUtils } from '@/lib/canvas/process-tree-rss'

describe('Chromium process tree RSS accounting', () => {
  it('ps rows -> parses KiB as bytes and retains command', () => {
    expect(processTreeRssTestUtils.parsePsRows(' 100 1 2048 /chrome --headless\n101 100 512 renderer')).toEqual([
      { pid: 100, ppid: 1, rssBytes: 2 * 1024 * 1024, command: '/chrome --headless' },
      { pid: 101, ppid: 100, rssBytes: 512 * 1024, command: 'renderer' },
    ])
  })

  it('browser root with nested renderer and unrelated process -> sums only full browser tree', () => {
    const rows = processTreeRssTestUtils.parsePsRows('100 1 100 chrome\n101 100 40 renderer\n102 101 20 gpu-child\n200 1 999 unrelated')
    expect(processTreeRssTestUtils.treeRssFromRows(100, rows)).toBe(160 * 1024)
  })

  it('missing browser root -> fails explicitly instead of reporting zero', () => {
    expect(() => processTreeRssTestUtils.treeRssFromRows(404, [])).toThrow('STORYBOARD_BROWSER_PROCESS_MISSING:404')
  })
})
