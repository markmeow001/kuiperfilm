/**
 * Phase 12.7.x — Episode package zip
 *
 * Replaces the old ffmpeg concat path. The platform's role ends at
 * generating per-panel videos; final cutting happens in CapCut/剪映 on
 * the user's machine. So instead of stitching 17×1080P videos into one
 * mp4 (which pegs both vCPUs for ~6 minutes and stalls BullMQ), we
 * package every panel video + storyboard image + dialogue script into
 * one zip and hand the user a download link.
 *
 * Resource profile vs. ffmpeg:
 *   - CPU: <5% (archiver is I/O bound, not encoder bound)
 *   - Time: ~30-60s for 17 panels (download + zip + upload)
 *   - Memory: peak ~600MB (full zip buffered before upload)
 *   - Heartbeat: 90s default is comfortably enough
 *
 * Output zip layout:
 *   episode-{id}.zip
 *   ├── videos/001-{slug}.{validated extension}  (global episode order)
 *   ├── images/001-{slug}.{validated extension}  (global episode order)
 *   ├── voices/001-{speaker}.{validated extension}
 *   ├── script.txt                                (dialogue + camera notes)
 *   ├── README.txt                                (import-to-CapCut guide)
 *   └── manifest.json                             (lineage + checksums)
 *
 * The output key is written to NovelPromotionEpisode.stitchedVideoUrl —
 * the column name is preserved for backward compat; semantically it now
 * holds a zip key, not an mp4 key. Frontend treats it as a download URL.
 */
import path from 'path'
import fs from 'fs'
import os from 'os'
import archiver from 'archiver'
import type { Job } from 'bullmq'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'
import { getStorageObjectSize, uploadToCOS } from '@/lib/cos'
import {
  deliveryMediaFileExtension,
  EPISODE_PACKAGE_ARCHIVE_MAX_SOURCE_BYTES,
  fetchOwnedDeliveryStorageObjectWithMetadata,
} from '@/lib/novel-promotion/final-delivery'
import {
  getEpisodeDeliveryInputSnapshot,
  type EpisodeDeliveryMultiShotSnapshot,
  type EpisodeDeliveryPanelSnapshot,
} from '@/lib/novel-promotion/episode-delivery-snapshot'
import {
  episodePackageStorageKey,
  sha256Buffer,
  type EpisodeDeliveryManifestFile,
  type EpisodeDeliveryManifestSummary,
  type EpisodeDeliveryManifestV1,
} from '@/lib/novel-promotion/episode-delivery-manifest'
import {
  fetchOwnedVoiceLineAudio,
  voiceAudioFileExtension,
} from '@/lib/novel-promotion/voice-line-audio-source'
import {
  cleanupEpisodePackageOutputAfterTermination,
  persistEpisodePackagePreparedOutput,
  readEpisodePackagePreparedOutput,
  type EpisodePackagePreparedOutput,
  type EpisodePackageTaskResult,
} from '@/lib/novel-promotion/episode-package-publication'

interface PackagePayload {
  episodeId?: string
  sourceFingerprint?: string
}

type PanelForZip = EpisodeDeliveryPanelSnapshot

interface DialogueLine {
  panelId: string | null
  panelIndex: number | null
  speaker: string
  content: string
  lineIndex: number
}

class EpisodePackageSourceBytesError extends Error {
  constructor() {
    super('EPISODE_PACKAGE_SOURCE_BYTES_EXCEEDED')
    this.name = 'EpisodePackageSourceBytesError'
  }
}

function slugifyForFilename(input: string | null, fallback: string): string {
  const base = (input ?? '').slice(0, 30).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : fallback
}

function buildScriptText(
  panels: PanelForZip[],
  dialogueByPanelId: Map<string, DialogueLine[]>,
  unassignedDialogue: DialogueLine[],
): string {
  const lines: string[] = ['EPISODE SCRIPT', '', '']
  for (const panel of panels) {
    const sequence = String(panel.sequence).padStart(3, '0')
    const sourcePanel = String(panel.panelIndex).padStart(2, '0')
    lines.push(`--- Panel ${sourcePanel} · Global ${sequence} · Storyboard ${panel.storyboardOrder} ---`)
    if (panel.shotType) lines.push(`Shot: ${panel.shotType}`)
    if (panel.cameraMove) lines.push(`Camera: ${panel.cameraMove}`)
    if (panel.description) lines.push(`Scene: ${panel.description}`)
    const dialogues = dialogueByPanelId.get(panel.panelId) ?? []
    if (dialogues.length > 0) {
      lines.push('')
      for (const d of dialogues) {
        lines.push(`  ${d.speaker}: ${d.content}`)
      }
    }
    lines.push('', '')
  }
  if (unassignedDialogue.length > 0) {
    lines.push('--- Unassigned dialogue ---', '')
    for (const dialogue of unassignedDialogue) {
      lines.push(`  ${dialogue.speaker}: ${dialogue.content}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function buildReadmeText(
  panelCount: number,
  imageCount: number,
  multiShotCount: number,
  voiceCount: number,
): string {
  const parts: string[] = []
  if (panelCount > 0) parts.push(`${panelCount} per-panel videos`)
  if (imageCount > 0) parts.push(`${imageCount} storyboard images`)
  if (multiShotCount > 0) parts.push(`${multiShotCount} multi-shot videos`)
  if (voiceCount > 0) parts.push(`${voiceCount} generated voice files`)
  const summary = parts.join(' + ') || 'no media'
  const lines = [
    'Kuiper 影界 Episode Package',
    '========================',
    '',
    `This zip contains ${summary} plus a dialogue script.`,
    '',
    'Folder layout:',
  ]
  if (panelCount > 0) {
    lines.push('  videos/      — selected panel videos, named in global scene order (001, 002, ...)')
  }
  if (multiShotCount > 0) {
    lines.push('  multi-shot/  — generated group-level video clips, named in group order')
  }
  lines.push(
    '  images/      — storyboard reference images for each panel',
    '  voices/      — generated dialogue audio, named in episode line order',
    '  script.txt   — dialogue + camera notes per panel',
    '  manifest.json — source lineage, byte counts, and SHA-256 checksums',
    '',
    'Import workflow (CapCut / 剪映):',
    '  1. Drag the entire videos/ and/or multi-shot/ folder into your project.',
    '  2. Files are pre-numbered, so they sort correctly on the timeline.',
    '  3. Use script.txt as a reference for cuts, captions, and voiceover.',
    '',
    'Generated by Kuiper 影界.',
    '',
  )
  return lines.join('\n')
}

export async function handleEpisodePackageZipTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as PackagePayload
  const episodeId = typeof payload.episodeId === 'string' ? payload.episodeId : ''
  const submittedFingerprint = typeof payload.sourceFingerprint === 'string'
    ? payload.sourceFingerprint
    : ''
  const projectId = typeof job.data.projectId === 'string' ? job.data.projectId.trim() : ''
  const taskId = typeof job.data.taskId === 'string' ? job.data.taskId.trim() : ''
  const jobId = typeof job.id === 'string' || typeof job.id === 'number' ? String(job.id) : ''
  if (
    !episodeId
    || !projectId
    || !taskId
    || jobId !== taskId
    || job.data.type !== TASK_TYPE.EPISODE_STITCH_MP4
    || job.data.episodeId !== episodeId
    || job.data.targetType !== 'NovelPromotionEpisode'
    || job.data.targetId !== episodeId
  ) {
    throw new Error('EPISODE_PACKAGE_TASK_TARGET_INVALID')
  }
  if (!/^[a-f0-9]{64}$/.test(submittedFingerprint)) {
    throw new Error('EPISODE_PACKAGE_SOURCE_FINGERPRINT_MISMATCH')
  }

  await reportTaskProgress(job, 5, { stage: 'load_panels' })
  await assertTaskActive(job, 'load_panels')

  const preparedOutput = await readEpisodePackagePreparedOutput(job)
  if (preparedOutput) {
    if (preparedOutput.state === 'cleanup_failed') {
      throw Object.assign(new Error('EPISODE_PACKAGE_OUTPUT_CLEANUP_FAILED'), { code: 'EXTERNAL_ERROR' })
    }
    if (preparedOutput.state !== 'prepared') {
      throw Object.assign(
        new Error('EPISODE_PACKAGE_COMPLETION_RECONCILIATION_REQUIRED'),
        { code: 'EXTERNAL_ERROR' },
      )
    }
    let storedBytes: number | null
    try {
      storedBytes = await getStorageObjectSize(preparedOutput.outputUrl)
    } catch (error) {
      throw Object.assign(
        new Error('EPISODE_PACKAGE_UPLOAD_RECONCILIATION_REQUIRED'),
        { code: 'EXTERNAL_ERROR', cause: error },
      )
    }
    if (storedBytes === preparedOutput.archiveBytes) {
      await assertTaskActive(job, 'reconcile_uploaded_zip')
      return preparedOutput.result
    }
    if (storedBytes !== null) {
      throw Object.assign(
        new Error('EPISODE_PACKAGE_OUTPUT_SIZE_MISMATCH'),
        { code: 'EXTERNAL_ERROR' },
      )
    }
  }

  const snapshot = await getEpisodeDeliveryInputSnapshot(projectId, episodeId)
  if (!snapshot) {
    throw new Error(`EPISODE_PACKAGE_ZIP: episode not found in task project: ${episodeId}`)
  }
  if (snapshot.sourceFingerprint !== submittedFingerprint) {
    throw new Error('EPISODE_PACKAGE_SOURCE_FINGERPRINT_MISMATCH')
  }
  const { episode } = snapshot
  const allPanels: PanelForZip[] = snapshot.panels
  const panelsWithVideo = allPanels.filter((panel) => panel.selectedVideoKey !== null)
  const panelsWithImage = allPanels.filter((panel) => panel.imageKey !== null)
  const groupVideos: EpisodeDeliveryMultiShotSnapshot[] = snapshot.multiShotVideos
  const voiceAudios = snapshot.voiceAudios

  if (!snapshot.input.canCreate) {
    throw new Error(
      'EPISODE_PACKAGE_ZIP: no panel videos, storyboard images, or multi-shot group videos yet',
    )
  }

  const dialogueByPanelId = new Map<string, DialogueLine[]>()
  const panelIds = new Set(allPanels.map((panel) => panel.panelId))
  const unassignedDialogue: DialogueLine[] = []
  for (const line of episode.voiceLines) {
    const dialogue: DialogueLine = {
      panelId: line.matchedPanelId,
      panelIndex: line.matchedPanelIndex,
      speaker: line.speaker,
      content: line.content,
      lineIndex: line.lineIndex,
    }
    if (!line.matchedPanelId || !panelIds.has(line.matchedPanelId)) {
      unassignedDialogue.push(dialogue)
      continue
    }
    const list = dialogueByPanelId.get(line.matchedPanelId) ?? []
    list.push(dialogue)
    dialogueByPanelId.set(line.matchedPanelId, list)
  }

  await reportTaskProgress(job, 10, {
    stage: 'package_assets',
    totalPanels: allPanels.length,
    selectedVideoCount: snapshot.input.selectedVideoCount,
    imageCount: snapshot.input.imageCount,
    multiShotVideoCount: snapshot.input.multiShotVideoCount,
    voiceAudioCount: snapshot.input.voiceAudioCount,
  })

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `episode-pack-${episodeId}-`))
  const zipPath = path.join(tmpDir, `episode-${episodeId}.zip`)

  const archive = archiver('zip', { zlib: { level: 6 } })
  const output = fs.createWriteStream(zipPath)
  // archiveDone is awaited only on the success path. If the handler throws
  // earlier, we still attach a catch so the eventual rejection (e.g. ENOENT
  // after we rmSync tmpDir in finally) doesn't surface as an unhandled
  // rejection — the original error is what we want to propagate.
  const archiveDone = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    output.on('error', (err) => reject(err))
    archive.on('error', (err) => reject(err))
  })
  archiveDone.catch(() => undefined)
  archive.pipe(output)
  let sourceBytes = 0

  const fetchAndAccount = async (key: string, kind: 'image' | 'video') => {
    const object = await fetchOwnedDeliveryStorageObjectWithMetadata(key, kind)
    sourceBytes += object.data.byteLength
    if (sourceBytes > EPISODE_PACKAGE_ARCHIVE_MAX_SOURCE_BYTES) {
      throw new EpisodePackageSourceBytesError()
    }
    return object
  }

  try {
    const manifestFiles: EpisodeDeliveryManifestFile[] = []
    const manifestPaths = new Set<string>()
    const appendFile = (
      data: Buffer,
      entry: Omit<EpisodeDeliveryManifestFile, 'bytes' | 'sha256'>,
    ) => {
      if (manifestPaths.has(entry.path)) {
        throw new Error('EPISODE_PACKAGE_MANIFEST_PATH_COLLISION')
      }
      manifestPaths.add(entry.path)
      archive.append(data, { name: entry.path })
      manifestFiles.push({
        ...entry,
        bytes: data.byteLength,
        sha256: sha256Buffer(data),
      })
    }

    const readme = Buffer.from(buildReadmeText(
      panelsWithVideo.length,
      panelsWithImage.length,
      snapshot.input.multiShotVideoCount,
      snapshot.input.voiceAudioCount,
    ))
    appendFile(readme, { sourceId: episode.id, kind: 'readme', path: 'README.txt' })
    const script = Buffer.from(buildScriptText(allPanels, dialogueByPanelId, unassignedDialogue))
    appendFile(script, { sourceId: episode.id, kind: 'script', path: 'script.txt' })

    // Multi-shot group videos go into multi-shot/ alongside videos/ so
    // CapCut import keeps them on a separate track from per-panel cuts.
    //
    // Naming:
    //   - Single-clip group:  multi-shot/group01.mp4 (legacy shape)
    //   - Multi-clip group:   multi-shot/group01-clip1.mp4,
    //                         multi-shot/group01-clip2.mp4, …
    //     User imports them in numbered order; NLE auto-sequences.
    for (let i = 0; i < groupVideos.length; i++) {
      await assertTaskActive(job, 'package_assets')
      const group = groupVideos[i]
      const indexStr = String(group.groupOrder).padStart(2, '0')
      const isMultiClip = group.storageKeys.length > 1
      for (let j = 0; j < group.storageKeys.length; j++) {
        const cosKey = group.storageKeys[j]
        const filename = isMultiClip
          ? `multi-shot/group${indexStr}-clip${j + 1}.mp4`
          : `multi-shot/group${indexStr}.mp4`
        const media = await fetchAndAccount(cosKey, 'video')
        const extension = deliveryMediaFileExtension('video', media.contentType)
        const typedFilename = filename.replace(/\.mp4$/, `.${extension}`)
        appendFile(media.data, {
          sourceId: `${group.storyboardId}:${group.groupId}:clip${j + 1}`,
          kind: 'multi_shot_video',
          path: typedFilename,
        })
      }
    }

    for (let i = 0; i < panelsWithVideo.length; i++) {
      await assertTaskActive(job, 'package_assets')
      const panel = panelsWithVideo[i]
      const indexStr = String(panel.sequence).padStart(3, '0')
      const slug = slugifyForFilename(panel.description, `panel${indexStr}`)

      const video = await fetchAndAccount(panel.selectedVideoKey!, 'video')
      const extension = deliveryMediaFileExtension('video', video.contentType)
      appendFile(video.data, {
        sourceId: panel.panelId,
        kind: 'panel_selected_video',
        path: `videos/${indexStr}-${slug}.${extension}`,
      })

      const progress = 10 + Math.floor(((i + 1) / panelsWithVideo.length) * 75)
      await reportTaskProgress(job, progress, {
        stage: 'package_assets',
        packed: i + 1,
        total: panelsWithVideo.length,
      })
    }

    for (const panel of panelsWithImage) {
      await assertTaskActive(job, 'package_assets')
      const indexStr = String(panel.sequence).padStart(3, '0')
      const slug = slugifyForFilename(panel.description, `panel${indexStr}`)
      const image = await fetchAndAccount(panel.imageKey!, 'image')
      const extension = deliveryMediaFileExtension('image', image.contentType)
      appendFile(image.data, {
        sourceId: panel.panelId,
        kind: 'panel_image',
        path: `images/${indexStr}-${slug}.${extension}`,
      })
    }

    for (const voice of voiceAudios) {
      await assertTaskActive(job, 'package_assets')
      const indexStr = String(voice.sequence).padStart(3, '0')
      const slug = slugifyForFilename(voice.speaker, `line${indexStr}`)
      const audio = await fetchOwnedVoiceLineAudio(voice)
      const extension = voiceAudioFileExtension(audio.contentType)
      sourceBytes += audio.data.byteLength
      if (sourceBytes > EPISODE_PACKAGE_ARCHIVE_MAX_SOURCE_BYTES) {
        throw new EpisodePackageSourceBytesError()
      }
      appendFile(audio.data, {
        sourceId: voice.lineId,
        kind: 'voice_audio',
        path: `voices/${indexStr}-${slug}.${extension}`,
      })
    }

    const manifestSummary: EpisodeDeliveryManifestSummary = {
      version: 1,
      fileCount: manifestFiles.length,
      selectedVideoCount: snapshot.input.selectedVideoCount,
      multiShotVideoCount: snapshot.input.multiShotVideoCount,
      imageCount: snapshot.input.imageCount,
      voiceAudioCount: snapshot.input.voiceAudioCount,
      excludedVoiceLineCount: snapshot.excludedVoiceLines.length,
      scriptIncluded: true,
      checksumAlgorithm: 'sha256',
    }
    const manifest: EpisodeDeliveryManifestV1 = {
      version: 1,
      episodeId,
      taskId,
      sourceFingerprint: snapshot.sourceFingerprint,
      checksumAlgorithm: 'sha256',
      files: manifestFiles,
      excluded: snapshot.excludedVoiceLines.map((line) => ({
        sourceId: line.lineId,
        kind: 'voice_audio',
        reason: line.reason,
      })),
      summary: manifestSummary,
    }
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' })

    await archive.finalize()
    await archiveDone

    const zipBuffer = fs.readFileSync(zipPath)
    const cosKey = episodePackageStorageKey(episodeId, taskId)
    const result: EpisodePackageTaskResult = {
      episodeId,
      outputUrl: cosKey,
      panelCount: panelsWithVideo.length,
      sourceFingerprint: snapshot.sourceFingerprint,
      manifest: manifestSummary,
    }
    const marker: EpisodePackagePreparedOutput = {
      kind: 'episode_package_publication_v1',
      state: 'prepared',
      taskId,
      projectId,
      episodeId,
      outputUrl: cosKey,
      sourceFingerprint: snapshot.sourceFingerprint,
      archiveSha256: sha256Buffer(zipBuffer),
      archiveBytes: zipBuffer.byteLength,
      result,
    }
    await persistEpisodePackagePreparedOutput(job, marker)
    await assertTaskActive(job, 'upload_zip')
    await reportTaskProgress(job, 90, { stage: 'upload_zip' })

    try {
      // One transport attempt only. A lost response is reconciled against the
      // exact task-stable key and expected atomic object size below.
      await uploadToCOS(zipBuffer, cosKey, 1)
    } catch (uploadError) {
      let storedBytes: number | null
      try {
        storedBytes = await getStorageObjectSize(cosKey)
      } catch (readError) {
        throw Object.assign(
          new Error('EPISODE_PACKAGE_UPLOAD_RECONCILIATION_REQUIRED'),
          { code: 'EXTERNAL_ERROR', cause: { uploadError, readError } },
        )
      }
      if (storedBytes === null) throw uploadError
      if (storedBytes !== zipBuffer.byteLength) {
        throw Object.assign(
          new Error('EPISODE_PACKAGE_OUTPUT_SIZE_MISMATCH'),
          { code: 'EXTERNAL_ERROR', cause: uploadError },
        )
      }
    }

    try {
      await assertTaskActive(job, 'persist_result')
    } catch (error) {
      const outcome = await cleanupEpisodePackageOutputAfterTermination(job, result)
      if (outcome === 'published') return result
      throw error
    }
    await reportTaskProgress(job, 97, { stage: 'persist_result' })
    return result
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}
