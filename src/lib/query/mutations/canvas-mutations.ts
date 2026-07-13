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
  kind: 'canvas' | 'workflow'
  nodes: unknown
  edges: unknown
  viewport: unknown
  updatedAt: string
}

export interface CanvasSavePayload {
  id?: string
  title?: string
  kind?: 'canvas' | 'workflow'
  nodes: unknown[]
  edges: unknown[]
  viewport: { x: number; y: number; zoom: number }
}

const CANVAS_QUERY_KEY = ['canvas', 'resources']

export interface CanvasResourcesResponse {
  canvas: CanvasRecordView | null
  resources: CanvasRecordView[]
}

export function useCanvas() {
  return useQuery({
    queryKey: CANVAS_QUERY_KEY,
    queryFn: async (): Promise<CanvasResourcesResponse> => {
      return (await requestJsonWithError(
        '/api/canvas',
        { method: 'GET' },
        '加载画布失败',
      )) as CanvasResourcesResponse
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
      queryClient.setQueryData<CanvasResourcesResponse>(CANVAS_QUERY_KEY, (current) => {
        const resources = current?.resources ?? []
        const next = [canvas, ...resources.filter((item) => item.id !== canvas.id)]
        return {
          canvas: canvas.kind === 'canvas' ? canvas : (current?.canvas ?? null),
          resources: next,
        }
      })
    },
  })
}

export function useDeleteCanvas() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<{ deletedId: string }> => {
      return (await requestJsonWithError(
        `/api/canvas?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
        '删除失败',
      )) as { deletedId: string }
    },
    onSuccess: ({ deletedId }) => {
      queryClient.setQueryData<CanvasResourcesResponse>(CANVAS_QUERY_KEY, (current) => {
        if (!current) return current
        const resources = current.resources.filter((item) => item.id !== deletedId)
        const canvas = current.canvas?.id === deletedId
          ? (resources.find((item) => item.kind === 'canvas') ?? null)
          : current.canvas
        return { canvas, resources }
      })
    },
  })
}
