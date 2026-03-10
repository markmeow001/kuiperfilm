import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { createScopedLogger } from '@/lib/logging/core'
import {
  parsePanelCharacterReferences,
  findCharacterByName,
  resolveNovelData,
  parseImageUrls,
} from './image-task-handler-shared'
import {
  assertTaskActive,
  ensureImageWithinKieAILimits,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
  waitExternalResult,
} from '../utils'
import { reportTaskProgress } from '../shared'
import {
  KieAIKlingVideoGenerator,
  type KlingElement,
  type MultiShotPromptItem,
} from '@/lib/generators/video/kieai-kling'

type AnyObj = Record<string, unknown>

/**
 * 将 prompt 中的角色名替换为 @element_xxx 引用
 */
function buildPromptWithElementRefs(prompt: string, elements: KlingElement[]): string {
  let result = prompt
  for (const element of elements) {
    // element.description 存的是角色原始名称
    const name = element.description
    if (!name) continue
    // 替换角色名为 @element_xxx 引用（全局替换）
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(escaped, 'g'), `@${element.name}`)
  }
  return result
}

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30)
}

export async function handleMultiShotVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const { projectId, userId } = job.data

  const logger = createScopedLogger({
    module: 'worker.multi-shot-video',
    action: 'multi_shot_video_generate',
  })

  const panelIds = payload.panelIds as string[]
  const videoModel = payload.videoModel as string
  const mode = (payload.mode as 'std' | 'pro') || undefined
  const sound = typeof payload.sound === 'boolean' ? payload.sound : undefined
  const aspectRatio = (payload.aspectRatio as string) || undefined

  if (!Array.isArray(panelIds) || panelIds.length < 2) {
    throw new Error('MULTI_SHOT_PANEL_IDS_INVALID')
  }

  await reportTaskProgress(job, 5, { stage: 'load_panels' })

  // 1. 按 panelIds 順序載入 panels
  const panels = await Promise.all(
    panelIds.map((id) =>
      prisma.novelPromotionPanel.findUnique({
        where: { id },
        select: {
          id: true,
          description: true,
          videoPrompt: true,
          characters: true,
          imageUrl: true,
          storyboardId: true,
        },
      }),
    ),
  )

  for (let i = 0; i < panels.length; i++) {
    if (!panels[i]) throw new Error(`Panel not found: ${panelIds[i]}`)
    if (!panels[i]!.imageUrl) throw new Error(`Panel ${panelIds[i]} has no imageUrl`)
  }

  const validPanels = panels as NonNullable<(typeof panels)[number]>[]

  await reportTaskProgress(job, 15, { stage: 'collect_characters' })

  // 2. 收集角色，去重後構建 kling_elements
  const projectData = await resolveNovelData(projectId)
  const seenCharacters = new Map<string, KlingElement>()

  for (const panel of validPanels) {
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (seenCharacters.has(ref.name.toLowerCase())) continue

      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue

      const appearances = character.appearances || []
      let appearance = appearances[0]
      if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
      }

      if (!appearance) continue

      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)

      if (!publicUrl) continue

      const elementName = `element_${sanitizeName(ref.name)}`
      seenCharacters.set(ref.name.toLowerCase(), {
        name: elementName,
        description: ref.name,
        imageUrls: [publicUrl],
      })
    }
  }

  // KieAI 图片尺寸限制：缩小超尺寸的角色参考图
  const rawElements = Array.from(seenCharacters.values())
  const klingElements = await Promise.all(
    rawElements.map(async (el) => ({
      ...el,
      imageUrls: await Promise.all(
        el.imageUrls.map((url) => ensureImageWithinKieAILimits(url, `element-${el.name}`)),
      ),
    })),
  )

  await reportTaskProgress(job, 25, { stage: 'build_multi_prompt' })

  // 3. 構建 multi_prompt
  const multiPrompt: MultiShotPromptItem[] = validPanels.map((panel) => {
    const rawPrompt = panel.videoPrompt || panel.description || ''
    const prompt = klingElements.length > 0
      ? buildPromptWithElementRefs(rawPrompt, klingElements)
      : rawPrompt
    return {
      prompt,
      duration: 5,
    }
  })

  logger.info({
    message: 'Multi-shot video build complete',
    details: {
      shotCount: multiPrompt.length,
      elementCount: klingElements.length,
      elements: klingElements.map((e) => e.name),
    },
  })

  await reportTaskProgress(job, 30, { stage: 'submit_generation' })

  // 4. 提交 multi-shot 生成
  const generator = new KieAIKlingVideoGenerator()
  const result = await generator.generateMultiShot({
    userId,
    multiPrompt,
    klingElements: klingElements.length > 0 ? klingElements : undefined,
    options: {
      mode,
      sound,
      aspectRatio,
    },
  })

  if (!result.success || !result.externalId) {
    throw new Error(result.error || 'Multi-shot video generation failed')
  }

  logger.info({
    message: 'Multi-shot video task submitted',
    details: { externalId: result.externalId },
  })

  // 5. 輪詢等待完成
  const polled = await waitExternalResult(job, result.externalId, userId, {
    progressStart: 35,
    progressEnd: 90,
  })

  await assertTaskActive(job, 'persist_multi_shot_video')

  // 6. 上傳到 R2/COS
  const storyboardId = validPanels[0].storyboardId
  const cosKey = await uploadVideoSourceToCos(polled.url, 'multi-shot-video', storyboardId)

  await reportTaskProgress(job, 95, { stage: 'persist' })

  // 7. 存入 storyboard
  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: {
      multiShotVideoUrl: cosKey,
    },
  })

  return {
    storyboardId,
    multiShotVideoUrl: cosKey,
    shotCount: multiPrompt.length,
  }
}
