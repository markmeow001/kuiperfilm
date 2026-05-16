import { NextRequest, NextResponse } from 'next/server'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'

// /cso F1 (2026-05-16) — this endpoint was anonymous and would sign URLs
// for any COS key. The full fix is to parse the key and verify the caller
// owns the project it belongs to (key prefix carries projectId/storyboardId
// in modern uploads). Today we close the anonymous door with requireUserAuth;
// the residual IDOR — logged-in user A signs key belonging to user B if A
// knows the key — is tracked in memory as a follow-up.
//
// No internal callsites use this endpoint; only tests/contracts/route-catalog.ts
// references it as part of the route inventory. If logs show no traffic for
// 30 days, delete it outright in a follow-up.
export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 生成签名 URL（1小时有效期）
  const signedUrl = toFetchableUrl(getSignedUrl(key, 3600))

  // 重定向到签名 URL
  return NextResponse.redirect(signedUrl)
})
