import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { prisma } from '@/lib/prisma'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import {
  AUTO_GROUP_MAX_INPUT_TOKENS,
  AUTO_GROUP_MAX_OUTPUT_TOKENS,
  AUTO_GROUP_MAX_PANEL_COUNT,
  AUTO_GROUP_MAX_PROMPT_UTF8_BYTES,
  AUTO_GROUP_MIN_PANEL_COUNT,
  AUTO_GROUP_PROVIDER_MAX_RETRIES,
  autoGroupPromptByteLength,
} from '@/lib/novel-promotion/auto-group-multi-shot-policy'

type JsonRecord = Record<string, unknown>

interface PanelForLlm {
  id: string
  index: number
  description: string
  location: string
  characters: string
  dialogue: string
  speaker: string
}

interface AutoGroup {
  id: string
  panelIds: string[]
  reason?: string
}

const MIN_GROUP_SIZE = AUTO_GROUP_MIN_PANEL_COUNT
const MAX_GROUP_SIZE = 6

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function fail(code: string): never {
  const error = new Error(code)
  ;(error as Error & { code: string }).code = code
  throw error
}

function pruneJsonFences(value: string): string {
  const trimmed = value.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fence ? fence[1].trim() : trimmed
}

function parsePanelCharacters(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.map(String).join(', ').slice(0, 120)
  } catch {
    // Preserve malformed legacy data as bounded plain text for the prompt.
  }
  return raw.slice(0, 120)
}

function extractSpeakerHint(srtSegment: string | null | undefined): string {
  if (!srtSegment) return ''
  const match = srtSegment.trim().match(/^([^\s:：说說「"']{1,20})\s*[:：说說]/)
  return match?.[1]?.trim() ?? ''
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return rightSet.size === right.length && left.every((id) => rightSet.has(id))
}

function safeGroupId(taskId: string, index: number): string {
  return `auto:${taskId}:${index + 1}`
}

function normalizeGroups(params: {
  rawGroups: unknown
  orderedPanelIds: readonly string[]
  taskId: string
}): AutoGroup[] {
  if (!Array.isArray(params.rawGroups) || params.rawGroups.length === 0) {
    fail('AUTO_GROUP_LLM_OUTPUT_INVALID')
  }

  const panelIdSet = new Set(params.orderedPanelIds)
  const assigned = new Set<string>()
  const groups: AutoGroup[] = []

  for (const rawGroup of params.rawGroups) {
    const group = asRecord(rawGroup)
    if (!group || !Array.isArray(group.panelIds)) continue
    const seenInGroup = new Set<string>()
    const panelIds = group.panelIds.filter((value): value is string => {
      if (
        typeof value !== 'string'
        || !panelIdSet.has(value)
        || assigned.has(value)
        || seenInGroup.has(value)
      ) {
        return false
      }
      seenInGroup.add(value)
      return true
    })
    if (panelIds.length < MIN_GROUP_SIZE || panelIds.length > MAX_GROUP_SIZE) continue

    panelIds.forEach((id) => assigned.add(id))
    const reason = readString(group.reason)?.slice(0, 500)
    groups.push({
      id: safeGroupId(params.taskId, groups.length),
      panelIds,
      ...(reason ? { reason } : {}),
    })
  }

  if (groups.length === 0) fail('AUTO_GROUP_LLM_OUTPUT_NO_VALID_GROUPS')

  const leftovers = params.orderedPanelIds.filter((id) => !assigned.has(id))
  while (leftovers.length > 0) {
    if (leftovers.length === 1) {
      const lastGroup = groups.at(-1)
      if (lastGroup && lastGroup.panelIds.length < MAX_GROUP_SIZE) {
        const id = leftovers.shift()
        if (id) {
          lastGroup.panelIds.push(id)
          assigned.add(id)
        }
      } else if (lastGroup && lastGroup.panelIds.length > MIN_GROUP_SIZE) {
        const leftoverId = leftovers.shift()
        const borrowedId = lastGroup.panelIds.pop()
        if (leftoverId && borrowedId) {
          assigned.add(leftoverId)
          groups.push({
            id: safeGroupId(params.taskId, groups.length),
            panelIds: [borrowedId, leftoverId],
            reason: 'tail leftovers',
          })
        }
      }
      break
    }

    let take = Math.min(MAX_GROUP_SIZE, leftovers.length)
    if (leftovers.length - take === 1 && take > MIN_GROUP_SIZE) take -= 1
    const panelIds = leftovers.splice(0, take)
    panelIds.forEach((id) => assigned.add(id))
    groups.push({
      id: safeGroupId(params.taskId, groups.length),
      panelIds,
      reason: 'tail leftovers',
    })
  }

  if (assigned.size !== params.orderedPanelIds.length) {
    fail('AUTO_GROUP_LLM_OUTPUT_INCOMPLETE')
  }

  return groups
}

/**
 * Durable worker boundary for episode auto-grouping.
 *
 * The route pins the selected model and creates/freezes the Task first. This
 * handler then re-authorizes the project/episode relationship, checks the Task
 * immediately before the provider, and persists only through relation-scoped
 * updateMany calls inside one transaction.
 */
export async function handleAutoGroupMultiShotTask(job: Job<TaskJobData>) {
  const payload = asRecord(job.data.payload) ?? {}
  const episodeId = readString(job.data.episodeId)
  const payloadEpisodeId = readString(payload.episodeId)
  const analysisModel = readString(payload.analysisModel)
  const maxInputTokens = payload.maxInputTokens
  const maxOutputTokens = payload.maxOutputTokens

  if (
    !episodeId
    || payloadEpisodeId !== episodeId
    || job.data.targetType !== 'NovelPromotionEpisode'
    || job.data.targetId !== episodeId
  ) {
    fail('AUTO_GROUP_TASK_TARGET_INVALID')
  }
  if (!analysisModel) fail('AUTO_GROUP_ANALYSIS_MODEL_REQUIRED')
  if (
    maxInputTokens !== AUTO_GROUP_MAX_INPUT_TOKENS
    || maxOutputTokens !== AUTO_GROUP_MAX_OUTPUT_TOKENS
  ) {
    fail('AUTO_GROUP_TASK_BUDGET_INVALID')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId: job.data.projectId },
    },
    select: {
      id: true,
      novelPromotionProject: {
        select: { projectId: true, targetDuration: true },
      },
      storyboards: {
        select: {
          panels: {
            select: {
              id: true,
              panelIndex: true,
              description: true,
              location: true,
              characters: true,
              srtSegment: true,
            },
            orderBy: { panelIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!episode) fail('AUTO_GROUP_EPISODE_SCOPE_MISMATCH')

  const allPanels = episode.storyboards.flatMap((storyboard) => storyboard.panels)
  if (allPanels.length < MIN_GROUP_SIZE) fail('AUTO_GROUP_NOT_ENOUGH_PANELS')
  if (allPanels.length > AUTO_GROUP_MAX_PANEL_COUNT) {
    fail('AUTO_GROUP_PANEL_BUDGET_EXCEEDED')
  }

  const panelsForLlm: PanelForLlm[] = allPanels.map((panel, index) => ({
    id: panel.id,
    index: index + 1,
    description: (panel.description || '').slice(0, 200),
    location: (panel.location || '').slice(0, 80),
    characters: parsePanelCharacters(panel.characters),
    dialogue: (panel.srtSegment || '').trim().slice(0, 240),
    speaker: extractSpeakerHint(panel.srtSegment),
  }))
  const targetDurationSeconds = episode.novelPromotionProject.targetDuration ?? 60
  const targetGroupCountApprox = Math.max(2, Math.round(targetDurationSeconds / 12))
  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_AUTO_GROUP_MULTI_SHOT,
    locale: job.data.locale,
    variables: {
      panels_json: JSON.stringify(panelsForLlm, null, 2),
      panel_count: String(panelsForLlm.length),
      target_duration_seconds: String(targetDurationSeconds),
      target_group_count_approx: String(targetGroupCountApprox),
    },
  })
  if (autoGroupPromptByteLength(prompt) > AUTO_GROUP_MAX_PROMPT_UTF8_BYTES) {
    fail('AUTO_GROUP_PROMPT_BUDGET_EXCEEDED')
  }

  await reportTaskProgress(job, 20, {
    stage: 'auto_group_prepare',
    panelCount: allPanels.length,
  })
  await assertTaskActive(job, 'auto_group_before_provider')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model: analysisModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    maxRetries: AUTO_GROUP_PROVIDER_MAX_RETRIES,
    maxOutputTokens,
    projectId: job.data.projectId,
    action: 'auto_group_multi_shot',
    meta: {
      stepId: 'auto_group_multi_shot',
      stepTitle: 'Multi-shot grouping',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  let parsed: JsonRecord
  try {
    const value = JSON.parse(pruneJsonFences(completion.text)) as unknown
    parsed = asRecord(value) ?? fail('AUTO_GROUP_LLM_OUTPUT_INVALID')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AUTO_GROUP_')) throw error
    fail('AUTO_GROUP_LLM_OUTPUT_NOT_JSON')
  }

  const orderedPanelIds = allPanels.map((panel) => panel.id)
  const groups = normalizeGroups({
    rawGroups: parsed.groups,
    orderedPanelIds,
    taskId: job.data.taskId,
  })
  const groupedCount = new Set(groups.flatMap((group) => group.panelIds)).size

  await reportTaskProgress(job, 80, {
    stage: 'auto_group_persist',
    groupCount: groups.length,
  })
  await assertTaskActive(job, 'auto_group_before_persist')

  const relationScope = {
    episode: {
      id: episodeId,
      novelPromotionProject: { projectId: job.data.projectId },
    },
  }

  await prisma.$transaction(async (tx) => {
    const currentPanels = await tx.novelPromotionPanel.findMany({
      where: { storyboard: relationScope },
      select: { id: true },
    })
    if (!sameIdSet(orderedPanelIds, currentPanels.map((panel) => panel.id))) {
      fail('AUTO_GROUP_PANEL_SET_CHANGED')
    }

    const cleared = await tx.novelPromotionPanel.updateMany({
      where: {
        id: { in: orderedPanelIds },
        storyboard: relationScope,
      },
      data: { multiShotGroupId: null, multiShotGroupOrder: null },
    })
    if (cleared.count !== orderedPanelIds.length) fail('AUTO_GROUP_SCOPED_CLEAR_MISMATCH')

    for (const group of groups) {
      for (let index = 0; index < group.panelIds.length; index += 1) {
        const panelId = group.panelIds[index]
        const updated = await tx.novelPromotionPanel.updateMany({
          where: {
            id: panelId,
            storyboard: relationScope,
          },
          data: {
            multiShotGroupId: group.id,
            multiShotGroupOrder: index,
          },
        })
        if (updated.count !== 1) fail('AUTO_GROUP_SCOPED_WRITE_MISMATCH')
      }
    }
  })

  return {
    groups,
    panelCount: allPanels.length,
    groupedCount,
    modelUsed: analysisModel,
  }
}
