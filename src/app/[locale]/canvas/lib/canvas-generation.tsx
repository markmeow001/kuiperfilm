'use client'

/**
 * Canvas generation context — bridges canvas nodes to the existing Playground
 * run spine. One shared usePlaygroundRuns poll feeds every node; each node
 * looks up its own run by runId. submitNode() fires /api/playground/run and
 * hands back the new runId so the node can store it in its data.
 *
 * Reusing the playground spine means M1 inherits billing (402 on low balance),
 * the BullMQ worker, result landing, and 3s polling for free — no new task type.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import {
  usePlaygroundRuns,
  useSubmitPlaygroundRun,
  type PlaygroundRunRow,
  type PlaygroundRunSubmission,
} from '@/lib/query/mutations/playground-mutations'
import { useUserModels, type UserModelOption } from '@/lib/query/hooks/useUserModels'

interface CanvasGenerationValue {
  /** Submit a generation; resolves to the new runId (task id). */
  submitNode: (submission: PlaygroundRunSubmission) => Promise<string>
  /** Look up the live status/result of a run by id. */
  runById: (runId: string | null | undefined) => PlaygroundRunRow | null
  /** Enabled image/video model catalogs (admin-inherited). */
  imageModels: UserModelOption[]
  videoModels: UserModelOption[]
  /** True while a submit POST is in flight (any node). */
  isSubmitting: boolean
}

const CanvasGenerationContext = createContext<CanvasGenerationValue | null>(null)

export function CanvasGenerationProvider({ children }: { children: ReactNode }) {
  const submit = useSubmitPlaygroundRun()
  const runsQuery = usePlaygroundRuns(null)
  const userModelsQuery = useUserModels()

  const runsById = useMemo(() => {
    const map = new Map<string, PlaygroundRunRow>()
    for (const r of runsQuery.data?.runs ?? []) map.set(r.id, r)
    return map
  }, [runsQuery.data])

  const runById = useCallback(
    (runId: string | null | undefined) => (runId ? runsById.get(runId) ?? null : null),
    [runsById],
  )

  const submitNode = useCallback(
    async (submission: PlaygroundRunSubmission): Promise<string> => {
      const result = await submit.mutateAsync(submission)
      return result.run.id
    },
    [submit],
  )

  const value = useMemo<CanvasGenerationValue>(
    () => ({
      submitNode,
      runById,
      imageModels: userModelsQuery.data?.image ?? [],
      videoModels: userModelsQuery.data?.video ?? [],
      isSubmitting: submit.isPending,
    }),
    [submitNode, runById, userModelsQuery.data, submit.isPending],
  )

  return <CanvasGenerationContext.Provider value={value}>{children}</CanvasGenerationContext.Provider>
}

export function useCanvasGeneration(): CanvasGenerationValue {
  const ctx = useContext(CanvasGenerationContext)
  if (!ctx) throw new Error('useCanvasGeneration must be used within CanvasGenerationProvider')
  return ctx
}
