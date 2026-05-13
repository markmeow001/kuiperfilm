/**
 * Tencent VOD AIGC 自定义主体 (Custom Element) 註冊服務.
 *
 * Per VOD AIGC 接入指南 §3.9.4.2 — Kling 3.0/3.0-Omni's "固定主体" binding
 * path. Pre-register character/scene/prop reference images via
 * `CreateAigcCustomElement` (sync API) and cache the returned ElementId in
 * our DB. On subsequent video generation we pass the ElementId via
 * `ExtInfo.AdditionalParameters.element_list` and reference it from the
 * prompt as `<<<element_N>>>` (1-based against the list order).
 *
 * Why this over FileInfos+ObjectId+`<<<image_N>>>` (§3.9.4.1)?
 *
 *   - §3.9.4.1 ad-hoc references work but Kling tends to fall back to its
 *     training prior when the prompt is verbose (observed 2026-05-13:
 *     long-haired CG xianxia young man instead of the 35yo with stubble
 *     in the reference image).
 *   - §3.9.4.2 element_list is Tencent's documented path for character
 *     identity consistency. The official Python sample for multi-element
 *     binding uses this path, not §3.9.4.1.
 *
 * Lifecycle:
 *   1. First call for an entity: hits Tencent, returns ElementId, caches.
 *   2. Subsequent calls: returns cached ElementId from DB.
 *   3. On API failure: returns null. Caller falls back to FileInfos path.
 *
 * Schema (added 2026-05-13):
 *   CharacterAppearance.tencentVodElementId  String? @db.VarChar(64)
 *   LocationImage.tencentVodElementId        String? @db.VarChar(64)
 *   NovelPromotionProp.tencentVodElementId   String? @db.VarChar(64)
 *
 * NOT yet wired:
 *   - Eager registration on appearance/image creation. Lazy-only for now.
 *   - Cleanup of orphaned Elements when appearances are deleted.
 *   - Re-register when the underlying image changes (no invalidation today).
 */

import { prisma } from '@/lib/prisma'
import { getProviderConfig } from '@/lib/api-config'
import { vod } from 'tencentcloud-sdk-nodejs-vod'
import { createScopedLogger } from '@/lib/logging/core'

const VodClient = vod.v20180717.Client

const logger = createScopedLogger({
  module: 'lib.tencent-vod.element-register',
  action: 'tencent_vod_element_register',
})

interface TencentVODCredentials {
  secretId: string
  secretKey: string
  subAppId: number
  region: string
}

function parseCredentials(apiKey: string): TencentVODCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(apiKey)
  } catch {
    throw new Error('TENCENT_VOD_INVALID_CREDENTIALS')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('TENCENT_VOD_INVALID_CREDENTIALS')
  }
  const obj = parsed as Record<string, unknown>
  const secretId = typeof obj.secretId === 'string' ? obj.secretId : ''
  const secretKey = typeof obj.secretKey === 'string' ? obj.secretKey : ''
  const subAppId = typeof obj.subAppId === 'number' ? obj.subAppId : Number(obj.subAppId)
  const region = typeof obj.region === 'string' && obj.region ? obj.region : 'ap-guangzhou'
  if (!secretId || !secretKey || !Number.isFinite(subAppId) || subAppId <= 0) {
    throw new Error('TENCENT_VOD_INVALID_CREDENTIALS')
  }
  return { secretId, secretKey, subAppId, region }
}

export type ElementEntityType = 'character-appearance' | 'location-image' | 'prop'

interface RegisterOptions {
  userId: string
  entityType: ElementEntityType
  entityId: string
  /** Human-readable entity name. Truncated to Tencent's 20-char ElementName limit. */
  name: string
  /** Public/signed URL of the frontal reference image. jpg/jpeg/png, ≥300px, ratio 1:2.5–2.5:1. */
  imageUrl: string
  /** Optional description, capped at 100 chars per Tencent spec. */
  description?: string
}

/**
 * Read the cached ElementId for an entity. Returns null if not yet registered.
 */
async function readExistingElementId(
  entityType: ElementEntityType,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'character-appearance') {
    const row = await prisma.characterAppearance.findUnique({
      where: { id: entityId },
      select: { tencentVodElementId: true },
    })
    return row?.tencentVodElementId ?? null
  }
  if (entityType === 'location-image') {
    const row = await prisma.locationImage.findUnique({
      where: { id: entityId },
      select: { tencentVodElementId: true },
    })
    return row?.tencentVodElementId ?? null
  }
  const row = await prisma.novelPromotionProp.findUnique({
    where: { id: entityId },
    select: { tencentVodElementId: true },
  })
  return row?.tencentVodElementId ?? null
}

async function persistElementId(
  entityType: ElementEntityType,
  entityId: string,
  elementId: string,
): Promise<void> {
  if (entityType === 'character-appearance') {
    await prisma.characterAppearance.update({
      where: { id: entityId },
      data: { tencentVodElementId: elementId },
    })
    return
  }
  if (entityType === 'location-image') {
    await prisma.locationImage.update({
      where: { id: entityId },
      data: { tencentVodElementId: elementId },
    })
    return
  }
  await prisma.novelPromotionProp.update({
    where: { id: entityId },
    data: { tencentVodElementId: elementId },
  })
}

/**
 * Sanitize and truncate a name to Tencent's 20-char ElementName ceiling.
 * Tencent's UTF-8 char count appears to map 1:1 with display chars for CJK
 * (a 6-char Chinese name like "洞府内_白天" counts as 6).
 */
function sanitizeElementName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 20) return trimmed || 'unnamed'
  return trimmed.slice(0, 20)
}

/**
 * Get cached ElementId, or register a new one with Tencent VOD and cache it.
 *
 * Returns null on any failure path (network, credentials, validation). The
 * caller MUST treat null as "use the FileInfos fallback" — do not throw.
 *
 * Concurrent-register note: if two callers race for the same entityId, both
 * may call CreateAigcCustomElement and create two Tencent-side Elements,
 * with the second persistElementId overwriting the first. Cost is one
 * orphaned Element on Tencent (a few cents). Not worth a row-lock today.
 */
export async function getOrCreateTencentVodElement(
  opts: RegisterOptions,
): Promise<string | null> {
  // 1. Cache hit
  try {
    const existing = await readExistingElementId(opts.entityType, opts.entityId)
    if (existing && existing.length > 0) return existing
  } catch (err) {
    logger.warn({
      message: 'failed to read cached element id; will attempt to register',
      details: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }

  // 2. Tencent register
  if (!opts.imageUrl) {
    logger.warn({
      message: 'skip register: empty imageUrl',
      details: { entityType: opts.entityType, entityId: opts.entityId },
    })
    return null
  }

  let elementId: string | null = null
  try {
    const config = await getProviderConfig(opts.userId, 'tencent-vod')
    const creds = parseCredentials(config.apiKey)
    const client = new VodClient({
      credential: { secretId: creds.secretId, secretKey: creds.secretKey },
      region: creds.region,
      profile: { httpProfile: { endpoint: 'vod.tencentcloudapi.com' } },
    })

    const elementName = sanitizeElementName(opts.name)
    const elementDescription =
      (opts.description?.trim().slice(0, 100)) ||
      `${opts.entityType}:${elementName}`

    // SDK typing requires ElementReferList (additional reference views).
    // The Tencent doc Python example shows minimal payload (no extra refs)
    // is accepted; passing an empty array satisfies the type and matches
    // the doc's recommended single-frontal-image use case.
    // SubAppId is not in the typed request but the actual API expects it
    // for multi-tenant routing — pass via `as any` cast.
    const resp = await client.CreateAigcCustomElement({
      SubAppId: creds.subAppId,
      ElementName: elementName,
      ElementDescription: elementDescription,
      ElementFrontalImage: opts.imageUrl,
      ElementReferList: [],
    } as unknown as Parameters<typeof client.CreateAigcCustomElement>[0])

    if (resp.ElementId) {
      elementId = String(resp.ElementId)
      logger.info({
        message: 'tencent vod element created',
        details: {
          entityType: opts.entityType,
          entityId: opts.entityId,
          elementId,
          requestId: resp.RequestId ?? null,
        },
      })
    } else {
      logger.warn({
        message: 'tencent vod element response missing ElementId',
        details: {
          entityType: opts.entityType,
          entityId: opts.entityId,
          requestId: resp.RequestId ?? null,
        },
      })
    }
  } catch (err) {
    logger.warn({
      message: 'tencent vod CreateAigcCustomElement failed',
      details: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        error: err instanceof Error ? err.message : String(err),
        imageUrlHead: opts.imageUrl.slice(0, 120),
      },
    })
  }

  if (!elementId) return null

  // 3. Persist
  try {
    await persistElementId(opts.entityType, opts.entityId, elementId)
  } catch (err) {
    // Element was successfully created on Tencent's side but we couldn't
    // cache the ID. Caller still gets the ID for this request; the next
    // request will register again (orphaned Element on Tencent side).
    logger.warn({
      message: 'failed to persist element id; element exists on Tencent but not cached',
      details: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        elementId,
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }

  return elementId
}

/**
 * Pod-local cache for style reference elements. Style refs are global
 * platform assets (not per-entity rows), so adding a Prisma table just
 * to cache 3-6 element ids per Tencent subAppId is overkill — the URLs
 * never change at runtime and a cold cache costs one CreateAigcCustomElement
 * call per pod boot per (userId, url) pair.
 *
 * Keyed by `${userId}:${url}` because CustomElements are bound to the
 * caller's Tencent SubAppId, which we derive from per-user provider
 * config. Two users won't see each other's elementIds.
 */
const styleRefCache = new Map<string, string>()

interface RegisterStyleReferenceOptions {
  userId: string
  /** URL of the style anchor image (must be permanently accessible). */
  url: string
  /** Short label — Tencent's ElementName limit is 20 chars. */
  label: string
}

/**
 * Get-or-register a style reference image as a Tencent CustomElement.
 *
 * Unlike `getOrCreateTencentVodElement` (which caches against per-entity
 * Prisma rows), style references are cached in process memory because:
 *   - They're tiny (3-6 elements per preset across the platform)
 *   - URLs are hardcoded in `presets.ts` and don't churn
 *   - Worst-case re-registration on pod reboot is cheap (~1-2s)
 *
 * Returns null on any failure (network, validation, missing creds). The
 * caller MUST treat null as "this task can't use style anchoring" — fall
 * through to text-only photorealistic anchors.
 *
 * The element's ElementDescription explicitly tags it as STYLE-ONLY so
 * Kling Omni doesn't try to match the photo's subject identity (the
 * model treats SubjectInfos.Description as a strong hint about what the
 * reference is FOR).
 */
export async function getOrRegisterStyleReferenceElement(
  opts: RegisterStyleReferenceOptions,
): Promise<string | null> {
  if (!opts.url || !opts.url.trim()) return null
  const cacheKey = `${opts.userId}:${opts.url}`
  const cached = styleRefCache.get(cacheKey)
  if (cached) return cached

  let elementId: string | null = null
  try {
    const config = await getProviderConfig(opts.userId, 'tencent-vod')
    const creds = parseCredentials(config.apiKey)
    const client = new VodClient({
      credential: { secretId: creds.secretId, secretKey: creds.secretKey },
      region: creds.region,
      profile: { httpProfile: { endpoint: 'vod.tencentcloudapi.com' } },
    })

    const elementName = sanitizeElementName(opts.label || 'style-ref')
    // 100-char cap per Tencent spec. The description is what Kling reads
    // to decide "what kind of reference is this?" — we explicitly mark it
    // as style-only so the model treats lighting/grain as the signal and
    // ignores subject identity from the photo.
    const elementDescription =
      'STYLE REFERENCE ONLY — photographic style anchor. Copy lighting, film grain, skin texture, color grading. NOT a character, NOT a scene.'

    const resp = await client.CreateAigcCustomElement({
      SubAppId: creds.subAppId,
      ElementName: elementName,
      ElementDescription: elementDescription,
      ElementFrontalImage: opts.url,
      ElementReferList: [],
    } as unknown as Parameters<typeof client.CreateAigcCustomElement>[0])

    if (resp.ElementId) {
      elementId = String(resp.ElementId)
      styleRefCache.set(cacheKey, elementId)
      logger.info({
        message: 'tencent vod style reference element created',
        details: {
          label: opts.label,
          elementId,
          requestId: resp.RequestId ?? null,
        },
      })
    } else {
      logger.warn({
        message: 'tencent vod style reference response missing ElementId',
        details: {
          label: opts.label,
          requestId: resp.RequestId ?? null,
        },
      })
    }
  } catch (err) {
    logger.warn({
      message: 'tencent vod style reference register failed',
      details: {
        label: opts.label,
        urlHead: opts.url.slice(0, 120),
        error: err instanceof Error ? err.message : String(err),
      },
    })
  }

  return elementId
}
