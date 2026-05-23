import crypto from 'node:crypto'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

/**
 * 火山方舟素材资产 API (Asset API).
 *
 * 2026-05-22 — Separate from ark-api.ts because the asset API uses a
 * different domain + auth mechanism than the Seedance video API:
 *
 *   | Concern   | Seedance video (ark-api.ts)              | Asset API (this file)                       |
 *   |-----------|------------------------------------------|---------------------------------------------|
 *   | Host      | ark.cn-beijing.volces.com                | ark.cn-beijing.volcengineapi.com            |
 *   | Path      | /api/v3/contents/generations/tasks       | /?Action=<Name>&Version=2024-01-01          |
 *   | Auth      | Bearer <apiKey>                          | HMAC-SHA256 + AK/SK (Volcengine SigV4-like) |
 *   | Style     | OpenAI-compatible REST                   | Volcengine OpenAPI (Action-style)           |
 *
 * The asset API gates `Seedance 2.0 不支持含真人脸 reference image` —
 * once a character image goes through CreateAssetGroup → CreateAsset →
 * GetAsset (status=Active), the video gen API accepts `asset://<id>` in
 * content[].image_url.url without face-filter rejection.
 *
 * Official PDFs (2026-05-22, saved at):
 *   /Users/joshhung/Downloads/火山方舟_创建素材资产组合（CreateAssetGroup）_1776151391.pdf
 *   /Users/joshhung/Downloads/火山方舟_创建素材资产（CreateAsset）_1779268729.pdf
 *   /Users/joshhung/Downloads/火山方舟_查询素材资产信息（GetAsset）_1776153941.pdf
 *
 * Signing reference:
 *   https://github.com/volcengine/volc-openapi-demos/blob/main/signature/python/sign.py
 */

const HOST = 'ark.cn-beijing.volcengineapi.com'
const REGION = 'cn-beijing'
const SERVICE = 'ark'
const VERSION = '2024-01-01'
const CONTENT_TYPE = 'application/json'
const DEFAULT_PROJECT_NAME = 'default'

// 60s is generous; asset API responses are tiny (a few hundred bytes)
// and submission is async — the server returns the Id immediately and
// you poll GetAsset separately. Anything > 30s here usually means
// network issue, not asset processing time.
const DEFAULT_TIMEOUT_MS = 60 * 1000

// ============================================================
// Types
// ============================================================

export type AssetType = 'Image' | 'Video' | 'Audio'
export type AssetStatus = 'Active' | 'Processing' | 'Failed'

export interface ArkAssetCredentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface CreateAssetGroupRequest {
  Name: string
  Description?: string
  GroupType?: 'AIGC'
  ProjectName?: string
}

export interface CreateAssetGroupResponse {
  Id: string  // group-{YYYYMMDDHHMMSS}-{rand}
}

export interface CreateAssetRequest {
  GroupId: string
  URL: string
  Name?: string
  AssetType: AssetType
  ProjectName?: string
}

export interface CreateAssetResponse {
  Id: string  // Asset-{YYYYMMDDHHMMSS}-{rand}
}

export interface GetAssetRequest {
  Id: string
  ProjectName?: string
}

export interface GetAssetResponse {
  Id: string
  Name: string
  URL: string  // 12-hour signed URL — re-fetch on each use
  AssetType: AssetType
  GroupId: string
  Status: AssetStatus
  Error: {
    Code: string
    Message: string
  }
  CreateTime: string
  UpdateTime: string
  ProjectName: string
}

interface ResponseEnvelope<T> {
  ResponseMetadata: {
    RequestId: string
    Action: string
    Version: string
    Service: string
    Region: string
    Error?: {
      Code: string
      Message: string
      CodeN?: number
    }
  }
  Result?: T
}

export class ArkAssetApiError extends Error {
  readonly code: string
  readonly action: string
  readonly httpStatus: number
  readonly requestId?: string

  constructor(params: {
    code: string
    message: string
    action: string
    httpStatus: number
    requestId?: string
  }) {
    super(`${params.action} failed (${params.httpStatus}/${params.code}): ${params.message}`)
    this.name = 'ArkAssetApiError'
    this.code = params.code
    this.action = params.action
    this.httpStatus = params.httpStatus
    if (params.requestId !== undefined) {
      this.requestId = params.requestId
    }
  }
}

// ============================================================
// Signing helpers — Volcengine SigV4-like
//
// Ported from the official Python reference. The four pieces of state
// that flow into the signature are:
//   1. Canonical request   = method + path + sorted query + sorted signed
//                            headers + body sha256
//   2. Hashed canonical    = sha256(canonical request)
//   3. String to sign      = "HMAC-SHA256\n" + xDate + "\n" + scope + "\n"
//                            + hashed canonical
//   4. Signing key chain   = HMAC chain (secret → shortDate → region →
//                            service → "request")
// ============================================================

function hmacSha256(key: Buffer, content: string): Buffer {
  return crypto.createHmac('sha256', key).update(content, 'utf8').digest()
}

function hashSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Volcengine-compatible URL-encode for query params. Matches the
 * Python reference's `quote(safe="-_.~")` then `.replace("+", "%20")`.
 * Critical for signature parity — any drift here causes "Invalid
 * Signature" errors that take hours to debug.
 */
function encodeQueryComponent(input: string): string {
  return encodeURIComponent(input)
    // encodeURIComponent doesn't escape these but Python's quote does:
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    // encodeURIComponent uses + nowhere for query, but Python uses + for
    // spaces in the form-encoded case. Normalize to %20 (RFC 3986).
    .replace(/\+/g, '%20')
}

function buildCanonicalQuery(query: Record<string, string>): string {
  const keys = Object.keys(query).sort()
  return keys
    .map((k) => `${encodeQueryComponent(k)}=${encodeQueryComponent(query[k])}`)
    .join('&')
}

/**
 * Produce the Volcengine SigV4 timestamp. Format: YYYYMMDDTHHMMSSZ
 * (no separators except the T and trailing Z). Always UTC.
 */
function formatArkDate(date: Date): { xDate: string; shortDate: string } {
  const iso = date.toISOString()  // 2026-03-28T00:00:00.000Z
  // Strip dashes, colons, and the milliseconds segment.
  const xDate = iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const shortDate = xDate.slice(0, 8)
  return { xDate, shortDate }
}

interface SignedRequest {
  url: string
  headers: Record<string, string>
  body: string
}

function signArkRequest(params: {
  method: 'GET' | 'POST'
  path?: string
  query: Record<string, string>
  body: string
  credentials: ArkAssetCredentials
  date?: Date
  host?: string
  service?: string
  region?: string
  contentType?: string
}): SignedRequest {
  const method = params.method
  const path = params.path ?? '/'
  const query = params.query
  const body = params.body
  const host = params.host ?? HOST
  const service = params.service ?? SERVICE
  const region = params.region ?? REGION
  const contentType = params.contentType ?? CONTENT_TYPE
  const date = params.date ?? new Date()

  const { xDate, shortDate } = formatArkDate(date)
  const xContentSha256 = hashSha256(body)

  // Signed headers — fixed set for the asset API (no x-security-token,
  // no extra customer headers). If we ever add more signed headers,
  // remember they must also appear in the canonical request below.
  const signedHeadersStr = 'content-type;host;x-content-sha256;x-date'

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    buildCanonicalQuery(query),
    `content-type:${contentType}`,
    `host:${host}`,
    `x-content-sha256:${xContentSha256}`,
    `x-date:${xDate}`,
    '',  // blank line between headers and signed headers (sigV4 quirk)
    signedHeadersStr,
    xContentSha256,
  ].join('\n')

  const hashedCanonicalRequest = hashSha256(canonicalRequest)
  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, hashedCanonicalRequest].join('\n')

  const kDate = hmacSha256(Buffer.from(params.credentials.secretAccessKey, 'utf8'), shortDate)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'request')
  const signature = hmacSha256(kSigning, stringToSign).toString('hex')

  const authorization = `HMAC-SHA256 Credential=${params.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`

  return {
    url: `https://${host}${path}?${buildCanonicalQuery(query)}`,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-Date': xDate,
      'X-Content-Sha256': xContentSha256,
      Authorization: authorization,
    },
    body,
  }
}

// ============================================================
// Request executor
// ============================================================

async function callArkAssetApi<TRequest, TResult>(params: {
  action: string
  requestBody: TRequest
  credentials: ArkAssetCredentials
  timeoutMs?: number
  logPrefix?: string
}): Promise<TResult> {
  const action = params.action
  const logPrefix = params.logPrefix ?? `[ARK Asset:${action}]`
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const bodyJson = JSON.stringify(params.requestBody)
  const signed = signArkRequest({
    method: 'POST',
    query: { Action: action, Version: VERSION },
    body: bodyJson,
    credentials: params.credentials,
  })

  _ulogInfo(`${logPrefix} 调用 ${action}`)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'fetch failed'
    _ulogError(`${logPrefix} 网络失败: ${msg}`)
    throw new ArkAssetApiError({
      code: 'NETWORK_ERROR',
      message: msg,
      action,
      httpStatus: 0,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  let envelope: ResponseEnvelope<TResult>
  try {
    envelope = (await response.json()) as ResponseEnvelope<TResult>
  } catch {
    const text = await response.text().catch(() => '')
    _ulogError(`${logPrefix} 响应解析失败 (HTTP ${response.status}): ${text.slice(0, 500)}`)
    throw new ArkAssetApiError({
      code: 'INVALID_RESPONSE',
      message: `non-JSON response: ${text.slice(0, 200)}`,
      action,
      httpStatus: response.status,
    })
  }

  const requestId = envelope.ResponseMetadata?.RequestId

  if (!response.ok || envelope.ResponseMetadata?.Error?.Code) {
    const errCode = envelope.ResponseMetadata?.Error?.Code ?? 'HTTP_' + response.status
    const errMsg = envelope.ResponseMetadata?.Error?.Message ?? `HTTP ${response.status}`
    _ulogError(`${logPrefix} 失败 ${errCode}: ${errMsg} (requestId=${requestId ?? 'n/a'})`)
    throw new ArkAssetApiError({
      code: errCode,
      message: errMsg,
      action,
      httpStatus: response.status,
      ...(requestId !== undefined ? { requestId } : {}),
    })
  }

  if (!envelope.Result) {
    throw new ArkAssetApiError({
      code: 'MISSING_RESULT',
      message: `${action} returned no Result envelope`,
      action,
      httpStatus: response.status,
      ...(requestId !== undefined ? { requestId } : {}),
    })
  }

  _ulogInfo(`${logPrefix} OK (requestId=${requestId ?? 'n/a'})`)
  return envelope.Result
}

// ============================================================
// Public API — three endpoints
// ============================================================

/**
 * Create an Asset Group (asset 容器). Per-user typically one group;
 * lazy-created on first character/scene/prop registration. Requires
 * the user to have signed the 「Seedance 2.0 高级创作权益包」 authorization
 * in the Volcengine console — without that the API returns
 * `AuthorizationNotSigned` or similar.
 */
export async function arkCreateAssetGroup(
  body: CreateAssetGroupRequest,
  credentials: ArkAssetCredentials,
): Promise<CreateAssetGroupResponse> {
  return await callArkAssetApi<CreateAssetGroupRequest, CreateAssetGroupResponse>({
    action: 'CreateAssetGroup',
    requestBody: {
      ProjectName: DEFAULT_PROJECT_NAME,
      GroupType: 'AIGC',
      ...body,
    },
    credentials,
  })
}

/**
 * Submit an asset (image URL) into a group. Async — returns the asset
 * Id immediately; status starts as `Processing` and transitions to
 * `Active` or `Failed` over the next few seconds to ~15 minutes
 * (Volcengine doesn't commit to SLA). Caller must poll via arkGetAsset.
 *
 * URL must be publicly reachable from Volcengine's backend (cn-beijing).
 * Cloudflare R2 signed URLs work; localhost / VPN-only URLs do not.
 * Image must be jpeg/png/webp/bmp/tiff/gif/heic/heif, ≤30 MB,
 * aspect ratio (w/h) in (0.4, 2.5), pixel side in (300, 6000).
 */
export async function arkCreateAsset(
  body: CreateAssetRequest,
  credentials: ArkAssetCredentials,
): Promise<CreateAssetResponse> {
  return await callArkAssetApi<CreateAssetRequest, CreateAssetResponse>({
    action: 'CreateAsset',
    requestBody: {
      ProjectName: DEFAULT_PROJECT_NAME,
      ...body,
    },
    credentials,
  })
}

/**
 * Poll an asset's processing status. Returns the full asset metadata
 * including a signed URL (12-hour expiry — don't cache long).
 *
 * Status values:
 *   - 'Processing' — still validating, retry after a few seconds
 *   - 'Active'     — ready to use as asset://<Id> in Seedance content[]
 *   - 'Failed'     — Error.{Code,Message} explains why; common causes:
 *                    invalid URL, image too large, real-person face
 *                    detected (RealPersonNotAllowed or similar)
 */
export async function arkGetAsset(
  body: GetAssetRequest,
  credentials: ArkAssetCredentials,
): Promise<GetAssetResponse> {
  return await callArkAssetApi<GetAssetRequest, GetAssetResponse>({
    action: 'GetAsset',
    requestBody: {
      ProjectName: DEFAULT_PROJECT_NAME,
      ...body,
    },
    credentials,
  })
}

// ============================================================
// Test-only exports — signing internals
//
// Hidden behind a single export object so production callers can't
// accidentally pull them. The unit test in tests/unit/ark-asset-api
// validates byte-for-byte parity with the Python reference.
// ============================================================

export const __testing = {
  signArkRequest,
  formatArkDate,
  buildCanonicalQuery,
  hashSha256,
  hmacSha256,
}
