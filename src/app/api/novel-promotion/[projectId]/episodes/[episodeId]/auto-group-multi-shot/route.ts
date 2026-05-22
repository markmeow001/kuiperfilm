/**
 * Phase 12.5.3 — POST /api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot
 *
 * LLM-driven multi-shot grouping. Fetches every panel in the episode
 * (in storyboard.createdAt then panelIndex order), prompts the
 * configured analysis model to cluster them into groups of 2-6
 * sharing scene + character continuity, then persists the assignment
 * onto each panel as multiShotGroupId + multiShotGroupOrder.
 *
 * Synchronous: the LLM call typically returns in 5-15s for
 * 20-40 panels. No task plumbing — the response carries the groups
 * directly. Frontend can re-render the storyboard strip with the
 * new grouping immediately.
 *
 * Returns:
 * { groups: [{ id, panelIds, reason }, ...], panelCount, modelUsed }
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { executeAiTextStep } from '@/lib/ai-runtime'

interface PanelForLlm {
  id: string
  index: number
  description: string
  location: string
  characters: string
  /** Phase N (2026-05-21) — dialogue blob (panel.srtSegment trimmed
   *  + truncated). LLM uses this to keep "one person's continuous
   *  speech" inside the same group; never split mid-utterance. */
  dialogue: string
  /** Speaker name extracted from srtSegment if obvious (e.g.
   *  "Karrug: ..."), so LLM can detect "same speaker continues
   *  across panel 3 → 4" easily. */
  speaker: string
}

interface LlmGroup {
  id: string
  panelIds: string[]
  reason?: string
}

interface LlmResponse {
  groups: LlmGroup[]
}

const MIN_GROUP = 2
const MAX_GROUP = 6

function pruneJsonFences(s: string): string {
  // Strip ```json ... ``` wrappers if the model decided to ignore the
  // "no markdown" instruction (rare but happens).
  const trimmed = s.trim()
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fence ? fence[1].trim() : trimmed
}

function parsePanelChars(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return arr.map(String).join(', ')
  } catch {
    // fall through
  }
  return String(raw).slice(0, 120)
}

/**
 * Phase N (2026-05-21) — pull a likely speaker name out of srtSegment
 * so the LLM can detect "same speaker continues" boundaries.
 *
 * srtSegment formats we see in practice:
 *   - "Karrug: 「諸神震怒了！」" → speaker = "Karrug"
 *   - "Karrug说「諸神震怒了！」"  → speaker = "Karrug"
 *   - 旁白："廢墟之上..."        → speaker = "旁白"
 *   - bare quoted span           → speaker = "" (let LLM infer from characters)
 *
 * Returns '' when no obvious speaker prefix is present.
 */
function extractSpeakerHint(srtSegment: string | null | undefined): string {
  if (!srtSegment) return ''
  const trimmed = srtSegment.trim()
  // "<Name>: ..." / "<Name>：..." / "<Name>说..." / "<Name>說..."
  const match = trimmed.match(/^([^\s:：说說「"'']{1,20})\s*[:：说說]/)
  return match?.[1]?.trim() ?? ''
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json().catch(() => ({}))
  const locale = resolveRequiredTaskLocale(request, body as Record<string, unknown>)

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      novelPromotionProject: {
        select: { id: true, projectId: true, analysisModel: true, targetDuration: true },
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

  if (!episode) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
  }
  if (episode.novelPromotionProject?.projectId !== projectId) {
    throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_IN_PROJECT' })
  }

  const allPanels = episode.storyboards.flatMap((sb) => sb.panels)
  if (allPanels.length < MIN_GROUP) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NOT_ENOUGH_PANELS',
      details: { panelCount: allPanels.length, message: '至少需要 2 個分鏡才能切組' },
    })
  }

  // Build LLM input — include enough info that the model can judge scene
  // continuity, but stay compact so we don't blow context.
  const panelIdSet = new Set(allPanels.map((p) => p.id))
  const panelsForLlm: PanelForLlm[] = allPanels.map((p, i) => ({
    id: p.id,
    index: i + 1,
    description: (p.description || '').slice(0, 200),
    location: (p.location || '').slice(0, 80),
    characters: parsePanelChars(p.characters),
    dialogue: (p.srtSegment || '').trim().slice(0, 240),
    speaker: extractSpeakerHint(p.srtSegment),
  }))

  const analysisModel = await resolveAnalysisModel({
    userId: session.user.id,
    projectAnalysisModel: episode.novelPromotionProject.analysisModel,
  })

  // Phase Q (2026-05-21) — pass the project's targetDuration so the LLM
  // can size group count + per-group dialogue budget to hit the total.
  // Each Seedance / Kling composite group is 4-15s; for a 60s project
  // we want ~5 groups, 120s ~10, 180s ~15. LLM does the rough math from
  // the targetDuration_seconds variable + the per-group ≤12s soft cap.
  const targetDurationSeconds = episode.novelPromotionProject.targetDuration ?? 60
  const targetGroupCountApprox = Math.max(2, Math.round(targetDurationSeconds / 12))

  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_AUTO_GROUP_MULTI_SHOT,
    locale,
    variables: {
      panels_json: JSON.stringify(panelsForLlm, null, 2),
      panel_count: String(panelsForLlm.length),
      target_duration_seconds: String(targetDurationSeconds),
      target_group_count_approx: String(targetGroupCountApprox),
    },
  })

  let llmText: string
  try {
    const completion = await executeAiTextStep({
      userId: session.user.id,
      model: analysisModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      projectId,
      action: 'auto_group_multi_shot',
      meta: {
        stepId: 'auto_group_multi_shot',
        stepTitle: 'Multi-shot grouping',
        stepIndex: 1,
        stepTotal: 1,
      },
    })
    llmText = completion.text
  } catch (err) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'LLM_GROUPING_FAILED',
      details: { message: (err as Error).message },
    })
  }

  let parsed: LlmResponse
  try {
    parsed = JSON.parse(pruneJsonFences(llmText)) as LlmResponse
  } catch {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'LLM_OUTPUT_NOT_JSON',
      details: { rawSample: llmText.slice(0, 200) },
    })
  }

  if (!parsed?.groups || !Array.isArray(parsed.groups) || parsed.groups.length === 0) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'LLM_OUTPUT_INVALID',
      details: { message: 'LLM did not return any groups' },
    })
  }

  // Validate + sanitise groups
  const seenPanelIds = new Set<string>()
  const validGroups: LlmGroup[] = []
  for (const g of parsed.groups) {
    if (!g || typeof g.id !== 'string') continue
    if (!Array.isArray(g.panelIds)) continue
    const filtered = g.panelIds.filter(
      (id) => typeof id === 'string' && panelIdSet.has(id) && !seenPanelIds.has(id),
    )
    if (filtered.length < MIN_GROUP || filtered.length > MAX_GROUP) continue
    for (const id of filtered) seenPanelIds.add(id)
    validGroups.push({ id: g.id, panelIds: filtered, reason: g.reason })
  }

  if (validGroups.length === 0) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'LLM_OUTPUT_NO_VALID_GROUPS',
      details: {
        message: 'LLM groups did not satisfy size or panel-ID constraints',
        rawSample: llmText.slice(0, 200),
      },
    })
  }

  // Any panels the LLM forgot — append as a tail group with the previous
  // group (only if previous group has room <= 5). Otherwise create a small
  // tail group of any leftovers (still respecting min=2; if only 1 leftover
  // after merge, drop it — better to leave it ungrouped than break invariant).
  const leftoverIds = allPanels.map((p) => p.id).filter((id) => !seenPanelIds.has(id))
  if (leftoverIds.length > 0) {
    if (leftoverIds.length === 1) {
      const last = validGroups[validGroups.length - 1]
      if (last.panelIds.length < MAX_GROUP) {
        last.panelIds.push(leftoverIds[0])
        seenPanelIds.add(leftoverIds[0])
      }
      // else leave it ungrouped (better than violating max)
    } else {
      validGroups.push({
        id: `tail-${Date.now()}`,
        panelIds: leftoverIds.slice(0, MAX_GROUP),
        reason: 'tail leftovers',
      })
      for (const id of leftoverIds.slice(0, MAX_GROUP)) seenPanelIds.add(id)
    }
  }

  // Persist groups onto panels. Wrap in tx so we don't leave half-written.
  await prisma.$transaction(async (tx) => {
    // First clear any existing assignment on this episode's panels so reruns
    // don't leak stale group IDs onto panels that the LLM dropped this time.
    const allPanelIds = allPanels.map((p) => p.id)
    await tx.novelPromotionPanel.updateMany({
      where: { id: { in: allPanelIds } },
      data: { multiShotGroupId: null, multiShotGroupOrder: null },
    })
    for (const g of validGroups) {
      for (let i = 0; i < g.panelIds.length; i++) {
        await tx.novelPromotionPanel.update({
          where: { id: g.panelIds[i] },
          data: { multiShotGroupId: g.id, multiShotGroupOrder: i },
        })
      }
    }
  })

  return NextResponse.json({
    groups: validGroups,
    panelCount: allPanels.length,
    groupedCount: seenPanelIds.size,
    modelUsed: analysisModel,
  })
})
