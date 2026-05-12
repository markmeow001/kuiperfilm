import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { getUserModelConfig } from '@/lib/config-service'
import {
  CHARACTER_IMAGE_BANANA_RATIO,
  addCharacterPromptSuffix,
} from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { getSignedUrl } from '@/lib/cos'
import { initializeFonts } from '@/lib/fonts'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { generateLabeledImageToCos } from './image-task-handler-shared'
import { loadStyleProfileByProjectId, type StyleProfile } from '@/lib/style-profile/loader'
import { logError } from '@/lib/logging/core'
import {
  parseReferenceImages,
  readBoolean,
  readString,
} from './reference-to-character-helpers'

async function generateLabeledImage(params: {
  job: Job<TaskJobData>
  imageIndex: number
  userId: string
  imageModel: string
  prompt: string
  referenceImages?: string[]
  keyPrefix: string
  labelText: string
  styleProfile: StyleProfile | null
}): Promise<string | null> {
  const {
    job,
    imageIndex,
    userId,
    imageModel,
    prompt,
    referenceImages,
    keyPrefix,
    labelText,
    styleProfile,
  } = params

  try {
    await assertTaskActive(job, `reference_to_character_generate_${imageIndex + 1}`)
    // Q-006 / Phase 11.5 / Bug-4: chokepoint owns styleProfile injection +
    // capability filter. We pass raw prompt + raw styleProfile and let
    // resolveImageSourceFromGeneration (via generateLabeledImageToCos) handle it.
    const cosKey = await generateLabeledImageToCos({
      job,
      userId,
      modelId: imageModel,
      prompt,
      label: labelText,
      targetId: `${imageIndex}`,
      keyPrefix,
      options: {
        referenceImages,
        aspectRatio: CHARACTER_IMAGE_BANANA_RATIO,
      },
      styleProfile,
    })
    return cosKey
  } catch (err) {
    // Explicit failure logging — never silently swallow (CLAUDE.md §3).
    logError('[reference-to-character] generateLabeledImage failed', err, {
      imageIndex,
      keyPrefix,
    })
    return null
  }
}

export async function handleReferenceToCharacterTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const allReferenceImages = parseReferenceImages(payload)
  if (allReferenceImages.length === 0) {
    throw new Error('Missing referenceImageUrl or referenceImageUrls')
  }

  const isAssetHub = job.data.type === TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER
  const isProject = job.data.type === TASK_TYPE.REFERENCE_TO_CHARACTER
  if (!isAssetHub && !isProject) {
    throw new Error(`Unsupported task type: ${job.data.type}`)
  }

  const isBackgroundJob = readBoolean(payload.isBackgroundJob)
  const appearanceId = readString(payload.appearanceId)
  const characterId = readString(payload.characterId)
  const extractOnly = readBoolean(payload.extractOnly)
  const customDescription = readString(payload.customDescription)
  const characterName = readString(payload.characterName) || '新角色 - 初始形象'
  // Q-006: artStyle deactivated. payload.artStyle is intentionally ignored.

  if (isBackgroundJob && (!characterId || !appearanceId)) {
    throw new Error('Missing characterId or appearanceId for background job')
  }

  await reportTaskProgress(job, 15, {
    stage: 'reference_to_character_prepare',
    stageLabel: '准备参考图转换参数',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'reference_to_character_prepare')

  await initializeFonts()

  const userConfig = await getUserModelConfig(job.data.userId)
  const imageModel = readString(userConfig.characterModel)
  const analysisModel = readString(userConfig.analysisModel)
  if (!imageModel && !extractOnly) {
    throw new Error('请先在设置页面配置角色图片模型')
  }
  if (!analysisModel && extractOnly) {
    throw new Error('请先在设置页面配置分析模型')
  }

  if (extractOnly) {
    await reportTaskProgress(job, 45, {
      stage: 'reference_to_character_extract',
      stageLabel: '提取参考图描述',
      displayMode: 'detail',
    })
    const completion = await executeAiVisionStep({
      userId: job.data.userId,
      model: analysisModel,
      prompt: buildPrompt({
        promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
        locale: job.data.locale,
      }),
      imageUrls: allReferenceImages,
      temperature: 0.3,
      ...(isProject ? { projectId: job.data.projectId } : {}),
    })
    await assertTaskActive(job, 'reference_to_character_extract_done')
    await reportTaskProgress(job, 96, {
      stage: 'reference_to_character_extract_done',
      stageLabel: '参考图描述提取完成',
      displayMode: 'detail',
    })
    return {
      success: true,
      description: completion.text,
    }
  }

  // Q-006 / Phase 11.5: load styleProfile so the chokepoint can prepend
  // styleProfile.positivePrompt + capability-filter negativePrompt /
  // referenceImageUrls. For asset-hub jobs, projectId is the sentinel
  // 'global-asset-hub' which has no NovelPromotionProject row; the loader
  // returns null in that case (chokepoint then becomes pass-through).
  const styleProfile = await loadStyleProfileByProjectId(prisma, job.data.projectId)

  const basePrompt = customDescription || buildPrompt({
    promptId: PROMPT_IDS.CHARACTER_REFERENCE_TO_SHEET,
    locale: job.data.locale,
  })
  const prompt = addCharacterPromptSuffix(basePrompt)

  const useReferenceImages = !customDescription

  // 2026-05-13 — FAL gate removed. The original gate (try get fal config →
  // skip multi-view if missing) was a leftover from when this handler
  // called fal.ai directly. The current implementation routes through
  // generateLabeledImageToCos → resolveImageSourceFromGeneration →
  // generateImage with the user's configured `characterModel` (Tencent
  // VOD GEM/Kling, KieAI, etc.) — fal isn't actually invoked at any
  // step. The boolean check just blocked legitimate usage from anyone
  // not on a fal plan, including the user reported 2026-05-13 who has
  // no fal key but uses Kling 2.1 for character images.
  //
  // Net behavior change: clicking "上傳並轉多視角(3 張)" in the V2
  // character edit modal now actually runs the 3-image-gen pipeline
  // for everyone with a configured characterModel, instead of silently
  // falling back to "store the original ref as the only result".
  let successfulCosKeys: string[]
  let description: string | null = null

  {
    const keyPrefix = isAssetHub ? 'ref-char' : `proj-ref-char-${job.data.projectId}`

    await reportTaskProgress(job, 35, {
      stage: 'reference_to_character_generate',
      stageLabel: '生成角色三视图',
      displayMode: 'detail',
    })

    const imageResults = await Promise.all([0, 1, 2].map(async (index) =>
      await generateLabeledImage({
        job,
        imageIndex: index,
        userId: job.data.userId,
        imageModel,
        prompt,
        referenceImages: useReferenceImages ? allReferenceImages : undefined,
        keyPrefix,
        labelText: characterName,
        styleProfile,
      }),
    ))

    successfulCosKeys = imageResults.filter((item): item is string => Boolean(item))

    // Safety net: if every gen failed (rate limit / model misconfig / etc.),
    // fall back to the original reference so the appearance row isn't
    // wiped to empty. Beats showing the user a broken character with no
    // image, and they can click 重新生成 to retry.
    if (successfulCosKeys.length === 0 && allReferenceImages.length > 0) {
      logError('[reference-to-character] all 3 multi-view gens failed, falling back to original ref', null, {
        keyPrefix,
        refCount: allReferenceImages.length,
      })
      successfulCosKeys = allReferenceImages
    }
  }

  if (analysisModel) {
    const analysisPrompt = buildPrompt({
      promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION,
      locale: job.data.locale,
    })
    const completion = await executeAiVisionStep({
      userId: job.data.userId,
      model: analysisModel,
      prompt: analysisPrompt,
      imageUrls: allReferenceImages,
      temperature: 0.3,
      ...(isProject ? { projectId: job.data.projectId } : {}),
    })
    description = completion.text
  }

  if (successfulCosKeys.length === 0) {
    throw new Error('图片生成失败')
  }

  await assertTaskActive(job, 'reference_to_character_persist')
  if (isBackgroundJob && appearanceId) {
    if (isAssetHub) {
      await prisma.globalCharacterAppearance.update({
        where: { id: appearanceId },
        data: {
          imageUrl: successfulCosKeys[0],
          imageUrls: encodeImageUrls(successfulCosKeys),
          description: description || undefined,
        },
      })
    } else {
      await prisma.characterAppearance.update({
        where: { id: appearanceId },
        data: {
          imageUrl: successfulCosKeys[0],
          imageUrls: encodeImageUrls(successfulCosKeys),
          description: description || undefined,
        },
      })
    }
    await reportTaskProgress(job, 96, {
      stage: 'reference_to_character_done',
      stageLabel: '参考图转换完成',
      displayMode: 'detail',
    })
    return { success: true }
  }

  const mainCosKey = successfulCosKeys[0]
  const mainSignedUrl = getSignedUrl(mainCosKey, 7 * 24 * 3600)

  await reportTaskProgress(job, 96, {
    stage: 'reference_to_character_done',
    stageLabel: '参考图转换完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    imageUrl: mainSignedUrl,
    cosKey: mainCosKey,
    cosKeys: successfulCosKeys,
    description,
  }
}
