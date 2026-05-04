import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  AnyObj,
  clampCount,
  collectPanelReferenceImages,
  collectPanelSceneBase,
  findCharacterByName,
  findPropByName,
  parsePanelCharacterReferences,
  parsePanelPropReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import {
  buildPanelPrompt,
  parseJsonUnknown,
  pickAppearanceDescription,
} from './panel-image-task-handler-utils'
import { loadStyleProfile } from '@/lib/style-profile/loader'

/**
 * Build natural-language scene description from panel data.
 * Image generation models work much better with plain text than JSON blobs.
 */
function buildSceneDescription(params: {
  panel: {
    id: string
    shotType: string | null
    cameraMove: string | null
    description: string | null
    videoPrompt: string | null
    location: string | null
    characters: string | null
    // Phase 11.3 Stage 2 — JSON-encoded prop names referenced in this panel.
    props: string | null
    srtSegment: string | null
    photographyRules: string | null
    actingNotes: string | null
  }
  projectData: Awaited<ReturnType<typeof resolveNovelData>>
}): string {
  const lines: string[] = []

  // Scene description — the most important part
  const description = params.panel.description || params.panel.videoPrompt || ''
  if (description) lines.push(description)

  // Shot type and camera
  const shotParts: string[] = []
  if (params.panel.shotType) shotParts.push(params.panel.shotType)
  if (params.panel.cameraMove) shotParts.push(params.panel.cameraMove)
  if (shotParts.length > 0) lines.push(`镜头：${shotParts.join('，')}`)

  // Characters with appearance descriptions
  // 2026-05-04 — when LLM extraction left panel.characters empty
  // (iangyc 王玄 case), mine character names out of the description /
  // videoPrompt body so the prompt still surfaces the correct character
  // identity. Mirrors the description-mining fallback in
  // collectPanelReferenceImages — same source, same priority order,
  // same 3-cap. Both must agree so refs and prompt stay in sync.
  let panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  if (panelCharacters.length === 0) {
    const descSource = `${params.panel.description ?? ''}\n${params.panel.videoPrompt ?? ''}`.trim()
    if (descSource && (params.projectData.characters?.length ?? 0) > 0) {
      const mined: typeof panelCharacters = []
      for (const c of params.projectData.characters!) {
        if (mined.length >= 3) break
        if (!c.name) continue
        const aliases = c.name.split('/').map((s) => s.trim()).filter(Boolean)
        if (aliases.some((alias) => descSource.includes(alias))) {
          mined.push({ name: c.name })
        }
      }
      panelCharacters = mined
    }
  }
  if (panelCharacters.length > 0) {
    const charDescs = panelCharacters.map((reference) => {
      const character = findCharacterByName(params.projectData.characters || [], reference.name)
      if (!character) return reference.name

      const appearances = character.appearances || []
      const matchedAppearance =
        (reference.appearance
          ? appearances.find((a) => (a.changeReason || '').toLowerCase() === reference.appearance!.toLowerCase())
          : null) || appearances[0] || null

      const desc = matchedAppearance ? pickAppearanceDescription(matchedAppearance) : ''
      return desc ? `${character.name}（${desc}）` : character.name
    })
    lines.push(`角色：${charDescs.join('、')}`)
  }

  // Location — supports the "<name>#<viewName>" hint syntax for
  // Approach B-Standard 多視角. When viewName matches a sub-image of
  // the location, we surface that image's description instead of the
  // main view's so the prompt reflects the angle the user chose.
  if (params.panel.location) {
    const rawLoc = params.panel.location
    const hashIdx = rawLoc.indexOf('#')
    const baseLocName = hashIdx === -1 ? rawLoc : rawLoc.slice(0, hashIdx).trim()
    const viewHint = hashIdx === -1 ? null : (rawLoc.slice(hashIdx + 1).trim() || null)
    const matchedLocation = (params.projectData.locations || []).find(
      (item) => item.name.toLowerCase() === baseLocName.toLowerCase(),
    )
    const locDesc = matchedLocation
      ? (() => {
          const images = matchedLocation.images || []
          let pick = null
          if (viewHint) {
            pick = images.find((img) => ((img as { viewName?: string | null }).viewName || '').toLowerCase() === viewHint.toLowerCase()) || null
          }
          if (!pick) pick = images.find((img) => img.isSelected) || images[0] || null
          const label = viewHint ? `${matchedLocation.name}（${viewHint}視角）` : matchedLocation.name
          return pick?.description ? `${label}：${pick.description}` : label
        })()
      : rawLoc
    lines.push(`场景：${locDesc}`)
  }

  // Phase 11.3 Stage 2 — props line.
  // Surface each panel-referenced prop with its prop description (or
  // summary fallback) so the model knows what objects belong in shot.
  // Description comes from extract_props LLM (prompt-friendly visual
  // summary); summary is the human-facing label. Prefer description.
  // Missing-from-catalog props get the bare name (catalog drift).
  const panelProps = parsePanelPropReferences(params.panel.props)
  if (panelProps.length > 0) {
    const propDescs = panelProps.map((reference) => {
      const prop = findPropByName(params.projectData.props || [], reference.name)
      if (!prop) return reference.name
      const desc = prop.description || prop.summary || ''
      return desc ? `${prop.name}（${desc}）` : prop.name
    })
    lines.push(`道具：${propDescs.join('、')}`)
  }

  // Photography rules as plain text
  const rules = parseJsonUnknown(params.panel.photographyRules)
  if (rules && typeof rules === 'object') {
    const ruleEntries = Object.entries(rules as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
    if (ruleEntries.length > 0) lines.push(`摄影：${ruleEntries.join('，')}`)
  }

  // Acting notes as plain text
  const notes = parseJsonUnknown(params.panel.actingNotes)
  if (notes && typeof notes === 'object') {
    const noteEntries = Object.entries(notes as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
    if (noteEntries.length > 0) lines.push(`表演：${noteEntries.join('，')}`)
  }

  return lines.join('\n')
}


export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    include: {
      // Phase 11.4 / multi-appearance: panel → storyboard.episodeId so we
      // can resolve the episode's per-character appearance bindings.
      storyboard: { select: { episodeId: true } },
    },
  })

  if (!panel) throw new Error('Panel not found')

  const projectData = await resolveNovelData(job.data.projectId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const candidateCount = clampCount(payload.candidateCount ?? payload.count, 1, 4, 1)
  const isFluxKontext = modelKey.startsWith('flux-kontext')

  const episodeId = panel.storyboard?.episodeId ?? null

  // Flux Kontext: scene base only (it treats inputImage as edit base, not character ref)
  // Other models: full reference images (character + location)
  const refs = isFluxKontext
    ? await collectPanelSceneBase(projectData, panel)
    : await collectPanelReferenceImages(projectData, panel, episodeId)
  const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      modelKey,
      candidateCount,
      referenceImagesRawCount: refs.length,
      referenceImagesNormalizedCount: normalizedRefs.length,
      rawUrls: refs.map((u) => u.substring(0, 100)),
      normalizedUrls: normalizedRefs.map((u) => u.substring(0, 100)),
      panelCharacters: panel.characters,
      panelLocation: panel.location,
      panelProps: panel.props,
    },
  })

  // Q-006: artStyle / artStylePrompt are deactivated. styleProfile (loaded below)
  // is the only style anchor and is injected at the chokepoint.
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio
  const sceneText = buildSceneDescription({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      videoPrompt: panel.videoPrompt,
      location: panel.location,
      characters: panel.characters,
      props: panel.props,
      srtSegment: panel.srtSegment,
      photographyRules: panel.photographyRules,
      actingNotes: panel.actingNotes,
    },
    projectData,
  })
  // Q-006: artStyle is deactivated. styleProfile.positivePrompt is prepended at
  // the chokepoint, so we pass a neutral fallback for the {style} template var
  // (kept for prompt template compatibility; not a runtime style source).
  let prompt = buildPanelPrompt({
    locale: job.data.locale,
    aspectRatio,
    styleText: '与参考图风格一致',
    sourceText: panel.srtSegment || panel.description || '',
    sceneText,
  })

  // KieAI models (Nano Banana, Flux Kontext) all have 3000 char prompt limit
  const PROMPT_MAX_LENGTH = 2900
  const isLengthLimited = prompt.length > PROMPT_MAX_LENGTH
  if (isLengthLimited) {
    logger.warn({
      message: 'prompt exceeds length limit, truncating',
      details: { originalLength: prompt.length, maxLength: PROMPT_MAX_LENGTH },
    })
    prompt = prompt.substring(0, PROMPT_MAX_LENGTH)
  }

  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
      truncated: isLengthLimited && prompt.length >= PROMPT_MAX_LENGTH,
      prompt: prompt.substring(0, 1500),
    },
  })

  // Phase 11.5 / Bug-4: chokepoint owns prepend + capability filter. Handler passes
  // raw prompt + raw styleProfile + caller-controlled refs.
  const styleProfile = await loadStyleProfile(prisma, job.data.projectId)

  const candidates: string[] = []

  for (let i = 0; i < candidateCount; i++) {
    await reportTaskProgress(job, 18 + Math.floor((i / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: i,
    })

    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: modelKey,
      prompt,
      options: {
        referenceImages: normalizedRefs,
        aspectRatio,
      },
      pollProgress: { start: 30, end: 90 },
      styleProfile,
    })

    const cosKey = await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${i}`)
    candidates.push(cosKey)
  }

  const isFirstGeneration = !panel.imageUrl

  await assertTaskActive(job, 'persist_panel_image')
  if (isFirstGeneration) {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        imageUrl: candidates[0] || null,
        candidateImages: candidateCount > 1 ? JSON.stringify(candidates) : null,
      },
    })
  } else {
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl,
        // Single candidate: directly replace imageUrl so user sees the new image immediately
        ...(candidateCount === 1
          ? { imageUrl: candidates[0] || null, candidateImages: null }
          : { candidateImages: JSON.stringify(candidates) }),
      },
    })
  }

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: isFirstGeneration ? candidates[0] || null : null,
  }
}
