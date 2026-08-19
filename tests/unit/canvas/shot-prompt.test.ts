import { describe, expect, it } from 'vitest'
import { composeShotImagePrompt, composeShotVideoPrompt } from '@/app/[locale]/canvas/lib/shot-prompt'
import type { CanvasStoryboardShot } from '@/app/[locale]/canvas/lib/canvas-types'

const FULL_SHOT: CanvasStoryboardShot = {
  shotNumber: 3,
  description: 'Maeve闭着眼睛，摇头晃脑地沉浸在音乐中',
  shotSize: '近景',
  cameraMove: '手持轻微晃动',
  cameraAngle: '平视',
  lens: '50mm 标准',
  performance: 'Maeve陶醉、大声唱歌',
  blocking: 'Maeve在画面中央，面向镜头微左',
  durationSec: 5,
  dialogue: '我唱我的歌',
}

describe('composeShotImagePrompt', () => {
  it('[完整镜头 + 色调] -> [画面/表演/站位/镜头语言/色调 逐项标注拼接]', () => {
    expect(composeShotImagePrompt(FULL_SHOT, '冷蓝夜色')).toBe(
      [
        'Maeve闭着眼睛，摇头晃脑地沉浸在音乐中',
        '人物表演：Maeve陶醉、大声唱歌',
        '站位调度：Maeve在画面中央，面向镜头微左',
        '景别：近景；机位：平视；镜头：50mm 标准',
        '整体色调：冷蓝夜色',
      ].join('\n'),
    )
  })

  it('[只有描述] -> [prompt 就是描述本身，不产生空标注行]', () => {
    expect(composeShotImagePrompt({ shotNumber: 1, description: '一只手按下关机按钮' })).toBe(
      '一只手按下关机按钮',
    )
  })

  it('[部分镜头语言] -> [只拼有值的项，空白值当缺失]', () => {
    expect(
      composeShotImagePrompt({
        shotNumber: 1,
        description: 'desc',
        shotSize: '特写',
        cameraAngle: '  ',
        lens: '',
      }),
    ).toBe('desc\n景别：特写')
  })

  it('[无色调] -> [不出现「整体色调」行]', () => {
    expect(composeShotImagePrompt(FULL_SHOT, null)).not.toContain('整体色调')
    expect(composeShotImagePrompt(FULL_SHOT, '   ')).not.toContain('整体色调')
  })

  it('[对白] -> [不进生图 prompt（对白是配音的事，不是画面的事）]', () => {
    expect(composeShotImagePrompt(FULL_SHOT, '冷蓝夜色')).not.toContain('我唱我的歌')
  })
})

describe('composeShotVideoPrompt', () => {
  it('[有运镜] -> [在生图 prompt 之上追加运镜行]', () => {
    expect(composeShotVideoPrompt(FULL_SHOT, '冷蓝夜色')).toBe(
      `${composeShotImagePrompt(FULL_SHOT, '冷蓝夜色')}\n运镜：手持轻微晃动`,
    )
  })

  it('[无运镜] -> [与生图 prompt 完全一致]', () => {
    const shot = { ...FULL_SHOT, cameraMove: undefined }
    expect(composeShotVideoPrompt(shot, '冷蓝夜色')).toBe(composeShotImagePrompt(shot, '冷蓝夜色'))
  })
})
