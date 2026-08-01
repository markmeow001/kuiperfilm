import path from 'node:path'
import archiver from 'archiver'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { contentDispositionAttachment } from '@/lib/http/content-disposition'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { readResultKey } from '@/lib/visual-development/records'
import { parseWorldBible } from '@/lib/visual-development/world-bible'

type RouteContext = { params: Promise<{ projectId: string }> }
type ExportScope = 'canon' | 'approved' | 'full'

interface ArchiveAsset {
  key: string
  archivePath: string
}

function parseScope(value: string | null): ExportScope {
  if (value === 'canon' || value === 'approved' || value === 'full') return value
  throw new ApiError('INVALID_PARAMS', { code: 'VISUAL_DEVELOPMENT_EXPORT_SCOPE_INVALID' })
}

function safeSegment(value: string, fallback: string): string {
  const safe = value.trim().replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').slice(0, 80)
  return safe || fallback
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assetExtension(key: string): string {
  const clean = key.split(/[?#]/, 1)[0] ?? ''
  const extension = path.extname(clean).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.bin'
}

function includeCandidate(scope: ExportScope, input: { shortlisted: boolean; isCanon: boolean }, batchStatus: string): boolean {
  if (scope === 'full') return true
  if (scope === 'approved') return input.shortlisted || input.isCanon
  return input.isCanon || (batchStatus === 'canon_locked' && input.shortlisted)
}

function includeResearchReference(
  scope: ExportScope,
  input: { reviewStatus: string },
  researchStatus: string,
): boolean {
  if (scope === 'full') return true
  if (scope === 'approved') return input.reviewStatus === 'approved'
  return researchStatus === 'locked' && input.reviewStatus === 'approved'
}

export const GET = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const scope = parseScope(new URL(request.url).searchParams.get('scope'))
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const access = await requireProjectAccess(projectId, auth.session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({
    where: { projectId },
    include: {
      project: { select: { id: true, name: true, description: true, createdAt: true, updatedAt: true } },
      characters: {
        orderBy: { createdAt: 'asc' },
        include: {
          castingBatches: {
            orderBy: { createdAt: 'asc' },
            include: { candidates: { orderBy: { code: 'asc' } } },
          },
        },
      },
    },
  })
  if (!workspace) throw new ApiError('NOT_FOUND', { code: 'VISUAL_DEVELOPMENT_WORKSPACE_NOT_FOUND' })
  const document = parseWorldBible(workspace.worldBible)
  const taskIds = [
    ...document.assets.map((asset) => asset.taskId),
    ...workspace.characters.flatMap((character) => character.castingBatches.flatMap((batch) => batch.candidates.flatMap((candidate) => candidate.taskId ? [candidate.taskId] : []))),
  ]
  const tasks = taskIds.length > 0 ? await prisma.task.findMany({
    where: { id: { in: taskIds }, projectId, userId: auth.session.user.id },
    select: { id: true, status: true, progress: true, result: true, errorCode: true, errorMessage: true, createdAt: true, updatedAt: true },
  }) : []
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const assets: ArchiveAsset[] = []

  for (const source of document.sources) {
    const version = document.sources.indexOf(source) + 1
    assets.push({ key: source.originalKey ?? source.key, archivePath: `01_SOURCE_SCREENPLAY/V${String(version).padStart(2, '0')}_${safeSegment(source.name, 'screenplay')}` })
    if (scope === 'full' && source.originalKey) {
      assets.push({ key: source.key, archivePath: `01_SOURCE_SCREENPLAY/V${String(version).padStart(2, '0')}_normalized.txt` })
    }
  }
  if (scope === 'full' || workspace.status === 'world_locked') {
    for (const reference of document.references) {
      assets.push({ key: reference.key, archivePath: `02_WORLD_BIBLE/references/${safeSegment(reference.name, reference.id)}${assetExtension(reference.key)}` })
    }
  }
  for (const reference of document.research.references) {
    if (!includeResearchReference(scope, reference, document.research.status)) continue
    assets.push({
      key: reference.key,
      archivePath: `02_WORLD_BIBLE/research/references/${safeSegment(reference.category, 'general')}/${safeSegment(reference.name, reference.id)}${assetExtension(reference.key)}`,
    })
  }

  for (const worldAsset of document.assets) {
    const include = scope === 'full'
      || (scope === 'approved' && worldAsset.approved)
      || (scope === 'canon' && workspace.status === 'world_locked' && worldAsset.approved)
    if (!include) continue
    const task = tasksById.get(worldAsset.taskId)
    const key = task ? readResultKey(task.result) : null
    if (key) assets.push({ key, archivePath: `02_WORLD_BIBLE/assets/${safeSegment(worldAsset.code, 'world-asset')}${assetExtension(key)}` })
  }

  for (const character of workspace.characters) {
    const characterFolder = safeSegment(`${character.code}_${character.name}`, character.code)
    for (const batch of character.castingBatches) {
      const stageFolder = safeSegment(batch.stage, 'stage')
      for (const candidate of batch.candidates) {
        if (!includeCandidate(scope, candidate, batch.status)) continue
        const task = candidate.taskId ? tasksById.get(candidate.taskId) : null
        const key = task ? readResultKey(task.result) : null
        if (!key) continue
        assets.push({
          key,
          archivePath: `03_CHARACTERS/${characterFolder}/${stageFolder}/${safeSegment(batch.id, 'batch')}/${safeSegment(candidate.code, 'asset')}${assetExtension(key)}`,
        })
      }
    }
  }

  const exportedCharacters = workspace.characters.map((character) => ({
    id: character.id,
    code: character.code,
    name: character.name,
    status: character.status,
    canonCandidateId: character.canonCandidateId,
    canonLockedAt: character.canonLockedAt,
    characterDna: character.characterDna,
    castingBrief: character.castingBrief,
    batches: character.castingBatches.flatMap((batch) => {
      const candidates = batch.candidates.filter((candidate) => includeCandidate(scope, candidate, batch.status))
      if (scope !== 'full' && candidates.length === 0) return []
      return [{
        id: batch.id,
        stage: batch.stage,
        status: batch.status,
        provider: batch.provider,
        modelKey: batch.modelKey,
        modelId: batch.modelId,
        modelVersion: batch.modelVersion,
        seedSupported: batch.seedSupported,
        prompt: batch.prompt,
        negativePrompt: batch.negativePrompt,
        promptStack: batch.promptStack,
        aspectRatio: batch.aspectRatio,
        resolution: batch.resolution,
        createdAt: batch.createdAt,
        candidates,
      }]
    }),
  })).filter((character) => scope === 'full' || character.batches.length > 0)

  const manifest = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    scope,
    project: workspace.project,
    workspace: { id: workspace.id, status: workspace.status, worldVersion: workspace.worldVersion, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt },
    sourceVersions: document.sources,
    worldBible: document,
    characters: exportedCharacters,
    tasks: tasks.map(({ result: _result, ...task }) => task),
    selectedAssetCount: assets.length,
  }

  const archive = archiver('zip', { zlib: { level: 9 } })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const failures: Array<{ key: string; archivePath: string; error: string }> = []
      archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      archive.on('end', () => controller.close())
      archive.on('error', (error) => controller.error(error))
      void (async () => {
        archive.append(json(manifest), { name: '00_ADMIN/project_manifest.json' })
        archive.append(json(document), { name: '02_WORLD_BIBLE/world_bible.json' })
        archive.append(json(document.research), { name: '02_WORLD_BIBLE/research/research_canon.json' })
        for (const character of manifest.characters) {
          archive.append(json(character), { name: `03_CHARACTERS/${safeSegment(`${character.code}_${character.name}`, character.code)}/character_record.json` })
        }
        for (const asset of assets) {
          try {
            const sourceUrl = /^https?:\/\//.test(asset.key) ? asset.key : getSignedUrl(asset.key, 3600)
            const response = await fetch(toFetchableUrl(sourceUrl))
            if (!response.ok) throw new Error(`storage returned ${response.status}`)
            archive.append(Buffer.from(await response.arrayBuffer()), { name: asset.archivePath })
          } catch (error) {
            failures.push({ key: asset.key, archivePath: asset.archivePath, error: error instanceof Error ? error.message : String(error) })
          }
        }
        archive.append(json({ scope, requested: assets.length, included: assets.length - failures.length, failures }), { name: '09_QA/export_report.json' })
        await archive.finalize()
      })().catch((error) => controller.error(error))
    },
    cancel() {
      archive.abort()
    },
  })
  const filename = `${safeSegment(workspace.project.name, 'kuiperfilm')}_visual-development_${scope}.zip`
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDispositionAttachment(filename),
      'Cache-Control': 'no-store',
      'X-Kuiper-Archive-Integrity': 'see-09_QA-export_report',
    },
  })
})
