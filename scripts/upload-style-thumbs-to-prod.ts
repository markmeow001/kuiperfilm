/**
 * 把本地產好的 38 張風格 thumbnail 上傳到 COS / R2 + 寫入 DB
 *
 * 用法（在 prod 容器內跑，需要 .env.prod 載入）：
 *   npx tsx scripts/upload-style-thumbs-to-prod.ts
 *   npx tsx scripts/upload-style-thumbs-to-prod.ts --dry-run
 *   npx tsx scripts/upload-style-thumbs-to-prod.ts --only=cinematic_realism,golden_hour
 *
 * 行為：
 *   1. 掃 design-preview/images/styles/{id}.{jpg|png}
 *   2. 對每個 id，讀 buffer → uploadToCOS('style-thumbs/{id}.{ext}') → 拿 URL
 *   3. update visual_styles.thumbnail_url OR lighting_presets.thumbnail_url
 *   4. 印出最終 URL 表
 *
 * Idempotent：已上傳的（DB 已有 thumbnailUrl 且檔名對得上）跳過，除非 --force
 *
 * 不需要 KuiperAI 完整跑（不 import worker / queue），只 prisma + cos.ts
 */

import { PrismaClient } from '@prisma/client'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { uploadToCOS } from '../src/lib/cos'

const prisma = new PrismaClient()

const LOCAL_DIR = '/Users/joshhung/KuiperAI/design-preview/images/styles'
const PROD_DIR_HINT = '/app/design-preview/images/styles'  // 若 scp 到 droplet 的路徑
const COS_PREFIX = 'style-thumbs'

interface Flags {
  dryRun: boolean
  force: boolean
  only: Set<string> | null
}

function parseFlags(): Flags {
  const args = process.argv.slice(2)
  const f: Flags = { dryRun: false, force: false, only: null }
  for (const a of args) {
    if (a === '--dry-run') f.dryRun = true
    else if (a === '--force') f.force = true
    else if (a.startsWith('--only=')) f.only = new Set(a.slice(7).split(','))
  }
  return f
}

async function findImageDir(): Promise<string> {
  for (const d of [LOCAL_DIR, PROD_DIR_HINT, './design-preview/images/styles']) {
    try {
      await readdir(d)
      return d
    } catch {}
  }
  throw new Error(`找不到 style thumbs 目錄。試過：${LOCAL_DIR}, ${PROD_DIR_HINT}`)
}

interface UploadResult {
  id: string
  kind: 'style' | 'lighting'
  url: string
  bytes: number
  action: 'uploaded' | 'skipped' | 'failed'
  note?: string
}

async function run() {
  const flags = parseFlags()
  const dir = await findImageDir()
  const files = await readdir(dir)

  const styleIds = new Set(
    (await prisma.visualStyle.findMany({ select: { id: true, thumbnailUrl: true } }))
      .map((s) => s.id),
  )
  const lightingIds = new Set(
    (await prisma.lightingPreset.findMany({ select: { id: true, thumbnailUrl: true } }))
      .map((s) => s.id),
  )

  const dbStyles = await prisma.visualStyle.findMany({ select: { id: true, thumbnailUrl: true } })
  const dbLighting = await prisma.lightingPreset.findMany({ select: { id: true, thumbnailUrl: true } })
  const existingUrl: Record<string, string | null> = {}
  for (const s of dbStyles) existingUrl[s.id] = s.thumbnailUrl
  for (const l of dbLighting) existingUrl[l.id] = l.thumbnailUrl

  const targets = files
    .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
    .map((f) => {
      const id = f.replace(/\.(jpg|png)$/, '')
      const ext = f.endsWith('.png') ? 'png' : 'jpg'
      const kind: 'style' | 'lighting' = lightingIds.has(id) ? 'lighting' : 'style'
      return { id, file: f, ext, kind }
    })
    .filter((t) => {
      if (flags.only && !flags.only.has(t.id)) return false
      // Must exist in DB
      if (t.kind === 'style' && !styleIds.has(t.id)) {
        console.warn(`  ⚠ ${t.id} 不在 visual_styles 表，skip`)
        return false
      }
      return true
    })

  console.log(`▶ 目標 ${targets.length} 張（DB style: ${styleIds.size} / lighting: ${lightingIds.size}）`)
  if (flags.dryRun) console.log('  [DRY RUN] 只印不寫\n')

  const results: UploadResult[] = []
  for (const t of targets) {
    const cosKey = `${COS_PREFIX}/${t.id}.${t.ext}`
    const existing = existingUrl[t.id]
    if (existing && existing.includes(cosKey) && !flags.force) {
      console.log(`  ⊘ ${t.kind}/${t.id} 已上傳，skip`)
      results.push({ id: t.id, kind: t.kind, url: existing, bytes: 0, action: 'skipped' })
      continue
    }

    try {
      process.stdout.write(`  [${t.kind}/${t.id}]`)
      const buf = await readFile(join(dir, t.file))
      if (flags.dryRun) {
        console.log(` would upload ${(buf.length / 1024).toFixed(0)}KB → ${cosKey}`)
        results.push({ id: t.id, kind: t.kind, url: `(dry)${cosKey}`, bytes: buf.length, action: 'uploaded', note: 'dry-run' })
        continue
      }
      const url = await uploadToCOS(buf, cosKey)
      // uploadToCOS 在本地 storage 模式回 key、在 R2/COS 模式回 full URL
      const finalUrl = url.startsWith('http') ? url : `/${url}`  // 應用層相對路徑或 absolute

      // Update DB
      if (t.kind === 'style') {
        await prisma.visualStyle.update({
          where: { id: t.id },
          data: { thumbnailUrl: finalUrl },
        })
      } else {
        await prisma.lightingPreset.update({
          where: { id: t.id },
          data: { thumbnailUrl: finalUrl },
        })
      }
      console.log(` ✓ ${(buf.length / 1024).toFixed(0)}KB → ${finalUrl.slice(0, 60)}...`)
      results.push({ id: t.id, kind: t.kind, url: finalUrl, bytes: buf.length, action: 'uploaded' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(` ✗ ${msg}`)
      results.push({ id: t.id, kind: t.kind, url: '', bytes: 0, action: 'failed', note: msg })
    }
  }

  const ok = results.filter((r) => r.action === 'uploaded').length
  const skipped = results.filter((r) => r.action === 'skipped').length
  const fail = results.filter((r) => r.action === 'failed').length
  const totalKB = results.reduce((s, r) => s + r.bytes, 0) / 1024
  console.log(`\n上傳 ${ok} 張 / skip ${skipped} / 失敗 ${fail} · 共 ${totalKB.toFixed(0)} KB`)

  if (fail > 0) process.exit(1)
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
