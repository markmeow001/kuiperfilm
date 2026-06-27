/**
 * 无限画布 persistence hooks (2026-06-27, M1.5).
 *
 * useCanvas()      — GET /api/canvas, the caller's latest canvas (or null).
 * useSaveCanvas()  — POST /api/canvas upsert; returns the saved canvas.
 *
 * One autosaved canvas per user for now; the client passes back the id it got
 * from the last save so subsequent saves update in place.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJsonWithError } from './mutation-shared'

export interface CanvasRecordView {
  id: string
  title: string
  nodes: unknown
  edges: unknown
  viewport: unknown
  updatedAt: string
}

export interface CanvasSavePayload {
  id?: string
  title?: string
  nodes: unknown[]
  edges: unknown[]
  viewport: { x: number; y: number; zoom: number }
}

const CANVAS_QUERY_KEY = ['canvas', 'default']

export function useCanvas() {
  return useQuery({
    queryKey: CANVAS_QUERY_KEY,
    queryFn: async (): Promise<{ canvas: CanvasRecordView | null }> => {
      return (await requestJsonWithError(
        '/api/canvas',
        { method: 'GET' },
        '加载画布失败',
      )) as { canvas: CanvasRecordView | null }
    },
    // Load once on mount; autosave owns the durable copy after that.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useSaveCanvas() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CanvasSavePayload): Promise<{ canvas: CanvasRecordView }> => {
      return (await requestJsonWithError(
        '/api/canvas',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        '保存画布失败',
      )) as { canvas: CanvasRecordView }
    },
    onSuccess: ({ canvas }) => {
      // Keep the cached canvas id fresh without refetching the whole blob.
      queryClient.setQueryData(CANVAS_QUERY_KEY, { canvas })
    },
  })
}
