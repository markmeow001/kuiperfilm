import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import enProduction from '../../../messages/en/v2Production.json'
import zhProduction from '../../../messages/zh/v2Production.json'
import type {
  ProjectHomeEpisode,
  ProjectHomeProject,
} from '@/app/[locale]/v2/workspace/[projectId]/project-home-model'
import { buildProjectHomeModel } from '@/app/[locale]/v2/workspace/[projectId]/project-home-model'
import { ProjectHomeContent } from '@/app/[locale]/v2/workspace/[projectId]/ProjectHomeContent'

vi.mock('@/components/v2/project-graph/ProjectGraphPanel', () => ({
  ProjectGraphPanel: ({
    projectId,
    kicker,
  }: {
    projectId: string
    kicker: string
  }) => (
    <section data-testid="project-graph-panel">
      {kicker} · Graph · {projectId}
    </section>
  ),
}))

const project: ProjectHomeProject = {
  id: 'project-1',
  name: '雨夜車站',
  description: '一場錯過十年的重逢。',
  mode: 'novel-promotion',
  userId: 'user-1',
  createdAt: new Date('2026-08-08T00:00:00.000Z'),
  updatedAt: new Date('2026-08-08T00:00:00.000Z'),
  originSkillId: 'skill-1',
  originSkill: {
    id: 'skill-1',
    slug: 'continuity-first',
    name: 'Continuity First',
    nameEn: 'Continuity First',
    authorDisplay: 'Kuiperfilm',
    authorType: 'official',
    isFeatured: false,
  },
  novelPromotionData: {
    id: 'novel-1',
    projectId: 'project-1',
    stage: 'script',
    globalAssetText: null,
    novelText: null,
    analysisModel: 'provider::llm',
    imageModel: 'provider::image',
    characterModel: 'provider::image',
    locationModel: 'provider::image',
    storyboardModel: 'provider::image',
    editModel: 'provider::image',
    videoModel: 'provider::video',
    videoRatio: '16:9',
    targetDuration: 60,
    ttsRate: '1',
    workflowMode: 'agent',
    artStyle: '',
    artStylePrompt: null,
    audioUrl: null,
    srtContent: null,
    characters: [],
    locations: [],
  },
}

const episode: ProjectHomeEpisode = {
  id: 'episode-1',
  episodeNumber: 1,
  name: '第一集・月台',
  description: '兩人在月台重逢。',
  novelText: '雨落在月台上。',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  thumbnailUrl: null,
  progress: {
    scriptDone: 1,
    scriptTotal: 1,
    storyboardDone: 0,
    storyboardTotal: 0,
    videoDone: 0,
    videoTotal: 0,
  },
}

function renderHome(
  options: {
    episodes?: ProjectHomeEpisode[] | null
    canEdit?: boolean
    partialIssues?: string[]
    locale?: 'zh' | 'en'
    model?: ReturnType<typeof buildProjectHomeModel>
  } = {},
) {
  const episodes = options.episodes === undefined ? [episode] : options.episodes
  const model = options.model ?? buildProjectHomeModel(project, episodes, 0)
  const locale = options.locale ?? 'zh'
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{
        v2Production: locale === 'en' ? enProduction : zhProduction,
      }}
    >
      <ProjectHomeContent
        project={project}
        projectId="project-1"
        locale={locale}
        episodes={episodes}
        model={model}
        canEdit={options.canEdit ?? true}
        canManageCollaborators
        partialIssues={options.partialIssues}
        settingsPanel={<div>真實製作設定</div>}
        onOpenCollaborators={vi.fn()}
        onOpenAudit={vi.fn()}
      />
    </NextIntlClientProvider>,
  )
}

describe('V2 Project Home + Story Bible', () => {
  it('真實專案資料 -> 顯示標題、階段狀態與正確路由', () => {
    renderHome()

    const heading = screen.getByRole('heading', { level: 1, name: '雨夜車站' })
    expect(heading).toBeInTheDocument()
    expect(heading.closest('[class*="planningRoot"]')).not.toBeNull()
    expect(screen.getByText('一場錯過十年的重逢。')).toBeInTheDocument()
    expect(screen.getByText('專案首頁')).toBeInTheDocument()
    expect(screen.queryByText('Project · project-1')).not.toBeInTheDocument()
    expect(screen.getByText('劇本').closest('a')).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1/script',
    )
    expect(screen.getByText('進度未接線')).toBeInTheDocument()
    expect(screen.getByTestId('project-graph-panel')).toHaveTextContent(
      'Graph · project-1',
    )
  })

  it('切換故事依據 -> 顯示已保存原文、專案摘要與分集', () => {
    renderHome()
    fireEvent.click(screen.getByRole('tab', { name: '故事依據' }))

    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'id',
      'story-basis-panel',
    )
    expect(screen.getByText('雨落在月台上。')).toBeInTheDocument()
    expect(screen.getByText('第一集・月台')).toBeInTheDocument()
    expect(screen.getByText('兩人在月台重逢。')).toBeInTheDocument()
    expect(screen.getByText(/Canon 欄位尚未接線/)).toBeInTheDocument()
    expect(screen.queryByText(/待後端 Project Graph 接線/)).not.toBeInTheDocument()
  })

  it('沒有故事與分集 -> 顯示 first-empty 狀態而非虛構內容', () => {
    renderHome({ episodes: [] })
    fireEvent.click(screen.getByRole('tab', { name: '故事依據' }))

    expect(screen.getByText('尚未匯入故事原文')).toBeInTheDocument()
    expect(screen.getByText('尚未建立分集')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往劇本' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1/script',
    )
  })

  it('補充 API 失敗 -> 顯示 partial 原因且未知統計為破折號', () => {
    renderHome({ episodes: null, partialIssues: ['劇集進度：HTTP 500'] })

    expect(screen.getByText('部分製作統計暫時無法讀取')).toBeInTheDocument()
    expect(screen.getByText('劇集進度：HTTP 500')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('唯讀權限 -> 故事依據明示唯讀且設定不渲染可寫面板', () => {
    renderHome({ canEdit: false })
    expect(
      screen.getByRole('button', { name: '檢視故事依據' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '故事依據' }))
    expect(screen.getByText('故事依據目前為唯讀')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '檢視劇本' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '管理劇本' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '製作總覽' }))
    fireEvent.click(screen.getByText('製作規格與模型設定'))
    expect(screen.getByText('你目前只能檢視製作規格')).toBeInTheDocument()
    expect(screen.queryByText('真實製作設定')).not.toBeInTheDocument()
  })

  it('製作設定展開 -> 以規劃工作區表單層承接既有設定內容', () => {
    renderHome()

    fireEvent.click(screen.getByText('製作規格與模型設定'))

    const settings = screen.getByText('真實製作設定')
    expect(settings.closest('[class*="settingsBridge"]')).not.toBeNull()
    expect(settings.closest('[class*="settingsWell"]')).not.toBeNull()
  })

  it('檢視故事依據 -> 集中 activation 並把焦點移到目標 tab', async () => {
    renderHome()
    const trigger = screen.getByRole('button', { name: '管理故事依據' })
    trigger.focus()

    fireEvent.click(trigger)

    const storyBasisTab = screen.getByRole('tab', { name: '故事依據' })
    await waitFor(() => expect(storyBasisTab).toHaveFocus())
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'story-basis-panel')
  })

  it('Tab 鍵盤 Home/End -> 前往第一個或最後一個 tab 並同步焦點', async () => {
    renderHome()
    const overviewTab = screen.getByRole('tab', { name: '製作總覽' })

    fireEvent.keyDown(overviewTab, { key: 'End' })
    const storyBasisTab = screen.getByRole('tab', { name: '故事依據' })
    await waitFor(() => expect(storyBasisTab).toHaveFocus())

    fireEvent.keyDown(storyBasisTab, { key: 'Home' })
    await waitFor(() => expect(overviewTab).toHaveFocus())
  })

  it('Tab 鍵盤 ArrowLeft/ArrowRight -> 循環切換並同步焦點', async () => {
    renderHome()
    const overviewTab = screen.getByRole('tab', { name: '製作總覽' })

    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' })
    const storyBasisTab = screen.getByRole('tab', { name: '故事依據' })
    await waitFor(() => expect(storyBasisTab).toHaveFocus())

    fireEvent.keyDown(storyBasisTab, { key: 'ArrowLeft' })
    await waitFor(() => expect(overviewTab).toHaveFocus())
  })

  it('有可執行下一步 -> slate 位於統計前，編輯者 CTA 明示只開啟階段', () => {
    renderHome()

    const slate = screen.getByText('下一個安全動作').closest('section')
    const metrics = screen.getByRole('region', { name: '專案統計' })
    expect(slate).not.toBeNull()
    expect(
      slate?.compareDocumentPosition(metrics) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('link', { name: '編輯角色與場景' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1/subjects',
    )
    expect(screen.getByText(/不會建立生成任務或產生費用/)).toBeInTheDocument()
  })

  it('唯讀使用者有可執行下一步 -> CTA 使用檢視而不是編輯', () => {
    renderHome({ canEdit: false })

    expect(screen.getByRole('link', { name: '檢視角色與場景' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '編輯角色與場景' })).not.toBeInTheDocument()
  })

  it('nextStep 無法確定 -> 不建立假 href 或 CTA', () => {
    const undeterminedModel = {
      ...buildProjectHomeModel(project, [episode], 0),
      nextStep: null,
    }
    renderHome({ model: undeterminedModel })

    expect(screen.getByRole('heading', { name: '下一步尚未能確定' })).toBeInTheDocument()
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
    const nextAction = screen.getByRole('region', { name: '下一個安全動作' })
    expect(within(nextAction).queryByRole('link')).not.toBeInTheDocument()
  })

  it('English locale -> Project Home, workflow and Story Basis copy use English', () => {
    renderHome({ locale: 'en' })

    expect(screen.getByText('Project Home')).toBeInTheDocument()
    expect(screen.getByText('Skill source')).toBeInTheDocument()
    expect(screen.getByTestId('project-graph-panel')).toHaveTextContent(
      'Production lineage · read only',
    )
    expect(
      screen.getByRole('tab', { name: 'Production overview' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Workflow')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Story Basis' }))
    expect(
      screen.getByRole('heading', { name: 'Story source' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Episode structure')).toBeInTheDocument()
  })

  it('中文 Project Home -> Skill 與製作血緣 kicker 不混入固定英文', () => {
    renderHome()

    expect(screen.getByText('技能來源')).toBeInTheDocument()
    expect(screen.getByTestId('project-graph-panel')).toHaveTextContent(
      '製作血緣 · 唯讀',
    )
    expect(screen.queryByText('Skill source')).not.toBeInTheDocument()
    expect(
      screen.queryByText('PRODUCTION LINEAGE · READ ONLY'),
    ).not.toBeInTheDocument()
  })
})
