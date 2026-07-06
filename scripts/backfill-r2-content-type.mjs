/**
 * 一次性回填:修正 R2 既有物件的 ContentType。
 *
 * 背景:uploadToCOS 修復前所有 R2 物件都以 application/octet-stream 上傳,
 * Safari/iOS <video> 拒播 octet-stream 的 mp4。新上傳已由 cos.ts 的
 * contentTypeForKey 修正;這支腳本把「既有」物件的 metadata 用
 * CopyObject(REPLACE)原地改正,不動內容本體。
 *
 * 用法:
 *   node scripts/backfill-r2-content-type.mjs                # dry-run(只列出會改哪些)
 *   node scripts/backfill-r2-content-type.mjs --apply        # 實際回填
 *   node scripts/backfill-r2-content-type.mjs --prefix images/playground-runs --apply
 *
 * 憑證從 .env 讀(R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME);要跑 prod bucket 用 R2_BUCKET_NAME=kuiperfilm-storage 覆蓋。
 */

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3'
import { config } from 'dotenv'
config()

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
}

function contentTypeForKey(key) {
  const idx = key.lastIndexOf('.')
  if (idx === -1) return null
  return MIME_TYPES[key.slice(idx).toLowerCase()] ?? null
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const prefixIdx = args.indexOf('--prefix')
const prefix = prefixIdx !== -1 ? args[prefixIdx + 1] : ''

const bucket = process.env.R2_BUCKET_NAME
if (!bucket) {
  console.error('R2_BUCKET_NAME not set')
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

let scanned = 0
let fixed = 0
let skipped = 0
let failed = 0
let token = undefined

console.log(`bucket=${bucket} prefix="${prefix}" mode=${apply ? 'APPLY' : 'dry-run'}`)

do {
  const page = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    ContinuationToken: token,
    MaxKeys: 1000,
  }))
  token = page.IsTruncated ? page.NextContinuationToken : undefined

  for (const obj of page.Contents ?? []) {
    scanned++
    const want = contentTypeForKey(obj.Key)
    if (!want) { skipped++; continue }

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: obj.Key }))
    if (head.ContentType === want) { skipped++; continue }

    if (!apply) {
      console.log(`[dry-run] ${obj.Key}: ${head.ContentType} -> ${want}`)
      fixed++
      continue
    }

    try {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: obj.Key,
        CopySource: `${bucket}/${encodeURIComponent(obj.Key)}`,
        ContentType: want,
        MetadataDirective: 'REPLACE',
      }))
      fixed++
      if (fixed % 50 === 0) console.log(`...fixed ${fixed} (scanned ${scanned})`)
    } catch (err) {
      failed++
      console.error(`FAILED ${obj.Key}: ${err?.message ?? err}`)
    }
  }
} while (token)

console.log(`done. scanned=${scanned} ${apply ? 'fixed' : 'would-fix'}=${fixed} skipped=${skipped} failed=${failed}`)
