import path from 'path'
import fs from 'fs'
import os from 'os'
import type { Job } from 'bullmq'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive, toSignedUrlIfCos, uploadVideoSourceToCos } from '../utils'
import { webpackOverride } from '@/features/video-editor/remotion/webpack-override'
import { calculateTimelineDuration } from '@/features/video-editor/utils/time-utils'

type AnyObj = Record<string, unknown>

export async function handleVideoEditorRenderTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const editorProjectId = typeof payload.editorProjectId === 'string' ? payload.editorProjectId : ''
  if (!editorProjectId) {
    throw new Error('VIDEO_EDITOR_RENDER: missing editorProjectId in payload')
  }

  // 1. Load project from DB
  const editorProject = await prisma.videoEditorProject.findUnique({
    where: { id: editorProjectId },
  })
  if (!editorProject) {
    throw new Error(`VIDEO_EDITOR_RENDER: editor project not found: ${editorProjectId}`)
  }

  await prisma.videoEditorProject.update({
    where: { id: editorProjectId },
    data: { renderStatus: 'rendering' },
  })

  await reportTaskProgress(job, 5, { stage: 'parse_project' })

  const projectData = JSON.parse(editorProject.projectData)
  const clips = projectData.timeline || []
  const bgmTrack = projectData.bgmTrack || []
  const config = projectData.config || { fps: 30, width: 1920, height: 1080 }

  // Sign COS URLs for all clips and BGM so Remotion can fetch them
  const signedClips = clips.map((clip: AnyObj) => ({
    ...clip,
    src: toSignedUrlIfCos(clip.src as string, 7200) || clip.src,
    attachment: clip.attachment
      ? {
          ...(clip.attachment as AnyObj),
          audio: (clip.attachment as AnyObj).audio
            ? {
                ...((clip.attachment as AnyObj).audio as AnyObj),
                src: toSignedUrlIfCos(((clip.attachment as AnyObj).audio as AnyObj).src as string, 7200) || ((clip.attachment as AnyObj).audio as AnyObj).src,
              }
            : undefined,
        }
      : undefined,
  }))

  const signedBgmTrack = bgmTrack.map((bgm: AnyObj) => ({
    ...bgm,
    src: toSignedUrlIfCos(bgm.src as string, 7200) || bgm.src,
  }))

  const totalDuration = calculateTimelineDuration(signedClips)
  if (totalDuration <= 0) {
    throw new Error('VIDEO_EDITOR_RENDER: timeline has no duration')
  }

  await reportTaskProgress(job, 10, { stage: 'bundle_remotion' })
  await assertTaskActive(job, 'bundle_remotion')

  // 2. Bundle Remotion entry
  const entryPoint = path.resolve(process.cwd(), 'src/features/video-editor/remotion/index.tsx')
  const bundleLocation = await bundle({
    entryPoint,
    webpackOverride,
  })

  await reportTaskProgress(job, 25, { stage: 'select_composition' })
  await assertTaskActive(job, 'select_composition')

  // 3. Select composition with actual props
  const inputProps = {
    clips: signedClips,
    bgmTrack: signedBgmTrack,
    config,
  }

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'VideoEditor',
    inputProps,
  })

  // Override duration/dimensions from project config
  composition.durationInFrames = totalDuration
  composition.fps = config.fps || 30
  composition.width = config.width || 1920
  composition.height = config.height || 1080

  await reportTaskProgress(job, 30, { stage: 'render_video' })
  await assertTaskActive(job, 'render_video')

  // 4. Render to temp file
  const tmpDir = os.tmpdir()
  const outputPath = path.join(tmpDir, `editor-render-${editorProjectId}-${Date.now()}.mp4`)

  try {
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
      onProgress: ({ progress }) => {
        // Map render progress (0-1) to task progress (30-90)
        const taskProgress = 30 + Math.floor(progress * 60)
        void reportTaskProgress(job, taskProgress, { stage: 'rendering', renderProgress: progress })
      },
    })

    await reportTaskProgress(job, 92, { stage: 'upload_to_cos' })
    await assertTaskActive(job, 'upload_to_cos')

    // 5. Upload to COS
    const videoBuffer = fs.readFileSync(outputPath)
    const cosKey = await uploadVideoSourceToCos(videoBuffer, 'editor-render', editorProjectId)

    await reportTaskProgress(job, 97, { stage: 'persist_result' })
    await assertTaskActive(job, 'persist_result')

    // 6. Update DB
    await prisma.videoEditorProject.update({
      where: { id: editorProjectId },
      data: {
        renderStatus: 'completed',
        outputUrl: cosKey,
      },
    })

    return {
      editorProjectId,
      outputUrl: cosKey,
    }
  } catch (error) {
    // Mark as failed in DB
    await prisma.videoEditorProject.update({
      where: { id: editorProjectId },
      data: { renderStatus: 'failed' },
    })
    throw error
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath)
      }
    } catch {
      // ignore cleanup errors
    }

    // Clean up bundle directory
    try {
      if (fs.existsSync(bundleLocation)) {
        fs.rmSync(bundleLocation, { recursive: true, force: true })
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
