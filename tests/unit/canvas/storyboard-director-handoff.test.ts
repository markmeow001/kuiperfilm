import { describe, expect, it } from 'vitest'
import { buildStoryboardBlockingBrief } from '@/app/[locale]/canvas/lib/storyboard-director-handoff'

describe('storyboard -> director handoff', () => {
  it('选中分镜 -> 保留镜号、景别、运镜与画面描述', () => {
    expect(buildStoryboardBlockingBrief([
      { shotNumber: 3, description: '两人隔桌对峙', shotSize: '双人中景', cameraMove: '缓慢推进' },
      { shotNumber: 4, description: '角色A起身离席' },
    ])).toBe('镜 3（双人中景 / 缓慢推进）：两人隔桌对峙\n镜 4：角色A起身离席')
  })

  it('大量分镜 -> AI 排戏输入严格限制为 800 字', () => {
    const result = buildStoryboardBlockingBrief(Array.from({ length: 20 }, (_, index) => ({
      shotNumber: index + 1,
      description: '很长的画面描述'.repeat(20),
    })))
    expect(result.length).toBe(800)
  })
})
