import { describe, expect, it } from 'vitest'
import type { ProjectHomeEpisode, ProjectHomeProject } from '@/app/[locale]/v2/workspace/[projectId]/project-home-model'
import {
  buildProjectHomeModel,
  formatProjectDate,
  storyExcerpt,
} from '@/app/[locale]/v2/workspace/[projectId]/project-home-model'
import { parseProjectHomeEpisodes } from '@/app/[locale]/v2/workspace/[projectId]/useProjectHomeEpisodes'

function buildProject(overrides: Partial<ProjectHomeProject> = {}): ProjectHomeProject {
  return {
    id: 'project-1',
    name: '雨夜車站',
    description: '一場錯過十年的重逢。',
    mode: 'novel-promotion',
    userId: 'user-1',
    createdAt: new Date('2026-08-08T00:00:00.000Z'),
    updatedAt: new Date('2026-08-08T00:00:00.000Z'),
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
    ...overrides,
  }
}

function buildEpisode(overrides: Partial<ProjectHomeEpisode> = {}): ProjectHomeEpisode {
  return {
    id: 'episode-1',
    episodeNumber: 1,
    name: '第一集',
    description: '兩人在月台重逢。',
    novelText: '雨落在月台上。',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    thumbnailUrl: null,
    progress: {
      scriptDone: 1,
      scriptTotal: 1,
      storyboardDone: 2,
      storyboardTotal: 4,
      videoDone: 1,
      videoTotal: 4,
    },
    ...overrides,
  }
}

describe('project home model', () => {
  it('部分分鏡與影片 -> 標記進行中並選擇第一個未完成階段', () => {
    const project = buildProject({
      novelPromotionData: {
        ...buildProject().novelPromotionData!,
        characters: [{ id: 'char-1', name: '林雨', appearances: [] }],
        locations: [{ id: 'loc-1', name: '月台', summary: null, images: [] }],
      },
    })
    const model = buildProjectHomeModel(project, [buildEpisode()], 0)

    expect(model.stageStatus.script).toBe('done')
    expect(model.stageStatus.subjects).toBe('done')
    expect(model.stageStatus.storyboard).toBe('in-progress')
    expect(model.stageStatus.final).toBe('in-progress')
    expect(model.stageStatus.voice).toBe('unavailable')
    expect(model.nextStep).toBe('storyboard')
    expect(model.counts.storyboardDone).toBe(2)
    expect(model.counts.storyboardTotal).toBe(4)
  })

  it('劇集 API 失敗 -> 不把未知統計當成 0', () => {
    const model = buildProjectHomeModel(buildProject(), null, null)

    expect(model.counts.episodes).toBeNull()
    expect(model.counts.storyboardDone).toBeNull()
    expect(model.stageStatus.script).toBe('unavailable')
    expect(model.stageStatus.storyboard).toBe('unavailable')
    expect(model.storySource.origin).toBe('unavailable')
    expect(model.nextStep).toBeNull()
  })

  it('Voice 未接線且 Final 進行中 -> 不越過未知階段推薦假下一步', () => {
    const project = buildProject({
      novelPromotionData: {
        ...buildProject().novelPromotionData!,
        characters: [{ id: 'char-1', name: '林雨', appearances: [] }],
        locations: [{ id: 'loc-1', name: '月台', summary: null, images: [] }],
      },
    })
    const episode = buildEpisode({
      progress: {
        scriptDone: 1,
        scriptTotal: 1,
        storyboardDone: 4,
        storyboardTotal: 4,
        videoDone: 1,
        videoTotal: 4,
      },
    })

    const model = buildProjectHomeModel(project, [episode], 0)

    expect(model.stageStatus.storyboard).toBe('done')
    expect(model.stageStatus.voice).toBe('unavailable')
    expect(model.stageStatus.final).toBe('in-progress')
    expect(model.nextStep).toBeNull()
  })

  it('所有可判定階段已完成但 Voice 未接線 -> 不捏造下一步', () => {
    const project = buildProject({
      novelPromotionData: {
        ...buildProject().novelPromotionData!,
        characters: [{ id: 'char-1', name: '林雨', appearances: [] }],
        locations: [{ id: 'loc-1', name: '月台', summary: null, images: [] }],
      },
    })
    const episode = buildEpisode({
      progress: {
        scriptDone: 1,
        scriptTotal: 1,
        storyboardDone: 4,
        storyboardTotal: 4,
        videoDone: 4,
        videoTotal: 4,
      },
    })

    const model = buildProjectHomeModel(project, [episode], 0)

    expect(model.stageStatus.final).toBe('done')
    expect(model.stageStatus.voice).toBe('unavailable')
    expect(model.nextStep).toBeNull()
  })

  it('專案沒有全局原文 -> 使用已保存的各集原文組成 Story Bible 來源', () => {
    const model = buildProjectHomeModel(
      buildProject(),
      [
        buildEpisode({ novelText: '第一段。' }),
        buildEpisode({ id: 'episode-2', episodeNumber: 2, novelText: '第二段。' }),
      ],
      0,
    )

    expect(model.storySource.origin).toBe('episodes')
    expect(model.storySource.text).toBe('第一段。\n\n第二段。')
    expect(model.storySource.characterCount).toBe(8)
  })

  it('節錄長文 -> 保留上限並顯示省略符號', () => {
    expect(storyExcerpt('一二三四五', 3)).toBe('一二三…')
    expect(storyExcerpt('一二', 3)).toBe('一二')
  })

  it('日期無效 -> 明確回傳 null', () => {
    expect(formatProjectDate('not-a-date')).toBeNull()
    expect(formatProjectDate(null)).toBeNull()
  })

  it('劇集 API 回應缺少 progress -> 顯式失敗而非當成空進度', () => {
    expect(() => parseProjectHomeEpisodes({
      episodes: [{
        id: 'episode-1',
        episodeNumber: 1,
        name: '第一集',
        description: null,
        novelText: null,
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
        thumbnailUrl: null,
      }],
    })).toThrow('progress 不存在')
  })
})
