import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResearchWorkspace, type ResearchTranslations } from '@/app/[locale]/visual-development/ResearchWorkspace'
import type { ResearchWorkspaceController } from '@/app/[locale]/visual-development/visual-development-types'

const translations: ResearchTranslations = {
  ledger: '研究台帳', ledgerDescription: '研究說明', statusDraft: '草稿', statusLocked: '已鎖定', worldAlreadyLocked: 'World 已鎖定',
  designQuestion: '設計問題', visualHypothesis: '視覺假設', eraAndCulture: '時代文化', materialReality: '材質真實', cinematicLanguage: '電影語言', culturalBoundaries: '文化邊界', assumptionsAndUnknowns: '未知項目', sourcePolicy: '來源政策',
  save: '儲存', saving: '儲存中', intake: '素材登錄', intakeDescription: '逐張登錄', file: '圖片', category: '類別', usage: '用途', use: '採用', avoid: '排除', creator: '作者', sourceUrl: '來源', rightsStatus: '權利', license: '授權', note: '原則', upload: '加入台帳', uploading: '上傳中', fileRequired: '請選圖片',
  externalProcessing: '外部處理', externalProcessingHint: '外部處理說明', downstreamReference: '傳遞至 Phase 00', downstreamReferenceHint: '最多十二張',
  evidence: '證據矩陣', evidenceDescription: '四類證據', emptyEvidence: '尚無證據', approve: '通過', approved: '已通過', reject: '退回', rejected: '已退回', pending: '待審', remove: '移除', rejectionPrompt: '退回原因',
  categories: { 'casting-face': '臉型', 'costume-material': '服裝材質', 'film-color': '電影色彩', 'culture-symbol': '文化符號' },
  rights: { owned: '自有', licensed: '已授權', 'public-domain': '公有領域', 'editorial-reference': '內部研究', unknown: '未知' },
  gateTitle: '研究 Gate', gateDescription: '通過才可鎖定', fieldsComplete: '欄位完成', categoriesComplete: '類別完成', reviewsComplete: '審核完成', provenanceComplete: '來源完成', processingComplete: '外部處理完成', lock: '鎖定 Research Canon', locked: 'Research Canon 已鎖定', version: '版本',
}

function controller(overrides: Partial<ResearchWorkspaceController> = {}): ResearchWorkspaceController {
  return {
    form: {
      designQuestion: 'Question', visualHypothesis: 'Hypothesis', eraAndCulture: 'Culture', materialReality: 'Material', cinematicLanguage: 'Cinema', culturalBoundaries: 'Boundaries', assumptionsAndUnknowns: 'Unknowns', sourcePolicy: 'Policy',
    },
    references: [],
    gate: { ready: false, missingFields: [], missingCategories: ['casting-face'], pendingReferenceIds: [], untraceableReferenceIds: [], blockedExternalReferenceIds: [], excessDownstreamReferenceIds: [], missingConstraintNoteReferenceIds: [] },
    status: 'draft', version: 1, canonId: null, worldStatus: 'draft', isLoading: false, isSaving: false, isUploading: false,
    onFieldChange: vi.fn(), onSave: vi.fn(), onUploadReference: vi.fn(), onRemoveReference: vi.fn(), onReviewReference: vi.fn(), onSetReferenceProcessing: vi.fn(), onLock: vi.fn(), onReload: vi.fn(),
    ...overrides,
  }
}

describe('ResearchWorkspace Canon gate', () => {
  it('四類證據尚未齊備 -> 鎖定按鈕不可用', () => {
    render(<ResearchWorkspace controller={controller()} translations={translations} />)

    expect(screen.getByRole('button', { name: '鎖定 Research Canon' })).toBeDisabled()
    expect(screen.getByText('尚無證據')).toBeInTheDocument()
  })

  it('研究 Gate 完整 -> 可由人工鎖定 Canon', () => {
    const value = controller({
      references: [{ id: 'ref-1', key: 'ref.png', name: 'ref.png', category: 'casting-face', usage: 'use', note: 'Adopt shape', sourceUrl: 'https://example.com/ref', creator: 'Archive', license: 'Internal', rightsStatus: 'editorial-reference', externalProcessingAllowed: false, downstreamEnabled: false, reviewStatus: 'approved', rejectionNote: null, createdAt: '2026-07-31', previewUrl: '/ref.png' }],
      gate: { ready: true, missingFields: [], missingCategories: [], pendingReferenceIds: [], untraceableReferenceIds: [], blockedExternalReferenceIds: [], excessDownstreamReferenceIds: [], missingConstraintNoteReferenceIds: [] },
    })
    render(<ResearchWorkspace controller={value} translations={translations} />)

    const lock = screen.getByRole('button', { name: '鎖定 Research Canon' })
    expect(lock).toBeEnabled()
    fireEvent.click(lock)
    expect(value.onLock).toHaveBeenCalledTimes(1)
  })

  it('World Canon 已先鎖定 -> 研究欄位與素材登錄均停用', () => {
    render(<ResearchWorkspace controller={controller({ worldStatus: 'world_locked' })} translations={translations} />)

    expect(screen.getByText('World 已鎖定')).toBeInTheDocument()
    expect(screen.getByLabelText('設計問題')).toBeDisabled()
    expect(screen.getByRole('button', { name: '加入台帳' })).toBeDisabled()
  })
})
