import { describe, expect, it } from 'vitest'
import {
  MAX_DURATION_SECONDS,
  MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
  MIN_DURATION_SECONDS,
  computeVideo2Quota,
} from '@/app/[locale]/live-composite/lib/atlascloud-r2v-contract'
import {
  FACE_COVERAGE_PASS_RATIO,
  FACE_COVERAGE_WARN_RATIO,
  RESOLUTION_PASS_MIN_SHORT_SIDE,
  RESOLUTION_WARN_MIN_SHORT_SIDE,
  assessMaterialReadiness,
  buildReferenceMappingPreview,
  type MaterialReadinessInput,
  type MaterialReadinessRowKey,
} from '@/app/[locale]/live-composite/lib/material-readiness'

const box = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 }

/** total 個取樣點，前 detected 個有臉、其餘漏檢。 */
function trackWithCoverage(detected: number, total: number) {
  return {
    samples: Array.from({ length: total }, (_, index) => ({
      time: index * 0.5,
      faceBox: index < detected ? box : null,
    })),
  }
}

function baseInput(overrides: Partial<MaterialReadinessInput> = {}): MaterialReadinessInput {
  return {
    durationSec: 10,
    width: 1920,
    height: 1080,
    hasAudio: true,
    faceTrack: trackWithCoverage(20, 20),
    ...overrides,
  }
}

function row(input: MaterialReadinessInput, key: MaterialReadinessRowKey) {
  const found = assessMaterialReadiness(input).rows.find((entry) => entry.key === key)
  if (!found) throw new Error(`缺少檢查列：${key}`)
  return found
}

describe('material readiness — 時長', () => {
  it('不足 4 秒 -> fail 並說明無法生成', () => {
    const result = row(baseInput({ durationSec: 3.9 }), 'duration')
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('3.9 秒')
    expect(result.detail).toContain(`不足 ${MIN_DURATION_SECONDS} 秒`)
    expect(result.detail).toContain('無法生成')
  })

  it('恰好 4 秒（下界）-> pass', () => {
    const result = row(baseInput({ durationSec: MIN_DURATION_SECONDS }), 'duration')
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('4 秒')
  })

  it('恰好 15 秒（上界）-> pass', () => {
    const result = row(baseInput({ durationSec: MAX_DURATION_SECONDS }), 'duration')
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('15 秒')
  })

  it('超過 15 秒 -> fail 並指出參考影片合計上限與剪短/分段', () => {
    const result = row(baseInput({ durationSec: 15.1 }), 'duration')
    expect(result.status).toBe('fail')
    expect(result.detail).toContain(`超過 ${MAX_TOTAL_REFERENCE_VIDEO_SECONDS} 秒`)
    expect(result.detail).toContain('參考影片合計上限')
    expect(result.detail).toContain('剪短或分段')
  })

  it('時長無效（NaN / 0）-> unknown', () => {
    expect(row(baseInput({ durationSec: Number.NaN }), 'duration').status).toBe('unknown')
    expect(row(baseInput({ durationSec: 0 }), 'duration').status).toBe('unknown')
  })
})

describe('material readiness — 解析度（產品預設門檻）', () => {
  it('短邊 >=1080 -> pass（含直式影片）', () => {
    expect(row(baseInput({ width: 1920, height: 1080 }), 'resolution').status).toBe('pass')
    expect(row(baseInput({ width: 1080, height: 1920 }), 'resolution').status).toBe('pass')
  })

  it('短邊 720–1079 -> warn 並提示細節傳遞較弱', () => {
    const result = row(baseInput({ width: 1280, height: 720 }), 'resolution')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('細節傳遞較弱')
    expect(row(baseInput({ width: 1919, height: RESOLUTION_PASS_MIN_SHORT_SIDE - 1 }), 'resolution').status).toBe('warn')
  })

  it('短邊 <720 -> fail 並提示表演細節可能不足', () => {
    const result = row(baseInput({ width: 640, height: 480 }), 'resolution')
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('表演細節可能不足')
    expect(result.detail).toContain(`${RESOLUTION_WARN_MIN_SHORT_SIDE}px`)
  })

  it('解析度無效 -> unknown', () => {
    expect(row(baseInput({ width: 0, height: 1080 }), 'resolution').status).toBe('unknown')
    expect(row(baseInput({ width: Number.NaN, height: 1080 }), 'resolution').status).toBe('unknown')
  })
})

describe('material readiness — 音訊', () => {
  it('含音訊 -> pass（口型/台詞參考完整）', () => {
    const result = row(baseInput({ hasAudio: true }), 'audio')
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('口型／台詞參考完整')
  })

  it('無音訊 -> warn（無同期聲）', () => {
    const result = row(baseInput({ hasAudio: false }), 'audio')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('無同期聲')
  })

  it('無法偵測（null）-> unknown', () => {
    const result = row(baseInput({ hasAudio: null }), 'audio')
    expect(result.status).toBe('unknown')
    expect(result.detail).toContain('無法偵測')
  })
})

describe('material readiness — 臉部覆蓋（產品預設門檻）', () => {
  it('尚未分析（faceTrack null / undefined）-> unknown 並提示先跑臉部分析', () => {
    for (const input of [baseInput({ faceTrack: null }), baseInput({ faceTrack: undefined })]) {
      const result = row(input, 'faceCoverage')
      expect(result.status).toBe('unknown')
      expect(result.detail).toContain('尚未執行臉部分析')
    }
  })

  it('取樣點為空 -> unknown', () => {
    expect(row(baseInput({ faceTrack: { samples: [] } }), 'faceCoverage').status).toBe('unknown')
  })

  it('覆蓋率 100% -> pass 並顯示比例', () => {
    const result = row(baseInput({ faceTrack: trackWithCoverage(20, 20) }), 'faceCoverage')
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('100%')
    expect(result.detail).toContain('20/20')
  })

  it(`覆蓋率恰好 ${FACE_COVERAGE_PASS_RATIO}（邊界）-> pass`, () => {
    expect(row(baseInput({ faceTrack: trackWithCoverage(9, 10) }), 'faceCoverage').status).toBe('pass')
  })

  it(`覆蓋率 ${FACE_COVERAGE_WARN_RATIO}–${FACE_COVERAGE_PASS_RATIO} -> warn 並列出漏檢時間段`, () => {
    const result = row(baseInput({ faceTrack: trackWithCoverage(7, 10) }), 'faceCoverage')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('70%')
    // 前 7 點有臉（0–3s），後 3 點漏檢：3.5s–4.5s 合併為單一時間段。
    expect(result.detail).toContain('漏檢時間段')
    expect(result.detail).toContain('3.50–4.50s')
  })

  it(`覆蓋率恰好 ${FACE_COVERAGE_WARN_RATIO}（邊界）-> warn`, () => {
    expect(row(baseInput({ faceTrack: trackWithCoverage(6, 10) }), 'faceCoverage').status).toBe('warn')
  })

  it(`覆蓋率 <${FACE_COVERAGE_WARN_RATIO} -> fail`, () => {
    const result = row(baseInput({ faceTrack: trackWithCoverage(5, 10) }), 'faceCoverage')
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('50%')
    expect(result.detail).toContain('漏檢時間段')
  })

  it('不連續漏檢 -> 分成多個時間段', () => {
    const samples = [
      { time: 0, faceBox: box },
      { time: 0.5, faceBox: null },
      { time: 1, faceBox: box },
      { time: 1.5, faceBox: null },
      { time: 2, faceBox: null },
      { time: 2.5, faceBox: box },
      { time: 3, faceBox: box },
      { time: 3.5, faceBox: box },
      { time: 4, faceBox: box },
      { time: 4.5, faceBox: box },
    ]
    const result = row(baseInput({ faceTrack: { samples } }), 'faceCoverage')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('0.50s')
    expect(result.detail).toContain('1.50–2.00s')
  })
})

describe('material readiness — video 2 配額（接 computeVideo2Quota）', () => {
  it('10 秒素材 -> pass 並顯示剩餘 5 秒', () => {
    const result = row(baseInput({ durationSec: 10 }), 'video2Quota')
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('剩餘 5 秒')
    expect(result.detail).toContain('video 2')
  })

  it('超過產品預設門檻（12 秒）-> warn 並沿用契約 lib 的停用原因', () => {
    const result = row(baseInput({ durationSec: 12 }), 'video2Quota')
    expect(result.status).toBe('warn')
    expect(result.detail).toBe(computeVideo2Quota(12).disabledReason)
  })

  it('時長無效 -> unknown', () => {
    expect(row(baseInput({ durationSec: Number.NaN }), 'video2Quota').status).toBe('unknown')
  })
})

describe('material readiness — 總體判定與摘要', () => {
  it('全部通過 -> ready 並產生繁中摘要', () => {
    const report = assessMaterialReadiness(baseInput())
    expect(report.verdict).toBe('ready')
    expect(report.summary).toContain('符合 Track B／B0 規格')
    expect(report.rows.map((entry) => entry.key)).toEqual([
      'duration',
      'resolution',
      'audio',
      'faceCoverage',
      'video2Quota',
    ])
  })

  it('只有 warn -> warn 摘要標示需注意項數', () => {
    const report = assessMaterialReadiness(baseInput({ hasAudio: false }))
    expect(report.verdict).toBe('warn')
    expect(report.summary).toContain('1 項需要注意')
  })

  it('任一 fail -> fail（優先於 warn）', () => {
    const report = assessMaterialReadiness(baseInput({ durationSec: 3, hasAudio: false }))
    expect(report.verdict).toBe('fail')
    expect(report.summary).toContain('不符合 Track B／B0 規格')
  })

  it('unknown 不降級判定，但 ready 摘要會提示未確認項目', () => {
    const report = assessMaterialReadiness(baseInput({ faceTrack: null }))
    expect(report.verdict).toBe('ready')
    expect(report.summary).toContain('未確認')
  })
})

describe('buildReferenceMappingPreview — 參考素材順序規劃預覽', () => {
  it('10 秒素材 -> 依 §2.3 順序：video 1（本素材）、video 2、audio 1、image 1–6', () => {
    const rows = buildReferenceMappingPreview(10)
    expect(rows.map((entry) => entry.token)).toEqual([
      'video 1',
      'video 2',
      'audio 1',
      'image 1',
      'image 2',
      'image 3',
      'image 4',
      'image 5',
      'image 6',
    ])
    expect(rows[0]).toMatchObject({ role: '主表演影片', note: '本素材' })
    expect(rows.slice(1).every((entry) => entry.note === '規劃中')).toBe(true)
  })

  it('12 秒素材（video 2 依配額停用）-> 不列 video 2，其餘 token 不受影響', () => {
    const rows = buildReferenceMappingPreview(12)
    expect(rows.map((entry) => entry.token)).toEqual([
      'video 1',
      'audio 1',
      'image 1',
      'image 2',
      'image 3',
      'image 4',
      'image 5',
      'image 6',
    ])
  })
})
