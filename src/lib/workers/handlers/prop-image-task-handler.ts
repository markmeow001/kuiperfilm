/**
 * Phase 11.3 Stage C — image_prop task handler.
 *
 * Mirrors location-image-task-handler but for NovelPromotionProp rows.
 * Generates a 1:1 product-shot of the prop on a clean background using
 * the prop's `description` (image-gen prompt extracted by the analyze
 * pipeline) as the user prompt.
 *
 * targetId is NovelPromotionProp.id. There's no per-prop image-index
 * sub-table — each prop holds at most one imageUrl, so the handler is
 * single-shot, not "regen one of N".
 */

import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { addPropPromptSuffix, PROP_IMAGE_RATIO } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive, getProjectModels } from '../utils'
import { AnyObj, generateLabeledImageToCos, pickFirstString } from './image-task-handler-shared'
import { loadStyleProfile } from '@/lib/style-profile/loader'

export async function handlePropImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId

  // Reuse the project's locationModel for prop generation. Props are
  // visually closer to "scene plates" than "character sheets" — same
  // model produces consistent style. If a project later wants a
  // dedicated propModel column, that's a schema add for that day.
  const models = await getProjectModels(projectId, userId)
  const modelId = models.locationModel
  if (!modelId) throw new Error('Prop model (locationModel) not configured')

  const propId = pickFirstString(payload.id, payload.propId, job.data.targetId)
  if (!propId) throw new Error('Prop id missing')

  const prop = await prisma.novelPromotionProp.findFirst({
    where: {
      id: propId,
      // Multi-user isolation: chain through project ownership.
      novelPromotionProject: { projectId },
    },
    select: { id: true, name: true, summary: true, description: true },
  })
  if (!prop) throw new Error(`Prop not found: ${propId}`)

  await reportTaskProgress(job, 10, { stage: 'generate_prop_image', propId: prop.id })

  // Prefer the LLM-extracted visual description; fall back to the
  // human-facing summary if a user manually created a prop without
  // running through analyze.
  const promptBody = (prop.description || prop.summary || prop.name || '').trim()
  if (!promptBody) {
    throw new Error(`Prop ${prop.id} has no description / summary to seed image generation`)
  }

  const userPrompt = addPropPromptSuffix(promptBody)
  const styleProfile = await loadStyleProfile(prisma, projectId)

  const cosKey = await generateLabeledImageToCos({
    job,
    userId,
    modelId,
    prompt: userPrompt,
    label: prop.name || '道具',
    targetId: prop.id,
    keyPrefix: 'prop',
    options: {
      aspectRatio: PROP_IMAGE_RATIO,
    },
    styleProfile,
  })

  await assertTaskActive(job, 'persist_prop_image')
  await prisma.novelPromotionProp.update({
    where: { id: prop.id },
    data: { imageUrl: cosKey },
  })

  return { propId: prop.id, imageUrl: cosKey }
}
