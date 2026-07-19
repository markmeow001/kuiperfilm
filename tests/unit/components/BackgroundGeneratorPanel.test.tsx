import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackgroundGeneratorPanel } from '@/app/[locale]/live-composite/BackgroundGeneratorPanel'

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  runs: [] as Array<{
    id: string
    status: 'pending' | 'running' | 'succeeded' | 'failed'
    resultUrls: string[] | null
    errorMessage: string | null
  }>,
}))

vi.mock('@/lib/query/hooks/useUserModels', () => ({
  useUserModels: () => ({
    data: { image: [{ value: 'atlascloud::gpt-image-1', label: 'GPT Image 1' }] },
  }),
}))

vi.mock('@/lib/query/mutations/playground-mutations', () => ({
  useSubmitPlaygroundRun: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  usePlaygroundRuns: () => ({ data: { runs: mocks.runs } }),
  usePlaygroundCostEstimate: () => ({ data: { amountUsd: 0.05 } }),
}))

describe('BackgroundGeneratorPanel', () => {
  afterEach(() => {
    mocks.mutateAsync.mockReset()
    mocks.runs.splice(0)
    vi.unstubAllGlobals()
  })

  it('提交空景描述 -> 沿用既有圖片任務、模型與實拍比例', async () => {
    mocks.mutateAsync.mockResolvedValue({ run: { id: 'run-bg-1' } })
    render(<BackgroundGeneratorPanel metadata={{ width: 1920, height: 1080, duration: 3, name: 'shot.mp4' }} disabled={false} onGenerated={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('背景概念圖描述'), { target: { value: '雨夜霓虹街道' } })
    fireEvent.click(screen.getByRole('button', { name: '生成背景概念圖' }))

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({
      prompt: '雨夜霓虹街道\n只生成乾淨的場景背景，不要人物、文字、浮水印或邊框。',
      outputType: 'image',
      modelKey: 'atlascloud::gpt-image-1',
      aspectRatio: '16:9',
    }))
    expect(screen.getByText('預估 US$0.050')).toBeInTheDocument()
  })

  it('任務完成 -> 經同源下載代理轉成圖片 File 後套用', async () => {
    mocks.mutateAsync.mockResolvedValue({ run: { id: 'run-bg-2' } })
    mocks.runs.push({ id: 'run-bg-2', status: 'succeeded', resultUrls: ['https://cdn.example/bg.webp'], errorMessage: null })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/webp' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onGenerated = vi.fn()
    render(<BackgroundGeneratorPanel metadata={null} disabled={false} onGenerated={onGenerated} />)

    fireEvent.change(screen.getByLabelText('背景概念圖描述'), { target: { value: '乾淨攝影棚空景' } })
    fireEvent.click(screen.getByRole('button', { name: '生成背景概念圖' }))

    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1))
    const generated = onGenerated.mock.calls[0][0] as File
    expect(generated.name).toBe('ai-background.webp')
    expect(generated.type).toBe('image/webp')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/playground/download?')
    expect(screen.getByText('背景概念圖已生成並套用為合成預覽背景；儲存專案時會一併保存。')).toBeInTheDocument()
  })
})
