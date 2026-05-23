/**
 * useRegisterArkAsset — Phase 3 (2026-05-23).
 *
 * Triggers the 火山方舟 asset registration flow (CreateAssetGroup →
 * CreateAsset → poll GetAsset) for a character appearance, location
 * image, or prop. Backend route lives at:
 *   POST /api/novel-promotion/<projectId>/ark-asset/register
 *
 * The route is idempotent (returns reused=true if subject already has
 * an active asset whose sourceUrl matches the current imageUrl), so the
 * UI can safely call it repeatedly — only the FIRST real submission
 * burns Volcengine quota.
 *
 * Caller-side UX:
 *   - Optimistic chip flip:
 *       click → "報備中…" (server replies pending)
 *       chip stays "報備中…" while polling (handled by query refetch
 *       picking up arkAssetStatus changes — this hook doesn't poll)
 *       chip → "✓ 已報備" or "⚠ 失敗" when the underlying subject
 *       row's arkAssetStatus flips via background refetch
 *   - On error: show alert (no global toast in V2 yet), user can retry.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'

type RegisterTargetType = 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'

interface RegisterArkAssetVariables {
  targetType: RegisterTargetType
  targetId: string
}

interface RegisterArkAssetResult {
  reused?: boolean
  arkAssetId?: string
  status?: string
  taskId?: string
}

export function useRegisterArkAsset(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<RegisterArkAssetResult, Error, RegisterArkAssetVariables>({
    mutationFn: async ({ targetType, targetId }) => {
      const res = await fetch(
        `/api/novel-promotion/${projectId}/ark-asset/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType,
            targetId,
            meta: { locale: 'zh-TW' },
          }),
        },
      )
      const data: unknown = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errData = (data as { error?: { message?: string; code?: string }; message?: string }) ?? {}
        const message = errData.error?.message ?? errData.message ?? `HTTP ${res.status}`
        const err = new Error(message) as Error & { code?: string }
        if (errData.error?.code) err.code = errData.error.code
        throw err
      }
      return data as RegisterArkAssetResult
    },
    onSuccess: () => {
      // Invalidate the project asset queries so the appearance/location/
      // prop chip flips from "未報備" → "處理中" / "已報備" on next refetch.
      // The pending state is already written server-side by the route
      // handler; this just nudges the cache to pull fresh status sooner.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) })
    },
  })
}
