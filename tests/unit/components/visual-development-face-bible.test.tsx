import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FaceBibleWorkspace } from '@/app/[locale]/visual-development/FaceBibleWorkspace'
import type { FaceBibleWorkspaceController } from '@/app/[locale]/visual-development/visual-development-types'

const translations = {
  canonSource: 'IDENTITY REFERENCE · CANON',
  canonRequired: '請先定角',
  identityRecord: 'FACE LOCK RECORD',
  identityAnchors: '身分錨點（選填）',
  identityAnchorsHint: '留白時會直接使用 Canon 圖',
  allowedVariation: '允許變化',
  forbiddenDrift: '禁止漂移',
  modelBinding: '參考圖生圖模型綁定',
  referenceOnly: 'Canon 圖僅負責角色身分',
  modelRequired: '選擇模型',
  resolution: '尺寸',
  aspectRatio: '畫幅',
  generate: '生成 Face Bible 10 張',
  generating: '送出中…',
  waiting: '等待生成',
  approve: '通過',
  approved: '已通過',
  reject: '退回',
  rejectionPrompt: '退回原因',
  lock: '鎖定 Face Bible',
  locked: 'Face Bible 已鎖定',
  lockHint: '完成後鎖定',
  modelHint: '僅顯示支援參考圖的模型',
  seedUnsupported: 'SEED N/A',
  historyTitle: '生成歷史',
  historyDescription: '切換過去批次',
  historyNewest: '最新',
  nextPhase: '進入下一階段',
}

function controller(): FaceBibleWorkspaceController {
  return {
    regeneratingCandidateIds: [],
    onRegenerateCandidate: vi.fn(),
    batch: null,
    batches: [],
    activeBatchId: '',
    onSelectBatch: vi.fn(),
    canonCandidate: {
      id: 'canon-1',
      code: 'C-01',
      taskStatus: 'completed',
      progress: 100,
      resultUrl: '/canon.jpg',
      requestedSeed: 123,
      seedStatus: 'applied',
      shortlisted: true,
      isCanon: true,
      errorMessage: null,
    },
    characterCode: 'CHR-SNO',
    characterStatus: 'casting_locked',
    form: {
      identityAnchors: '',
      allowedVariation: 'camera angle only',
      forbiddenDrift: '',
      modelKey: 'atlascloud::flux-2-pro',
      resolution: '',
      aspectRatio: '9:16',
    },
    imageModels: [{
      value: 'atlascloud::flux-2-pro',
      label: 'FLUX.2 Pro',
      provider: 'atlascloud',
      providerName: 'AtlasCloud',
      capabilities: { image: { supportReferenceImage: true, aspectRatioOptions: ['9:16'] } },
    }],
    isGenerating: false,
    isLoading: false,
    onFieldChange: vi.fn(),
    onGenerate: vi.fn(),
    onReview: vi.fn(),
    onLock: vi.fn(),
  }
}

describe('FaceBibleWorkspace generation readiness', () => {
  it('allows generation with blank optional text anchors when Canon, model, and ratio are ready', () => {
    const value = controller()
    render(<FaceBibleWorkspace controller={value} translations={translations} />)

    expect(screen.getByText('留白時會直接使用 Canon 圖')).toBeInTheDocument()
    const generate = screen.getByRole('button', { name: '生成 Face Bible 10 張' })
    expect(generate).toBeEnabled()
    fireEvent.click(generate)
    expect(value.onGenerate).toHaveBeenCalledTimes(1)
  })

  it('offers Phase 03 navigation when any Face Bible batch is Canon locked', () => {
    const value = controller()
    const lockedBatch = {
      id: 'face-locked',
      stage: 'face-lock',
      candidateCount: 1,
      modelKey: 'atlascloud::flux-2-pro',
      provider: 'atlascloud',
      modelId: 'flux-2-pro',
      seedSupported: true,
      aspectRatio: '9:16',
      resolution: null,
      status: 'canon_locked',
      candidates: [],
    }
    value.batch = lockedBatch
    value.batches = [lockedBatch]
    value.activeBatchId = lockedBatch.id
    const onAdvance = vi.fn()

    render(
      <FaceBibleWorkspace
        controller={value}
        translations={translations}
        nextStage={{ code: '03', shortTitle: '髮型' }}
        onAdvance={onAdvance}
      />,
    )

    const next = screen.getByRole('button', { name: '進入下一階段 · 03 髮型' })
    fireEvent.click(next)
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '生成 Face Bible 10 張' })).toBeDisabled()
    const identityField = screen.getByText('身分錨點（選填）').closest('label')?.querySelector('textarea')
    expect(identityField).toBeDisabled()
    expect(screen.getAllByRole('combobox')[0]).toBeDisabled()
  })
})
