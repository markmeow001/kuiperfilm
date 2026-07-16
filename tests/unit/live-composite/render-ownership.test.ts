import { describe, expect, it } from 'vitest'
import { shouldRenderPreview } from '@/app/[locale]/live-composite/lib/render-ownership'

describe('live composite canvas render ownership', () => {
  it('合成影片輸出中 -> 一般預覽不得寫入共用畫布', () => {
    expect(shouldRenderPreview(true)).toBe(false)
  })

  it('沒有輸出影片 -> 一般預覽可以更新畫布', () => {
    expect(shouldRenderPreview(false)).toBe(true)
  })
})
