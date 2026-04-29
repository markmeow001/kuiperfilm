import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Phase 11.1 — workspace project detail page integration test
 *
 * 跑：`npm run test:dom`
 *
 * 路徑（合約 Q-4 A：完全停止自動跳第一集，預設 dashboard）：
 *   - 1: project 無 episodes -> render <SmartImportWizard>
 *   - 2: 有 episodes 無 URL view -> render <OverviewView>（dashboard，不自動跳）
 *   - 3: URL `?view=episode&episode=ep-1` -> render <NovelPromotionWorkspace>
 *
 * Q-2 B：切集時 URL stage 保留（不重置）— 對應 router.replace 用法
 *
 * 注意：本檔案以 mock 方式測試 page 的 view-routing 行為，並非端對端拉真實資料庫。
 * 子元件全部 mock 成 stub，只要看 page 在不同 URL / data 下選了哪個分支。
 */

// ----- 頂層 mock：必須在 import 之前（vitest hoists vi.mock）-----

const routerReplace = vi.fn()
const routerPush = vi.fn()
const useParamsMock = vi.fn()
const useSearchParamsMock = vi.fn()
const useProjectDataMock = vi.fn()
const useEpisodeDataMock = vi.fn()
const queryClientMock = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => useParamsMock(),
  useRouter: () => ({
    replace: routerReplace,
    push: routerPush,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => useSearchParamsMock(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  }),
}))

vi.mock('@/lib/query/hooks', () => ({
  useProjectData: (...args: unknown[]) => useProjectDataMock(...args),
  useEpisodeData: (...args: unknown[]) => useEpisodeDataMock(...args),
}))

vi.mock('@/lib/query/keys', () => ({
  queryKeys: {
    projectData: (id: string) => ['projectData', id],
    episodeData: (a: string, b: string) => ['episodeData', a, b],
  },
}))

// 子元件 stub — 用 data-testid 區分分支
//
// NovelPromotionWorkspace 接收 onEpisodeSelect callback；mock 暴露一顆按鈕
// 讓測試可以 fire EpisodeTabBar 切集行為（驗 Q-2 B：URL stage 保留）
interface NovelPromotionWorkspaceMockProps {
  onEpisodeSelect?: (episodeId: string) => void
}

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/NovelPromotionWorkspace', () => ({
  default: (props: NovelPromotionWorkspaceMockProps) => (
    <div data-testid="branch-novel-promotion-workspace">
      <button
        data-testid="mock-tab-select-ep-2"
        onClick={() => props.onEpisodeSelect?.('ep-2')}
      >
        select-ep-2
      </button>
    </div>
  ),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/SmartImportWizard', () => ({
  default: () => <div data-testid="branch-smart-import-wizard" />,
}))

// page.tsx 預設 view（overview）走 OverviewView，不是 EpisodeList
vi.mock('@/app/[locale]/workspace/[projectId]/components/OverviewView', () => ({
  default: () => <div data-testid="branch-overview-view" />,
}))

vi.mock('@/components/Navbar', () => ({
  default: () => <div data-testid="navbar" />,
}))

vi.mock('@/components/task/TaskStatusInline', () => ({
  default: () => <div data-testid="task-status-inline" />,
}))

vi.mock('@/lib/task/presentation', () => ({
  resolveTaskPresentationState: () => ({ phase: 'processing' }),
}))

// ----- helpers -----

function buildSearchParams(map: Record<string, string>): URLSearchParams {
  return new URLSearchParams(map)
}

interface PageMountArgs {
  projectId?: string
  searchParams?: Record<string, string>
  project?: unknown
  loading?: boolean
  episode?: unknown
}

async function mountPage(args: PageMountArgs) {
  useParamsMock.mockReturnValue({ projectId: args.projectId ?? 'proj-1' })
  useSearchParamsMock.mockReturnValue(buildSearchParams(args.searchParams ?? {}))
  useProjectDataMock.mockReturnValue({
    data: args.project,
    isLoading: args.loading ?? false,
    error: null,
  })
  useEpisodeDataMock.mockReturnValue({ data: args.episode })

  // 動態 import 確保 mock 生效
  const { default: ProjectDetailPage } = await import(
    '@/app/[locale]/workspace/[projectId]/page'
  )

  render(<ProjectDetailPage />)
}

// ----- describe -----

describe('workspace project detail page — view routing (Phase 11.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClientMock.mockReset()
    routerReplace.mockReset()
    routerPush.mockReset()
  })

  it('路徑 1: project 無 episodes -> render <SmartImportWizard>', async () => {
    await mountPage({
      projectId: 'proj-1',
      searchParams: {},
      project: {
        id: 'proj-1',
        novelPromotionData: { episodes: [], importStatus: undefined },
      },
    })

    expect(screen.getByTestId('branch-smart-import-wizard')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-overview-view')).toBeNull()
    expect(screen.queryByTestId('branch-novel-promotion-workspace')).toBeNull()
  })

  it('路徑 1b: importStatus="pending" -> 仍 render <SmartImportWizard>', async () => {
    await mountPage({
      projectId: 'proj-1',
      searchParams: {},
      project: {
        id: 'proj-1',
        novelPromotionData: {
          episodes: [{ id: 'ep-1', episodeNumber: 1, name: 'EP1', createdAt: '2026-01-01' }],
          importStatus: 'pending',
        },
      },
    })

    expect(screen.getByTestId('branch-smart-import-wizard')).toBeInTheDocument()
  })

  // Q-4 A：有 episodes 但 URL 沒指定 view，應停在 dashboard，不自動跳第一集
  it('路徑 2 (Q-4 A): 有 episodes 無 URL view -> render <OverviewView> dashboard, 不自動跳第一集', async () => {
    await mountPage({
      projectId: 'proj-1',
      searchParams: {},
      project: {
        id: 'proj-1',
        name: 'My Drama',
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: 'EP1', createdAt: '2026-01-01' },
            { id: 'ep-2', episodeNumber: 2, name: 'EP2', createdAt: '2026-01-02' },
          ],
          importStatus: undefined,
        },
      },
    })

    // Dashboard 分支被選
    expect(screen.getByTestId('branch-overview-view')).toBeInTheDocument()
    // 不該誤跳到 episode workspace 或 import wizard
    expect(screen.queryByTestId('branch-novel-promotion-workspace')).toBeNull()
    expect(screen.queryByTestId('branch-smart-import-wizard')).toBeNull()
    // Q-4 A 強斷言：page 不該有 effect 自動把 episode ID 寫進 URL
    expect(routerReplace).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  // 路徑 3：URL view=episode 解析成 NovelPromotionWorkspace（episode 工作區）
  it('路徑 3: URL ?view=episode&episode=ep-1 -> render <NovelPromotionWorkspace>', async () => {
    await mountPage({
      projectId: 'proj-1',
      searchParams: { view: 'episode', episode: 'ep-1', stage: 'storyboard' },
      project: {
        id: 'proj-1',
        name: 'My Drama',
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: 'EP1', createdAt: '2026-01-01' },
            { id: 'ep-2', episodeNumber: 2, name: 'EP2', createdAt: '2026-01-02' },
          ],
          importStatus: undefined,
        },
      },
      // page 在 episode view 會等 currentEpisode 才 render workspace
      episode: { id: 'ep-1', episodeNumber: 1, name: 'EP1' },
    })

    expect(screen.getByTestId('branch-novel-promotion-workspace')).toBeInTheDocument()
    // overview / wizard 不應出現
    expect(screen.queryByTestId('branch-overview-view')).toBeNull()
    expect(screen.queryByTestId('branch-smart-import-wizard')).toBeNull()
  })

  it('Q-2 B: URL ?view=episode&episode=ep-1&stage=storyboard 切集到 ep-2 -> router.replace URL 仍含 stage=storyboard', async () => {
    await mountPage({
      projectId: 'proj-1',
      searchParams: { view: 'episode', episode: 'ep-1', stage: 'storyboard' },
      project: {
        id: 'proj-1',
        name: 'My Drama',
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: 'EP1', createdAt: '2026-01-01' },
            { id: 'ep-2', episodeNumber: 2, name: 'EP2', createdAt: '2026-01-02' },
          ],
          importStatus: undefined,
        },
      },
      episode: { id: 'ep-1', episodeNumber: 1, name: 'EP1' },
    })

    // 透過 mock NovelPromotionWorkspace 暴露的按鈕觸發 onEpisodeSelect('ep-2')
    const tabBtn = screen.getByTestId('mock-tab-select-ep-2')
    tabBtn.click()

    // page 應呼叫 router.replace 一次
    expect(routerReplace).toHaveBeenCalledTimes(1)
    const replaceUrl = routerReplace.mock.calls[0]?.[0] as string
    // URL stage 必須保留為 storyboard（Q-2 B），episode 必須換成 ep-2，view 必須是 episode
    expect(replaceUrl).toContain('stage=storyboard')
    expect(replaceUrl).toContain('episode=ep-2')
    expect(replaceUrl).toContain('view=episode')
    // 不該意外出現 stage 被重置成 config 的字樣
    expect(replaceUrl).not.toContain('stage=config')
  })

  it('Q-4 A: 有 episodes 但 URL 已有 episode 參數但無 view -> render dashboard, 不自動跳第一集', async () => {
    // 目的：驗證舊版「URL 沒 view 但有 episode 就 fallback 跳第一集」的 effect 已移除
    await mountPage({
      projectId: 'proj-1',
      // 注意：沒有 view，只帶 episode
      searchParams: { episode: 'ep-1' },
      project: {
        id: 'proj-1',
        name: 'My Drama',
        novelPromotionData: {
          episodes: [
            { id: 'ep-1', episodeNumber: 1, name: 'EP1', createdAt: '2026-01-01' },
            { id: 'ep-2', episodeNumber: 2, name: 'EP2', createdAt: '2026-01-02' },
          ],
          importStatus: undefined,
        },
      },
      episode: { id: 'ep-1', episodeNumber: 1, name: 'EP1' },
    })

    // 預設 view = overview → render dashboard
    expect(screen.getByTestId('branch-overview-view')).toBeInTheDocument()
    expect(screen.queryByTestId('branch-novel-promotion-workspace')).toBeNull()

    // 關鍵：page 不該因為「有 episodes」就 router.push/replace 寫一個 episode URL（自動跳）
    expect(routerPush).not.toHaveBeenCalled()
    expect(routerReplace).not.toHaveBeenCalled()
  })
})
