import { describe, expect, it } from 'vitest'
import { formatDepthRebuildTerminalError } from '@/app/[locale]/live-composite/lib/depth-rebuild-errors'

describe('depth rebuild terminal errors', () => {
  it('MediaRecorder WebM 缺少 duration -> 告知在 AtlasCloud 前停止並提供下一步', () => {
    expect(formatDepthRebuildTerminalError(
      'SEEDANCE_REFERENCE_PROBE_DURATION_INVALID',
      'run-depth-1',
    )).toBe(
      '系統無法讀取深度影片的秒數，已在送往 AtlasCloud 前停止。請清除失敗任務後重新送出；若仍失敗，請重新產生深度影片。',
    )
  })

  it('供應商回傳其他錯誤 -> 保留實際錯誤內容，不隱藏問題', () => {
    expect(formatDepthRebuildTerminalError(
      'provider rejected reference video',
      'run-depth-2',
    )).toBe('深度重建執行失敗：provider rejected reference video')
  })

  it('任務沒有錯誤訊息 -> 顯示可追查的任務編號', () => {
    expect(formatDepthRebuildTerminalError(null, 'run-depth-3'))
      .toBe('深度重建執行失敗（任務 run-depth-3）')
  })
})
