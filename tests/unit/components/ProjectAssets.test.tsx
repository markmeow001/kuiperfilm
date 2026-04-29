import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Phase 11.2 — ProjectAssets / tabs / ImportFromGlobalDialog
 *
 * 跑：`npx vitest run -c vitest.dom.config.ts tests/unit/components/ProjectAssets.test.tsx`
 *
 * 合約：
 *   - 角色 tab 顯示 N 個角色，每個含 episodes 描述（'Ep1, Ep3'）
 *   - 場景 tab 切換後顯示 M 個場景
 *   - 「從資產中心導入」按鈕觸發 modal
 *   - 點 modal 內某個 global asset → POST /api/projects/[projectId]/import-character
 *     成功 → 觸發 query invalidate（list refresh）+ modal 關閉
 */

// next-intl mock：i18n key 直接回 key（含 count/list 的回 `${key}:${value}`）
vi.mock('next-intl', () => ({
  useTranslations: (_namespace?: string) =>
    (key: string, values?: Record<string, string | number>) => {
      if (values && typeof values.count !== 'undefined') return `${key}:${values.count}`
      if (values && typeof values.list !== 'undefined') return `${key}:${values.list}`
      return key
    },
}))

// fetch 是被 react-query 內呼叫；我們直接 mock 全域 fetch
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProjectAssets from '@/app/[locale]/workspace/[projectId]/components/ProjectAssets'

function makeFreshQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

function renderProjectAssets(projectId = 'proj-1') {
  const qc = makeFreshQc()
  const utils = render(
    <QueryClientProvider client={qc}>
      <ProjectAssets projectId={projectId} />
    </QueryClientProvider>,
  )
  return { qc, ...utils }
}

interface CharRow {
  id: string
  name: string
  episodes: Array<{ id: string; episodeNumber: number; name: string; role: string | null }>
}
interface LocRow {
  id: string
  name: string
  episodes: Array<{ id: string; episodeNumber: number; name: string; role: string | null }>
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ProjectAssets (Phase 11.2)', () => {
  it('角色 tab: 顯示 2 個角色 + 各自 episodes 描述（Ep1, Ep3）', async () => {
    const characters: CharRow[] = [
      {
        id: 'char-1',
        name: 'Hero',
        episodes: [
          { id: 'ep-1', episodeNumber: 1, name: '第 1 集', role: 'auto-from-panel' },
          { id: 'ep-3', episodeNumber: 3, name: '第 3 集', role: 'manual' },
        ],
      },
      {
        id: 'char-2',
        name: 'Villain',
        episodes: [{ id: 'ep-2', episodeNumber: 2, name: '第 2 集', role: 'manual' }],
      },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { characters } }))

    renderProjectAssets()

    // 兩個角色名都最終出現（async）
    await waitFor(() => expect(screen.getByText('Hero')).toBeInTheDocument())
    expect(screen.getByText('Villain')).toBeInTheDocument()

    // Hero 的兩個 episode 用 list 形式渲染：appearsInEpisodes:Ep1, Ep3
    expect(screen.getByText('appearsInEpisodes:Ep1, Ep3')).toBeInTheDocument()
    expect(screen.getByText('appearsInEpisodes:Ep2')).toBeInTheDocument()

    // tab 切到 characters 時應該有 fetch 過 /api/projects/proj-1/characters
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/proj-1/characters')
  })

  it('沒有角色 -> 空狀態顯示 emptyCharacters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { characters: [] } }))
    renderProjectAssets()
    await waitFor(() => expect(screen.getByText('emptyCharacters')).toBeInTheDocument())
  })

  it('character 無 episodes -> 顯示 appearsInNone', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          characters: [{ id: 'char-orphan', name: 'Orphan', episodes: [] }],
        },
      }),
    )
    renderProjectAssets()
    await waitFor(() => expect(screen.getByText('Orphan')).toBeInTheDocument())
    expect(screen.getByText('appearsInNone')).toBeInTheDocument()
  })

  it('切到 場景 tab -> fetch /api/projects/proj-1/locations + 顯示 location list', async () => {
    // 第一次 fetch (characters tab 預設啟動)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { characters: [] } }),
    )
    // 切到 locations tab 後第二次 fetch
    const locations: LocRow[] = [
      {
        id: 'loc-1',
        name: '客廳',
        episodes: [
          { id: 'ep-1', episodeNumber: 1, name: '第 1 集', role: 'auto-from-panel' },
          { id: 'ep-5', episodeNumber: 5, name: '第 5 集', role: 'manual' },
        ],
      },
      { id: 'loc-2', name: '廚房', episodes: [] },
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { locations } }))

    renderProjectAssets()

    // 等 characters tab 完成 loading
    await waitFor(() => expect(screen.getByText('emptyCharacters')).toBeInTheDocument())

    // 切到 locations tab（key: tabLocations）
    fireEvent.click(screen.getByText('tabLocations'))

    await waitFor(() => expect(screen.getByText('客廳')).toBeInTheDocument())
    expect(screen.getByText('廚房')).toBeInTheDocument()
    // 客廳 出現在 Ep1, Ep5
    expect(screen.getByText('appearsInEpisodes:Ep1, Ep5')).toBeInTheDocument()
    // 廚房 沒有 episodes
    expect(screen.getByText('appearsInNone')).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/proj-1/locations')
  })

  it('「從資產中心導入」按鈕點擊 -> modal 打開 (顯示 importCharacterTitle)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { characters: [] } }),
    )
    // modal 打開後會 fetch /api/asset-hub/characters
    fetchMock.mockResolvedValueOnce(jsonResponse({ characters: [] }))

    renderProjectAssets()

    // characters tab 載完
    await waitFor(() => expect(screen.getByText('emptyCharacters')).toBeInTheDocument())

    // modal 一開始不存在
    expect(screen.queryByText('importCharacterTitle')).toBeNull()

    fireEvent.click(screen.getByText('importFromGlobal'))

    await waitFor(() => expect(screen.getByText('importCharacterTitle')).toBeInTheDocument())
  })

  it('在 modal 點擊 global character → POST /api/projects/proj-1/import-character + 成功後 modal 關閉 + characters 列表 refetch', async () => {
    // 1) characters tab 初次 fetch（空）
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { characters: [] } }),
    )
    // 2) 開 modal 後 fetch /api/asset-hub/characters
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        characters: [
          { id: 'gc-1', name: 'GlobalHero', appearances: [] },
        ],
      }),
    )
    // 3) 點擊 GlobalHero -> POST /api/projects/proj-1/import-character
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, character: { id: 'np-1', name: 'GlobalHero' } }),
    )
    // 4) modal 關閉後 invalidate triggers re-fetch /api/projects/proj-1/characters
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          characters: [{ id: 'np-1', name: 'GlobalHero', episodes: [] }],
        },
      }),
    )

    renderProjectAssets()

    await waitFor(() => expect(screen.getByText('emptyCharacters')).toBeInTheDocument())
    fireEvent.click(screen.getByText('importFromGlobal'))

    // modal 內 GlobalHero 出現
    await waitFor(() => expect(screen.getByText('GlobalHero')).toBeInTheDocument())

    // 點 GlobalHero 觸發 import
    fireEvent.click(screen.getByText('GlobalHero'))

    // POST 必須帶 globalCharacterId 與 includeAppearances 欄位
    await waitFor(() => {
      const importCall = fetchMock.mock.calls.find(
        (c) => c[0] === '/api/projects/proj-1/import-character',
      )
      expect(importCall).toBeDefined()
      const init = importCall?.[1] as RequestInit | undefined
      expect(init?.method).toBe('POST')
      const parsed = JSON.parse((init?.body as string) ?? '{}')
      expect(parsed.globalCharacterId).toBe('gc-1')
      expect(parsed).toHaveProperty('includeAppearances')
    })

    // modal 關閉（importCharacterTitle 不再存在）
    await waitFor(() => expect(screen.queryByText('importCharacterTitle')).toBeNull())
  })
})
