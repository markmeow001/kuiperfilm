import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  AnyObj,
  collectPanelReferenceImages,
  findCharacterByName,
  parsePanelCharacterReferences,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { loadStyleProfile } from '@/lib/style-profile/loader'
import { canonicalizeEpisodeCharacterAppearances } from '@/lib/novel-promotion/episode-appearance'
import {
  requireNovelPromotionPanelInProject,
  updateNovelPromotionPanelInProject,
} from '@/lib/novel-promotion/project-scope'

// ── 构建变体提示词 ──────────────────────────────────────
interface VariantPromptParams {
  locale: TaskJobData['locale']
  originalDescription: string
  originalShotType: string
  originalCameraMove: string
  location: string
  charactersInfo: string
  variantTitle: string
  variantDescription: string
  targetShotType: string
  targetCameraMove: string
  videoPrompt: string
  characterAssets: string
  locationAsset: string
  aspectRatio: string
  style: string
}

function buildVariantPrompt(params: VariantPromptParams): string {
  return buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE,
    locale: params.locale,
    variables: {
      original_description: params.originalDescription,
      original_shot_type: params.originalShotType,
      original_camera_move: params.originalCameraMove,
      location: params.location,
      characters_info: params.charactersInfo,
      variant_title: params.variantTitle,
      variant_description: params.variantDescription,
      target_shot_type: params.targetShotType,
      target_camera_move: params.targetCameraMove,
      video_prompt: params.videoPrompt,
      character_assets: params.characterAssets,
      location_asset: params.locationAsset,
      aspect_ratio: params.aspectRatio,
      style: params.style,
    },
  })
}

// ── 构建角色和场景描述信息 ─────────────────────────────
function buildCharactersInfo(
  panel: { characters: string | null },
  projectData: { characters?: Array<{ name: string; introduction?: string | null; appearances?: Array<{ changeReason?: string | null }> }> },
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return '无角色'

  return panelCharacters.map(item => {
    const character = findCharacterByName(projectData.characters || [], item.name)
    const intro = character?.introduction || ''
    // The canonical resolver collapses this character to its one
    // episode-authorised appearance. The panel's legacy hint is descriptive
    // input only and cannot override that binding.
    const appearance = character?.appearances?.[0]?.changeReason || '默认形象'
    return `- ${item.name}（${appearance}）${intro ? `：${intro}` : ''}`
  }).join('\n')
}

function buildCharacterAssetsDescription(
  panel: { characters: string | null },
  projectData: { characters?: Array<{ name: string; appearances?: Array<{ changeReason?: string | null; imageUrl?: string | null }> }> },
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return '无角色参考图'

  return panelCharacters.map(item => {
    const character = findCharacterByName(projectData.characters || [], item.name)
    if (!character) return `- ${item.name}：无参考图`
    const hasAppearance = (character.appearances || []).length > 0
    return `- ${item.name}：${hasAppearance ? '已提供参考图' : '无参考图'}`
  }).join('\n')
}

interface PanelVariantPayload {
  shot_type?: string
  camera_move?: string
  description?: string
  video_prompt?: string
  title?: string
  location?: string
  characters?: unknown
}

export async function handlePanelVariantTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const newPanelId = pickFirstString(payload.newPanelId)
  const sourcePanelId = pickFirstString(payload.sourcePanelId)
  const variant: PanelVariantPayload = payload.variant && typeof payload.variant === 'object'
    ? (payload.variant as PanelVariantPayload)
    : {}

  if (!newPanelId || !sourcePanelId) {
    throw new Error('panel_variant missing newPanelId/sourcePanelId')
  }
  if (job.data.targetType !== 'NovelPromotionPanel' || job.data.targetId !== newPanelId) {
    throw new Error('PANEL_VARIANT_TARGET_MISMATCH')
  }

  // Queue payloads are durable and untrusted. Resolve both panels through
  // the project-scoped DAL before model/provider work, and require one
  // episode so the source image cannot smuggle another episode's identity.
  const newPanel = await requireNovelPromotionPanelInProject(job.data.projectId, newPanelId)
  const sourcePanel = await requireNovelPromotionPanelInProject(job.data.projectId, sourcePanelId)
  const episodeId = newPanel.storyboard.episodeId
  if (
    sourcePanel.storyboard.episodeId !== episodeId
    || (job.data.episodeId && job.data.episodeId !== episodeId)
  ) {
    throw new Error('PANEL_VARIANT_EPISODE_MISMATCH')
  }

  const rawProjectData = await resolveNovelData(job.data.projectId)
  const projectData = await canonicalizeEpisodeCharacterAppearances({
    projectId: job.data.projectId,
    episodeId,
    projectData: rawProjectData,
    panels: [newPanel, sourcePanel],
  })
  if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
  const aspectRatio = projectData.videoRatio

  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const storyboardModel = modelConfig.storyboardModel
  if (!storyboardModel) throw new Error('Storyboard model not configured')

  // 收集参考图（与 panel-image-task-handler 共用同一链路）
  const refs = await collectPanelReferenceImages(projectData, newPanel)
  // 额外加入源镜头图片作为参考
  const sourcePanelImageUrl = toSignedUrlIfCos(sourcePanel.imageUrl, 3600)
  if (sourcePanelImageUrl) refs.unshift(sourcePanelImageUrl)
  const normalizedRefs = await normalizeReferenceImagesForGeneration(refs)

  // 使用 agent_shot_variant_generate.txt 提示词模板
  // Q-006: artStyle is deactivated. styleProfile is the only style anchor and is
  // injected at the chokepoint; {style} template var falls back to a neutral phrase.
  const charactersInfo = buildCharactersInfo(newPanel, projectData)
  const characterAssetsDesc = buildCharacterAssetsDescription(newPanel, projectData)
  const locationName = newPanel.location || sourcePanel.location || ''

  const prompt = buildVariantPrompt({
    locale: job.data.locale,
    originalDescription: sourcePanel.description || '',
    originalShotType: sourcePanel.shotType || '',
    originalCameraMove: sourcePanel.cameraMove || '',
    location: locationName,
    charactersInfo,
    variantTitle: pickFirstString(variant.title) || '镜头变体',
    variantDescription: variant.description || '',
    targetShotType: variant.shot_type || sourcePanel.shotType || '',
    targetCameraMove: variant.camera_move || sourcePanel.cameraMove || '',
    videoPrompt: pickFirstString(variant.video_prompt, variant.description) || '',
    characterAssets: characterAssetsDesc,
    locationAsset: locationName ? `场景：${locationName}` : '无场景参考',
    aspectRatio,
    // 2026-05-13 style-conflict fix: styleProfile.positivePrompt prepend at the
    // chokepoint is the single style authority. Old '与参考图风格一致' literal
    // contradicted that and let identity-aware models (Kling-2.1) drag style
    // from the ref image. Empty string lets the prepend dominate.
    style: '',
  })

  _ulogInfo('[panel-variant] resolved variant prompt', prompt)

  // Variant handler must inject styleProfile so variants stay style-locked
  // with the rest of the project. The chokepoint owns both the positive-
  // prompt prepend and the capability filter.
  const styleProfile = await loadStyleProfile(prisma, job.data.projectId)

  await assertTaskActive(job, 'generate_panel_variant_image')
  const source = await resolveImageSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: storyboardModel,
    prompt,
    options: {
      referenceImages: normalizedRefs,
      aspectRatio,
    },
    styleProfile,
  })

  const cosKey = await uploadImageSourceToCos(source, 'panel-variant', newPanel.id)

  await assertTaskActive(job, 'persist_panel_variant')
  await updateNovelPromotionPanelInProject(
    job.data.projectId,
    newPanel.id,
    { imageUrl: cosKey },
  )

  return {
    panelId: newPanel.id,
    storyboardId: newPanel.storyboardId,
    imageUrl: cosKey,
  }
}
