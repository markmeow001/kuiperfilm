import { buildCharactersIntroduction } from '@/lib/constants'
import { openingPacingDirective } from '@/lib/novel-promotion/generation-mode'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import { buildPhotographyPlan } from '@/lib/novel-promotion/photography-plan'
import {
  type ActingDirection,
  type CharacterAsset,
  type ClipCharacterRef,
  type LocationAsset,
  type PhotographyRule,
  type StoryboardPanel,
  formatClipId,
  getFilteredAppearanceList,
  getFilteredFullDescription,
  getFilteredLocationsDescription,
} from '@/lib/storyboard-phases'

type JsonRecord = Record<string, unknown>
const orchestratorLogger = createScopedLogger({ module: 'worker.orchestrator.script_to_storyboard' })

export type ScriptToStoryboardStepMeta = {
  stepId: string
  stepAttempt?: number
  stepTitle: string
  stepIndex: number
  stepTotal: number
}

export type ScriptToStoryboardStepOutput = {
  text: string
  reasoning: string
}

type ClipInput = {
  id: string
  content: string | null
  characters: string | null
  location: string | null
  screenplay: string | null
}

export type ScriptToStoryboardPromptTemplates = {
  phase1PlanTemplate: string
  phase2CinematographyTemplate: string
  phase2ActingTemplate: string
  phase3DetailTemplate: string
}

export type ClipStoryboardPanels = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type ScriptToStoryboardOrchestratorInput = {
  clips: ClipInput[]
  targetDuration?: number
  novelPromotionData: {
    characters: CharacterAsset[]
    locations: LocationAsset[]
    /** Opening-pacing setting (hook | cinematic) → {opening_pacing_directive}. */
    openingPacing?: string | null
  }
  promptTemplates: ScriptToStoryboardPromptTemplates
  runStep: (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    maxOutputTokens: number,
  ) => Promise<ScriptToStoryboardStepOutput>
  onClipComplete?: (clip: ClipStoryboardPanels) => Promise<void>
}

export type ScriptToStoryboardOrchestratorResult = {
  clipPanels: ClipStoryboardPanels[]
  summary: {
    clipCount: number
    totalPanelCount: number
    totalStepCount: number
  }
}


export class JsonParseError extends Error {
  rawText: string
  constructor(message: string, rawText: string) {
    super(message)
    this.name = 'JsonParseError'
    this.rawText = rawText
  }
}

// Strict JSON.parse rejects unescaped control chars (raw \t \n \r) inside
// string literals — the LLM output occasionally contains them, especially
// for long visual prompts that wrap. Walk char-by-char tracking in-string
// state and rewrite control chars to their escape sequences. Mirrors the
// helper in analyze-novel-utils.ts; duplicated here to keep this module
// free of cross-tree imports for an unrelated handler.
function sanitizeJsonControlChars(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) { out += ch; escaped = false; continue }
    if (inString && ch === '\\') { out += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; out += ch; continue }
    if (inString) {
      const code = text.charCodeAt(i)
      if (code === 0x09) { out += '\\t'; continue }
      if (code === 0x0a) { out += '\\n'; continue }
      if (code === 0x0d) { out += '\\r'; continue }
      if (code === 0x08) { out += '\\b'; continue }
      if (code === 0x0c) { out += '\\f'; continue }
      if (code < 0x20) continue
    }
    out += ch
  }
  return out
}

function parseJsonArray<T extends JsonRecord>(responseText: string, label: string): T[] {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')

  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new JsonParseError(`${label}: JSON format invalid`, responseText)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(sanitizeJsonControlChars(jsonText.slice(firstBracket, lastBracket + 1)))
  } catch (e) {
    throw new JsonParseError(
      `${label}: JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
      responseText,
    )
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new JsonParseError(`${label}: empty result`, responseText)
  }
  const rows = parsed.filter((item): item is T => typeof item === 'object' && item !== null)
  if (rows.length === 0) {
    throw new JsonParseError(`${label}: invalid payload`, responseText)
  }
  return rows
}


function parseClipCharacters(raw: string | null): ClipCharacterRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('characters field must be JSON array')
    }
    return parsed as ClipCharacterRef[]
  } catch (error) {
    throw new Error(`Invalid clip characters JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseScreenplay(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid clip screenplay JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function withStepMeta(
  stepId: string,
  stepTitle: string,
  stepIndex: number,
  stepTotal: number,
): ScriptToStoryboardStepMeta {
  return {
    stepId,
    stepTitle,
    stepIndex,
    stepTotal,
  }
}

function mergePanelsWithRules(params: {
  finalPanels: StoryboardPanel[]
  photographyRules: PhotographyRule[]
  actingDirections: ActingDirection[]
}) {
  const { finalPanels, photographyRules, actingDirections } = params
  return finalPanels.map((panel, index) => {
    const rules = photographyRules.find((rule) => rule.panel_number === panel.panel_number)
    if (!rules) {
      throw new Error(`Missing photography rule for panel_number=${String(panel.panel_number)} at index=${index}`)
    }
    const acting = actingDirections.find((item) => item.panel_number === panel.panel_number)
    if (!acting) {
      throw new Error(`Missing acting direction for panel_number=${String(panel.panel_number)} at index=${index}`)
    }

    return {
      ...panel,
      photographyPlan: buildPhotographyPlan(rules),
      actingNotes: acting.characters,
    }
  })
}

const MAX_STEP_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 10_000

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRetryDelayMs(attempt: number) {
  const base = Math.min(1_000 * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_DELAY_MS)
  const jitter = Math.floor(Math.random() * 300)
  return base + jitter
}

function shouldRetryStepError(error: unknown, message: string, retryable: boolean) {
  if (error instanceof JsonParseError) return true
  if (retryable) return true
  const lowerMessage = message.toLowerCase()
  return lowerMessage.includes('json') || lowerMessage.includes('parse')
}

async function runStepWithRetry<T>(
  runStep: ScriptToStoryboardOrchestratorInput['runStep'],
  baseMeta: ScriptToStoryboardStepMeta,
  prompt: string,
  action: string,
  maxOutputTokens: number,
  parse: (text: string) => T,
): Promise<{ output: ScriptToStoryboardStepOutput; parsed: T }> {
  let lastError: Error | null = null
  // Cumulative timing across retries so the caller can attribute wall time
  // to the action even when one attempt failed and another succeeded.
  const stepStartedAt = Date.now()
  for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
    const meta = attempt === 1
      ? baseMeta
      : {
        ...baseMeta,
        stepId: baseMeta.stepId,
        stepAttempt: attempt,
        stepTitle: baseMeta.stepTitle,
      }
    const attemptStartedAt = Date.now()
    try {
      const output = await runStep(meta, prompt, action, maxOutputTokens)
      const parsed = parse(output.text)
      const attemptDurationMs = Date.now() - attemptStartedAt
      const totalDurationMs = Date.now() - stepStartedAt
      orchestratorLogger.info({
        action: 'orchestrator.step.complete',
        message: `step ${action} completed`,
        details: {
          stepId: baseMeta.stepId,
          action,
          attempt,
          attempts: attempt,
          attemptDurationMs,
          totalDurationMs,
          promptChars: prompt.length,
          outputChars: typeof output.text === 'string' ? output.text.length : 0,
        },
      })
      return { output, parsed }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const normalizedError = normalizeAnyError(error, { context: 'worker' })
      const shouldRetry = attempt < MAX_STEP_ATTEMPTS
        && shouldRetryStepError(error, normalizedError.message, normalizedError.retryable)

      orchestratorLogger.error({
        action: 'orchestrator.step.retry',
        message: shouldRetry ? 'step failed, retrying' : 'step failed, no more retry',
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
        details: {
          stepId: baseMeta.stepId,
          action,
          attempt,
          maxAttempts: MAX_STEP_ATTEMPTS,
        },
        error: {
          name: lastError.name,
          message: lastError.message,
          stack: lastError.stack,
        },
      })

      if (!shouldRetry) {
        break
      }
      const retryDelayMs = computeRetryDelayMs(attempt)
      await wait(retryDelayMs)
    }
  }
  throw lastError!
}

export async function runScriptToStoryboardOrchestrator(
  input: ScriptToStoryboardOrchestratorInput,
): Promise<ScriptToStoryboardOrchestratorResult> {
  const orchestratorStartedAt = Date.now()
  const { clips, targetDuration = 60, novelPromotionData, promptTemplates, runStep, onClipComplete } = input
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('No clips found')
  }

  orchestratorLogger.info({
    action: 'orchestrator.run.start',
    message: 'script-to-storyboard orchestrator started',
    details: {
      clipCount: clips.length,
      targetDurationSec: targetDuration,
      totalContentChars: clips.reduce(
        (sum, c) => sum + (typeof c.content === 'string' ? c.content.length : 0),
        0,
      ),
    },
  })

  const totalStepCount = clips.length * 4 + 2
  const charactersLibName = (novelPromotionData.characters || []).map((c) => c.name).join(', ') || '无'
  const locationsLibName = (novelPromotionData.locations || []).map((l) => l.name).join(', ') || '无'
  const charactersIntroduction = buildCharactersIntroduction(novelPromotionData.characters || [])

  // 2026-05-22 — AVG_PANEL_DURATION_SEC raised from 3.5 → 6.0.
  // Rationale: the Phase 1 prompt (agent_storyboard_plan.zh.txt:13) tells
  // the LLM to aim for "5-12s per panel". The old 3.5s constant computed a
  // target_panel_count that was ~70% higher than what the LLM was being
  // asked to produce — so the LLM consistently undershot (《迁徙》ep3:
  // 21 panels vs target 51 = 41% delivery). Aligning to 6.0 (mid-range
  // 5-7s) means targets the LLM can actually hit, and per-group durations
  // sum closer to the user's targetDuration instead of half of it.
  const AVG_PANEL_DURATION_SEC = 6.0
  const totalTargetPanels = Math.round(targetDuration / AVG_PANEL_DURATION_SEC)
  const totalContentLength = clips.reduce((sum, c) => sum + (typeof c.content === 'string' ? c.content.trim().length : 0), 0)
  const clipTargetPanels = clips.map((c) => {
    const clipLen = typeof c.content === 'string' ? c.content.trim().length : 0
    return Math.max(2, Math.round(totalTargetPanels * clipLen / (totalContentLength || 1)))
  })

  const phase1PanelsByClipId = new Map<string, StoryboardPanel[]>()

  const phase1StartedAt = Date.now()
  const phase1Results = await Promise.all(
    clips.map(async (clip, i) => {
      const clipPhase1StartedAt = Date.now()
      const clipIndex = i + 1
      const clipContent = typeof clip.content === 'string' ? clip.content.trim() : ''
      if (!clipContent) {
        throw new Error(`Clip ${formatClipId(clip)} content is empty`)
      }
      const clipCharacters = parseClipCharacters(clip.characters)
      const filteredAppearanceList = getFilteredAppearanceList(novelPromotionData.characters || [], clipCharacters)
      const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters || [], clipCharacters)
      const clipJson = JSON.stringify(
        {
          id: clip.id,
          content: clipContent,
          characters: clipCharacters,
          location: clip.location || null,
        },
        null,
        2,
      )

      let phase1Prompt = promptTemplates.phase1PlanTemplate
        .replace('{characters_lib_name}', charactersLibName)
        .replace('{locations_lib_name}', locationsLibName)
        .replace('{characters_introduction}', charactersIntroduction)
        .replace('{characters_appearance_list}', filteredAppearanceList)
        .replace('{characters_full_description}', filteredFullDescription)
        .replace('{clip_json}', clipJson)
        // Global replace so a template using either placeholder more than
        // once (e.g. the EN plan, 2026-06-03) never ships a literal token.
        .replace(/\{target_duration\}/g, String(targetDuration))
        .replace(/\{target_panel_count\}/g, String(clipTargetPanels[i]))
        .replace('{opening_pacing_directive}', openingPacingDirective(novelPromotionData.openingPacing))

      const screenplay = parseScreenplay(clip.screenplay)
      if (screenplay) {
        phase1Prompt = phase1Prompt.replace('{clip_content}', `【剧本格式】\n${JSON.stringify(screenplay, null, 2)}`)
      } else {
        phase1Prompt = phase1Prompt.replace('{clip_content}', clipContent)
      }

      const phase1Meta = withStepMeta(
        `clip_${clip.id}_phase1`,
        'progress.streamStep.storyboardPlan',
        clipIndex,
        totalStepCount,
      )
      const { parsed: planPanels } = await runStepWithRetry(
        runStep, phase1Meta, phase1Prompt, 'storyboard_phase1_plan', 2600,
        (text) => {
          const panels = parseJsonArray<StoryboardPanel>(text, `phase1:${formatClipId(clip)}`)
          if (panels.length === 0) {
            throw new Error(`Phase 1 returned empty panels for clip ${formatClipId(clip)}`)
          }
          return panels
        },
      )

      orchestratorLogger.info({
        action: 'orchestrator.clip.phase1.complete',
        message: `phase1 for clip ${formatClipId(clip)} complete`,
        details: {
          clipId: clip.id,
          clipIndex,
          panelCountTarget: clipTargetPanels[i],
          panelCountActual: planPanels.length,
          durationMs: Date.now() - clipPhase1StartedAt,
        },
      })

      return {
        clipId: clip.id,
        planPanels,
      }
    }),
  )

  orchestratorLogger.info({
    action: 'orchestrator.phase1.complete',
    message: 'phase1 (storyboard plan) done for all clips',
    details: {
      clipCount: clips.length,
      totalDurationMs: Date.now() - phase1StartedAt,
      totalPanels: phase1Results.reduce((sum, r) => sum + r.planPanels.length, 0),
    },
  })

  for (const result of phase1Results) {
    phase1PanelsByClipId.set(result.clipId, result.planPanels)
  }

  // 2026-05-18 — Parallelize phase 2+3 across clips.
  //
  // Previously this was a serial for-loop, so a 5-clip episode paid
  // (clip0_phase23 + clip1_phase23 + ...) sequentially even though
  // each clip's three LLM calls (cinematography / acting / detail)
  // were already Promise.all'd within the clip. Timing data from
  // 2026-05-18 (147s total run): phase1 = 32.6s (parallel across
  // clips), phase23 = 114.8s (serial across clips) — 78% of wall time.
  //
  // New design:
  //   1. Run all clips' phase 2+3 LLM work in parallel via Promise.all
  //      (clip-internal parallelism still applies — 5 clips × 3 calls
  //      = 15 concurrent LLM calls peak).
  //   2. AFTER all phase23 work finishes, iterate results in clip order
  //      and fire onClipComplete sequentially. This preserves persist
  //      order (clipIndex 1..N) so downstream UI sees storyboards in
  //      the right sequence — but the slow LLM wait happens in one
  //      shared window, not N serialized ones.
  //
  // Estimated speedup at 5 clips: 114.8s → ~26s (slowest single clip's
  // phase23) = 88s saved, ~60% reduction in total wall time.
  //
  // Tradeoff: peaks at 5 × 3 = 15 concurrent LLM calls instead of 3.
  // Most providers (OpenRouter, Anthropic, OpenAI) tolerate this on
  // paid tiers. If we hit rate limits in production, switch to a
  // bounded pool (e.g. p-limit with concurrency=8). For now, observe.
  const phase23StartedAt = Date.now()
  const phase23Results = await Promise.all(
    clips.map(async (clip, index) => {
      const clipPhase23StartedAt = Date.now()
      const clipIndex = index + 1
      const clipCharacters = parseClipCharacters(clip.characters)
      const clipLocation = clip.location || null
      const planPanels = phase1PanelsByClipId.get(clip.id) || []
      if (planPanels.length === 0) {
        throw new Error(`Missing phase1 result for clip ${formatClipId(clip)}`)
      }

      const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters || [], clipCharacters)
      const filteredLocationsDescription = getFilteredLocationsDescription(
        novelPromotionData.locations || [],
        clipLocation,
      )

      const phase2Meta = withStepMeta(
        `clip_${clip.id}_phase2_cinematography`,
        'progress.streamStep.cinematographyRules',
        clips.length + index * 3 + 1,
        totalStepCount,
      )
      const phase2ActingMeta = withStepMeta(
        `clip_${clip.id}_phase2_acting`,
        'progress.streamStep.actingDirection',
        clips.length + index * 3 + 2,
        totalStepCount,
      )
      const phase3Meta = withStepMeta(
        `clip_${clip.id}_phase3_detail`,
        'progress.streamStep.storyboardDetailRefine',
        clips.length + index * 3 + 3,
        totalStepCount,
      )

      const phase2Prompt = promptTemplates.phase2CinematographyTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{locations_description}', filteredLocationsDescription)
        .replace('{characters_info}', filteredFullDescription)

      const phase2ActingPrompt = promptTemplates.phase2ActingTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{characters_info}', filteredFullDescription)

      const phase3Prompt = promptTemplates.phase3DetailTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{characters_age_gender}', filteredFullDescription)
        .replace('{locations_description}', filteredLocationsDescription)

      const [
        { parsed: photographyRules },
        { parsed: actingDirections },
        { parsed: filteredPhase3Panels },
      ] = await Promise.all([
        runStepWithRetry(
          runStep, phase2Meta, phase2Prompt, 'storyboard_phase2_cinematography', 2400,
          (text) => parseJsonArray<PhotographyRule>(text, `phase2:${formatClipId(clip)}`),
        ),
        runStepWithRetry(
          runStep, phase2ActingMeta, phase2ActingPrompt, 'storyboard_phase2_acting', 2400,
          (text) => parseJsonArray<ActingDirection>(text, `phase2-acting:${formatClipId(clip)}`),
        ),
        runStepWithRetry(
          runStep, phase3Meta, phase3Prompt, 'storyboard_phase3_detail', 2600,
          (text) => {
            const panels = parseJsonArray<StoryboardPanel>(text, `phase3:${formatClipId(clip)}`)
            const filtered = panels.filter(
              (panel) => panel.description && panel.description !== '无' && panel.location !== '无',
            )
            if (filtered.length === 0) {
              throw new Error(`Phase 3 returned empty valid panels for clip ${formatClipId(clip)}`)
            }
            return filtered
          },
        ),
      ])

      const result: ClipStoryboardPanels = {
        clipId: clip.id,
        clipIndex,
        finalPanels: mergePanelsWithRules({
          finalPanels: filteredPhase3Panels,
          photographyRules,
          actingDirections,
        }),
      }
      orchestratorLogger.info({
        action: 'orchestrator.clip.phase23.complete',
        message: `phase2+3 for clip ${formatClipId(clip)} complete`,
        details: {
          clipId: clip.id,
          clipIndex,
          finalPanelCount: result.finalPanels.length,
          durationMs: Date.now() - clipPhase23StartedAt,
        },
      })
      return result
    }),
  )

  // Sequential persist in clip order. Each persist is a fast DB write;
  // running them in series keeps storyboard rows ordered by clipIndex
  // and avoids concurrent transaction overhead on the same episode.
  const clipPanels: ClipStoryboardPanels[] = []
  for (const result of phase23Results) {
    clipPanels.push(result)
    if (onClipComplete) await onClipComplete(result)
  }

  const totalPanelCount = clipPanels.reduce((sum, item) => sum + item.finalPanels.length, 0)
  const totalDurationMs = Date.now() - orchestratorStartedAt
  orchestratorLogger.info({
    action: 'orchestrator.run.complete',
    message: 'script-to-storyboard orchestrator finished',
    details: {
      clipCount: clips.length,
      totalPanelCount,
      totalDurationMs,
      phase1DurationMs: phase23StartedAt - phase1StartedAt,
      phase23DurationMs: Date.now() - phase23StartedAt,
      avgPerClipMs: Math.round(totalDurationMs / Math.max(1, clips.length)),
    },
  })
  return {
    clipPanels,
    summary: {
      clipCount: clips.length,
      totalPanelCount,
      totalStepCount,
    },
  }
}
