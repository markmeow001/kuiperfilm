import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { readText, parseJsonResponse, detectScriptEthnicityHint } from './analyze-novel-utils'
import { processNewCharacters } from './analyze-novel-create-characters'
import { processNewLocations } from './analyze-novel-create-locations'
import { processUpdatedCharacters } from './analyze-novel-update-characters'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

export async function handleAnalyzeNovelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }
  if (project.mode !== 'novel-promotion') {
    throw new Error('Not a novel promotion project')
  }

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }
  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })

  // Stage C — honour the episodeId the caller asked for so users can
  // analyze any episode, not just the earliest. Falls back to the first
  // episode (legacy behaviour) when no episodeId supplied. globalAssetText
  // remains as a tertiary fallback for older projects that pre-date the
  // per-episode novelText storage.
  const requestedEpisodeId =
    typeof job.data.episodeId === 'string' && job.data.episodeId
      ? job.data.episodeId
      : typeof payload.episodeId === 'string' && payload.episodeId
        ? (payload.episodeId as string)
        : null

  const targetEpisode = requestedEpisodeId
    ? await prisma.novelPromotionEpisode.findFirst({
        where: { id: requestedEpisodeId, novelPromotionProjectId: novelData.id },
        select: { id: true, novelText: true },
      })
    : await prisma.novelPromotionEpisode.findFirst({
        where: { novelPromotionProjectId: novelData.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, novelText: true },
      })

  let contentToAnalyze = readText(targetEpisode?.novelText) || readText(novelData.globalAssetText)
  if (!contentToAnalyze.trim()) {
    throw new Error('请先填写全局资产设定或剧本内容')
  }

  const maxContentLength = 30000
  if (contentToAnalyze.length > maxContentLength) {
    contentToAnalyze = contentToAnalyze.substring(0, maxContentLength)
  }

  const charactersLibName = (novelData.characters || []).map((item) => item.name).join(', ')
  const locationsLibName = (novelData.locations || []).map((item) => item.name).join(', ')
  // Detect dominant script of the source so the LLM can default to a
  // sensible ethnicity when the script doesn't explicitly call one out.
  // Without this hint, Tencent VOD GEM-3.1 (East-Asian-trained) defaults
  // to Asian faces even for English / Spanish dramas — surprising users.
  const ethnicity = detectScriptEthnicityHint(contentToAnalyze)
  const characterPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      characters_lib_info: charactersLibName || '无',
      default_ethnicity_hint: ethnicity.ethnicityHint,
    },
  })
  const locationPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_SELECT_LOCATION,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      locations_lib_name: locationsLibName || '无',
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'analyze_novel_prepare',
    stageLabel: '准备资产分析参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'analyze_novel')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const [characterCompletion, locationCompletion] = await (async () => {
    try {
      return await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await Promise.all([
            executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: characterPromptTemplate }],
              temperature: 0.7,
              projectId,
              action: 'analyze_characters',
              meta: {
                stepId: 'analyze_characters',
                stepTitle: '角色分析',
                stepIndex: 1,
                stepTotal: 2,
              },
            }),
            executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: locationPromptTemplate }],
              temperature: 0.7,
              projectId,
              action: 'analyze_locations',
              meta: {
                stepId: 'analyze_locations',
                stepTitle: '场景分析',
                stepIndex: 2,
                stepTotal: 2,
              },
            }),
          ]),
      )
    } finally {
      await streamCallbacks.flush()
    }
  })()

  const characterResponseText = characterCompletion.text
  const locationResponseText = locationCompletion.text

  await reportTaskProgress(job, 60, {
    stage: 'analyze_novel_characters_done',
    stageLabel: '角色分析完成',
    displayMode: 'detail',
    stepId: 'analyze_characters',
    stepTitle: '角色分析',
    stepIndex: 1,
    stepTotal: 2,
    done: true,
    output: characterResponseText,
  })

  await reportTaskProgress(job, 70, {
    stage: 'analyze_novel_locations_done',
    stageLabel: '场景分析完成',
    displayMode: 'detail',
    stepId: 'analyze_locations',
    stepTitle: '场景分析',
    stepIndex: 2,
    stepTotal: 2,
    done: true,
    output: locationResponseText,
  })

  const charactersData = parseJsonResponse(characterResponseText)
  const locationsData = parseJsonResponse(locationResponseText)
  // The character prompt (NP_AGENT_CHARACTER_PROFILE) emits the new
  // structured shape `{ new_characters: [...], updated_characters: [...] }`.
  // Older fixtures used a flat `characters` key; accept both so legacy
  // test data and prompt regressions don't silently produce empty results.
  const parsedCharacters = Array.isArray(charactersData.new_characters)
    ? (charactersData.new_characters as Array<Record<string, unknown>>)
    : Array.isArray(charactersData.characters)
      ? (charactersData.characters as Array<Record<string, unknown>>)
      : []
  const parsedLocations = Array.isArray(locationsData.locations)
    ? (locationsData.locations as Array<Record<string, unknown>>)
    : []

  await reportTaskProgress(job, 75, {
    stage: 'analyze_novel_persist',
    stageLabel: '保存资产分析结果',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_persist')

  const createdCharacters = await processNewCharacters({
    parsedCharacters,
    existingCharacters: novelData.characters || [],
    novelPromotionProjectId: novelData.id,
  })

  // Update + backfill existing characters (legacy rescue path).
  // See processUpdatedCharacters for full rationale.
  const parsedUpdated = Array.isArray(charactersData.updated_characters)
    ? (charactersData.updated_characters as Array<Record<string, unknown>>)
    : []
  const updateResult = await processUpdatedCharacters({
    job,
    parsedUpdated,
    existingCharacters: novelData.characters || [],
    projectId,
  })

  // Link every character that was either created OR matched against the
  // existing library in this analyze pass to the *current* episode via
  // EpisodeCharacter. Without this, the V2 SubjectsPage filter (which
  // shows only characters in the active episode tab) would miss
  // episode-2 characters when the user expects "this episode's cast".
  if (targetEpisode?.id) {
    const matchedExistingIds: string[] = []
    for (const item of parsedUpdated) {
      const name = readText(item.name).trim()
      if (!name) continue
      const existing = (novelData.characters || []).find((c) => c.name === name)
      if (existing) matchedExistingIds.push(existing.id)
    }
    const allCharacterIds = [
      ...createdCharacters.map((c) => c.id),
      ...matchedExistingIds,
    ]
    if (allCharacterIds.length > 0) {
      try {
        await prisma.episodeCharacter.createMany({
          data: allCharacterIds.map((characterId) => ({
            episodeId: targetEpisode.id,
            characterId,
            role: 'analyze-extracted',
          })),
          skipDuplicates: true,
        })
      } catch (err) {
        _ulogError('[analyze-novel] EpisodeCharacter link failed', err, {
          episodeId: targetEpisode.id,
          characterCount: allCharacterIds.length,
        })
      }
    }
  }

  const createdLocations = await processNewLocations({
    parsedLocations,
    existingLocations: novelData.locations || [],
    novelPromotionProjectId: novelData.id,
  })

  // Phase 11.5: artStylePrompt 已 deprecated（被 styleProfile 三栏取代）。
  // 此处不再写入 artStylePrompt — 风格统一由 PATCH /api/projects/{id}/style-profile 管理。

  await reportTaskProgress(job, 96, {
    stage: 'analyze_novel_done',
    stageLabel: '资产分析已完成',
    displayMode: 'detail',
  })

  // Phase 12.x.x — cascade to clips → storyboard.
  //
  // Default OFF (opt-in) so legacy /workspace flows + Session A's
  // character-generation debugging path get analyze-only behaviour
  // they expect. The v2 SubjectsPage 一鍵分析 mutation explicitly
  // sends { cascadeToStoryboard: true } to opt in to the full chain.
  //
  // (Earlier this was default-on; flipped after Session A reported
  // surprise CLIPS_BUILD → SCRIPT_TO_STORYBOARD_RUN runs while
  // debugging character generation in isolation.)
  const cascade = payload.cascadeToStoryboard === true
  if (cascade && targetEpisode?.id) {
    try {
      await submitTask({
        userId: job.data.userId,
        locale: job.data.locale,
        projectId,
        episodeId: targetEpisode.id,
        type: TASK_TYPE.CLIPS_BUILD,
        targetType: 'NovelPromotionEpisode',
        targetId: targetEpisode.id,
        payload: {
          episodeId: targetEpisode.id,
          cascadeToStoryboard: true,
        },
        dedupeKey: `clips_build:${targetEpisode.id}`,
        priority: 2,
      })
      _ulogInfo('[analyze-novel] cascaded to clips_build', {
        projectId,
        episodeId: targetEpisode.id,
      })
    } catch (err) {
      // Swallow cascade errors — the analyze itself succeeded; the user
      // can manually trigger clips later. We log so admins see it on the
      // failed-runs dashboard.
      _ulogError('[analyze-novel] cascade to clips_build failed:', err)
    }
  }

  return {
    success: true,
    characters: createdCharacters,
    locations: createdLocations,
    characterCount: createdCharacters.length,
    locationCount: createdLocations.length,
    cascadedToClipsBuild: cascade && Boolean(targetEpisode?.id),
  }
}
