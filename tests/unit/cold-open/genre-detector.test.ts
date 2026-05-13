import { describe, expect, it } from 'vitest'
import { detectColdOpenGenre, scoreColdOpenGenres } from '@/lib/cold-open/genre-detector'

describe('detectColdOpenGenre', () => {
  it('returns modern as default for empty / unmarked input', () => {
    expect(detectColdOpenGenre('')).toBe('modern')
    expect(detectColdOpenGenre('a quiet moment.')).toBe('modern')
  })

  it('detects modern from contemporary keywords', () => {
    expect(detectColdOpenGenre('她坐在咖啡廳裡翻看手機')).toBe('modern')
    expect(detectColdOpenGenre('CEO走進辦公室，秘書遞上文件')).toBe('modern')
  })

  it('detects period from xianxia / palace keywords', () => {
    expect(detectColdOpenGenre('洞府之中，弟子們依序入座')).toBe('period')
    expect(detectColdOpenGenre('皇上駕到，宮殿內群臣肅立')).toBe('period')
    expect(detectColdOpenGenre('修真大典之上，元嬰真人立於高台')).toBe('period')
  })

  it('detects action when violence dominates (>=2 action keywords)', () => {
    expect(detectColdOpenGenre('戰場上血流成河，主角揮劍殺出重圍')).toBe('action')
    expect(detectColdOpenGenre('妖獸襲擊村莊，廢墟中倖存者奔逃')).toBe('action')
  })

  it('keeps period for a xianxia battle (determined-face fits wuxia better than shocked-face)', () => {
    // Wuxia battle: action keywords present but the period markers
    // dominate. DETERMINED FACE (period push-in reaction) reads
    // truer for an ancient sword fight than SHOCKED FACE (action
    // disaster reaction). Action variant is reserved for modern /
    // contemporary violence.
    expect(
      detectColdOpenGenre('修真宗門之戰，劍光交錯，血染道袍，弟子們殺紅了眼'),
    ).toBe('period')
  })

  it('prefers action when violence is contemporary and there are no period markers', () => {
    // Modern disaster: 2+ action keywords, no period markers.
    expect(detectColdOpenGenre('廢墟之中血流不止，攻擊還在繼續')).toBe('action')
  })

  it('returns modern when only one action keyword appears (below threshold)', () => {
    expect(detectColdOpenGenre('辦公室裡傳來一聲爆炸')).toBe('modern')
  })

  it('exposes score breakdown for admin tooling', () => {
    const score = scoreColdOpenGenres('CEO走進辦公室，咖啡廳的氣氛凝重')
    expect(score.modern).toBeGreaterThanOrEqual(2)
    expect(score.action).toBe(0)
    expect(score.period).toBe(0)
  })
})
