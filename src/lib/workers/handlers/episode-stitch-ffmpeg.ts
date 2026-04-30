/**
 * Phase 12.7.x — Episode full-stitch (FFmpeg concat)
 *
 * Takes an episodeId, fetches every panel that has a videoUrl in
 * storyboard order (storyboard.createdAt ASC, then panel.panelIndex
 * ASC), downloads each video to a tmp dir, runs ffmpeg concat (with
 * re-encode so mixed sources don't break), and uploads the result to
 * COS. The final URL is written back to NovelPromotionEpisode.stitchedVideoUrl.
 *
 * Pre-reqs:
 *   - ffmpeg binary present in container (Dockerfile apk add ffmpeg)
 *   - At least one panel in the episode has a videoUrl
 *   - panel videos must have the same resolution & fps for `-c copy` to
 *     work; we default to re-encode (libx264/aac) for safety. Cost is
 *     ~30s extra per minute of footage on a single vCPU.
 */
import path from 'path'
import fs from 'fs'
import os from 'os'
import { promisify } from 'util'
import { exec as execCb } from 'child_process'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive, toSignedUrlIfCos, uploadVideoSourceToCos } from '../utils'

const exec = promisify(execCb)

interface StitchPayload {
  episodeId?: string
}

const MAX_FFMPEG_MS = 30 * 60 * 1000 // 30 min hard cap

export async function handleEpisodeStitchMp4Task(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as StitchPayload
  const episodeId = typeof payload.episodeId === 'string' ? payload.episodeId : ''
  if (!episodeId) {
    throw new Error('EPISODE_STITCH_MP4: missing episodeId in payload')
  }

  await reportTaskProgress(job, 5, { stage: 'load_panels' })
  await assertTaskActive(job, 'load_panels')

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      storyboards: {
        include: {
          panels: { orderBy: { panelIndex: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!episode) {
    throw new Error(`EPISODE_STITCH_MP4: episode not found: ${episodeId}`)
  }

  const allPanels = episode.storyboards.flatMap((sb) => sb.panels)
  const panelsWithVideo = allPanels.filter((p) => Boolean(p.videoUrl))

  if (panelsWithVideo.length === 0) {
    throw new Error(
      'EPISODE_STITCH_MP4: no panels have videoUrl yet — generate panel videos first',
    )
  }

  await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: { stitchStatus: 'rendering' },
  })

  await reportTaskProgress(job, 10, {
    stage: 'download_videos',
    totalPanels: panelsWithVideo.length,
  })

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `episode-stitch-${episodeId}-`))
  const panelFiles: string[] = []

  try {
    // 1. Download every panel video to the tmp dir.
    for (let i = 0; i < panelsWithVideo.length; i++) {
      await assertTaskActive(job, 'download_videos')
      const panel = panelsWithVideo[i]
      const url = toSignedUrlIfCos(panel.videoUrl, 7200) || panel.videoUrl
      if (!url) {
        throw new Error(`EPISODE_STITCH_MP4: panel ${panel.id} has no resolvable URL`)
      }
      const dest = path.join(tmpDir, `${String(i).padStart(4, '0')}.mp4`)
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(
          `EPISODE_STITCH_MP4: failed to download panel ${i + 1}/${panelsWithVideo.length}: HTTP ${res.status}`,
        )
      }
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(dest, buf)
      panelFiles.push(dest)
      const dlProgress = 10 + Math.floor(((i + 1) / panelsWithVideo.length) * 50)
      await reportTaskProgress(job, dlProgress, {
        stage: 'download_videos',
        downloaded: i + 1,
        total: panelsWithVideo.length,
      })
    }

    // 2. Build ffmpeg concat list file.
    await assertTaskActive(job, 'ffmpeg_concat')
    await reportTaskProgress(job, 65, { stage: 'ffmpeg_concat' })

    const concatListPath = path.join(tmpDir, 'concat.txt')
    // Each panel file written as: file '<absolute path>'
    const concatList = panelFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    fs.writeFileSync(concatListPath, concatList)

    const outputPath = path.join(tmpDir, `episode-${episodeId}-${Date.now()}.mp4`)

    // Re-encode to a uniform format so mixed-codec / mixed-resolution panels
    // don't break the concat. preset=fast keeps single-vCPU droplet usable.
    const ffmpegArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', `"${concatListPath}"`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      `"${outputPath}"`,
    ]
    const ffmpegCmd = `ffmpeg ${ffmpegArgs.join(' ')}`

    try {
      await exec(ffmpegCmd, { timeout: MAX_FFMPEG_MS, maxBuffer: 50 * 1024 * 1024 })
    } catch (err) {
      const msg = (err as Error & { stderr?: string }).stderr || (err as Error).message
      throw new Error(`EPISODE_STITCH_MP4: ffmpeg failed: ${String(msg).slice(0, 400)}`)
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('EPISODE_STITCH_MP4: ffmpeg produced no output file')
    }

    // 3. Upload to COS.
    await assertTaskActive(job, 'upload_to_cos')
    await reportTaskProgress(job, 90, { stage: 'upload_to_cos' })

    const videoBuffer = fs.readFileSync(outputPath)
    const cosKey = await uploadVideoSourceToCos(videoBuffer, 'episode-stitch', episodeId)

    // 4. Persist URL on the episode row.
    await assertTaskActive(job, 'persist_result')
    await reportTaskProgress(job, 97, { stage: 'persist_result' })

    await prisma.novelPromotionEpisode.update({
      where: { id: episodeId },
      data: {
        stitchedVideoUrl: cosKey,
        stitchStatus: 'completed',
        stitchedAt: new Date(),
      },
    })

    return {
      episodeId,
      outputUrl: cosKey,
      panelCount: panelsWithVideo.length,
    }
  } catch (err) {
    await prisma.novelPromotionEpisode.update({
      where: { id: episodeId },
      data: { stitchStatus: 'failed' },
    })
    throw err
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}
