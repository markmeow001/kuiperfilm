import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CANON_RATIONALE_MAX_LENGTH,
  CANDIDATE_RATIONALE_MAX_LENGTH,
  CastingScorecard,
} from '@/app/[locale]/visual-development/CastingScorecard'

const translations = {
  title: '選角評分表',
  description: '比較候選並保存理由',
  candidate: '候選',
  average: '平均',
  rationale: '理由',
  rationalePlaceholder: '寫下理由',
  canonRationale: '最終定角理由',
  canonRationalePlaceholder: '寫下定角理由',
  metrics: {
    memorability: '記憶點',
    storyPresence: '故事感',
    roleFit: '角色適配',
    performanceRange: '表演潛力',
    angleStability: '多角度',
    ageCredibility: '年齡可信',
    photorealism: '真人感',
  },
}

const candidate = {
  id: 'candidate-1',
  code: 'C-01',
  taskStatus: 'completed',
  progress: 100,
  resultUrl: '/candidate.jpg',
  requestedSeed: 123,
  seedStatus: 'applied',
  shortlisted: true,
  isCanon: false,
  errorMessage: null,
}

describe('CastingScorecard', () => {
  it('預設收合，展開後能把候選評分與理由序列化保存', () => {
    const onScorecardChange = vi.fn()
    const onCanonRationaleChange = vi.fn()
    render(
      <CastingScorecard
        candidates={[candidate]}
        serializedScorecard=""
        canonRationale=""
        disabled={false}
        translations={translations}
        onScorecardChange={onScorecardChange}
        onCanonRationaleChange={onCanonRationaleChange}
      />,
    )

    const summary = screen.getByText('選角評分表')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')

    fireEvent.click(summary)
    expect(screen.getByLabelText('C-01 理由')).toHaveAttribute('maxlength', String(CANDIDATE_RATIONALE_MAX_LENGTH))
    expect(screen.getByLabelText('最終定角理由')).toHaveAttribute('maxlength', String(CANON_RATIONALE_MAX_LENGTH))
    fireEvent.change(screen.getByLabelText('C-01 記憶點'), { target: { value: '5' } })
    expect(JSON.parse(onScorecardChange.mock.calls[0][0])).toEqual({
      'candidate-1': { memorability: 5 },
    })

    fireEvent.change(screen.getByLabelText('最終定角理由'), { target: { value: '近景表演最可信' } })
    expect(onCanonRationaleChange).toHaveBeenCalledWith('近景表演最可信')
  })

  it('Canon 鎖定後評分表維持可讀但不可改寫', () => {
    render(
      <CastingScorecard
        candidates={[candidate]}
        serializedScorecard={JSON.stringify({ 'candidate-1': { memorability: 4, rationale: '有記憶點' } })}
        canonRationale="能承載角色矛盾"
        disabled
        translations={translations}
        onScorecardChange={vi.fn()}
        onCanonRationaleChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('選角評分表'))
    expect(screen.getByLabelText('C-01 記憶點')).toBeDisabled()
    expect(screen.getByLabelText('C-01 理由')).toHaveValue('有記憶點')
    expect(screen.getByLabelText('最終定角理由')).toHaveValue('能承載角色矛盾')
  })
})
