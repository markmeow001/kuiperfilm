import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

type PreferenceRow = Awaited<ReturnType<typeof prisma.userPreference.upsert>>

// Even encrypted apiKey ciphertext shouldn't reach the client — it pairs with
// API_ENCRYPTION_KEY on the server and accumulating leaked ciphertexts widens
// the attack surface across rotations. customProviders has provider configs
// the UI needs (id/name/baseUrl); the apiKey field gets stripped.
function sanitizePreference(pref: PreferenceRow): PreferenceRow {
  let safeCustomProviders = pref.customProviders
  if (safeCustomProviders) {
    try {
      const parsed: unknown = JSON.parse(safeCustomProviders)
      if (Array.isArray(parsed)) {
        const stripped = parsed.map((p) => {
          if (p && typeof p === 'object') {
            const { apiKey: _omit, ...rest } = p as Record<string, unknown>
            return rest
          }
          return p
        })
        safeCustomProviders = JSON.stringify(stripped)
      }
    } catch {
      safeCustomProviders = null
    }
  }
  return {
    ...pref,
    llmApiKey: null,
    falApiKey: null,
    googleAiKey: null,
    arkApiKey: null,
    qwenApiKey: null,
    customProviders: safeCustomProviders,
  }
}

// GET - 获取用户偏好配置
export const GET = apiHandler(async () => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 获取或创建用户偏好
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: {},
    create: { userId: session.user.id }
  })

  return NextResponse.json({ preference: sanitizePreference(preference) })
})

// PATCH - 更新用户偏好配置
export const PATCH = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()

  // 只允许更新特定字段
  const allowedFields = [
    'analysisModel',
    'characterModel',
    'locationModel',
    'storyboardModel',
    'editModel',
    'videoModel',
    'lipSyncModel',
    'videoRatio',
    'artStyle',
    'ttsRate'
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field]
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 更新或创建用户偏好
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: updateData,
    create: {
      userId: session.user.id,
      ...updateData
    }
  })

  return NextResponse.json({ preference: sanitizePreference(preference) })
})
