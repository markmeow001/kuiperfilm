import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HairDesignWorkspace, type HairDesignTranslations } from '@/app/[locale]/visual-development/HairDesignWorkspace'
import { ProductionStageWorkspace, type ProductionStageTranslations } from '@/app/[locale]/visual-development/ProductionStageWorkspace'
import type {
  CastingBatchView,
  CastingCandidateView,
  HairDesignWorkspaceController,
  ProductionStageWorkspaceController,
} from '@/app/[locale]/visual-development/visual-development-types'
import {
  PRODUCTION_FIELD_IDS,
  getProductionStage,
  type ProductionFieldId,
} from '@/lib/visual-development/production-stages'

const candidate: CastingCandidateView = {
  id: 'candidate-1',
  code: 'HAIR-VIEW-FRONT',
  taskStatus: 'completed',
  progress: 100,
  resultUrl: '/asset.jpg',
  requestedSeed: 123,
  seedStatus: 'applied',
  shortlisted: true,
  isCanon: true,
  errorMessage: null,
}

function lockedBatch(stage: string): CastingBatchView {
  return {
    id: `${stage}-batch`,
    stage,
    candidateCount: 1,
    modelKey: 'atlascloud::flux-2-pro',
    provider: 'atlascloud',
    modelId: 'flux-2-pro',
    seedSupported: true,
    aspectRatio: '3:4',
    resolution: null,
    status: 'canon_locked',
    candidates: [candidate],
  }
}

const hairTranslations: HairDesignTranslations = {
  prerequisite: '請先完成 Face Bible',
  prerequisiteHint: '需要 FACE ID',
  identityAuthority: 'IDENTITY',
  designRecord: 'HAIR DESIGN',
  hairSilhouette: '剪影',
  partingAndHairline: '分線',
  lengthAndTexture: '長度',
  storyRequirements: '劇情',
  forbiddenDrift: '禁止漂移',
  modelBinding: '模型',
  modelRequired: '選擇模型',
  modelHint: '模型提示',
  resolution: '尺寸',
  aspectRatio: '畫幅',
  exploreTitle: '探索',
  exploreDescription: '探索說明',
  generateExploration: '生成探索',
  select: '選擇',
  selected: '已選擇',
  validationTitle: '驗證',
  validationDescription: '驗證說明',
  generateValidation: '生成驗證',
  waiting: '等待',
  approve: '通過',
  approved: '已通過',
  reject: '退回',
  rejectionPrompt: '退回原因',
  lock: '鎖定 Hair Canon',
  locked: 'Hair Canon 已鎖定',
  lockHint: '通過後鎖定',
  nextPhase: '進入下一階段',
  generating: '生成中',
  seedUnsupported: 'SEED N/A',
}

function hairController(): HairDesignWorkspaceController {
  return {
    explorationBatch: lockedBatch('hair-exploration'),
    validationBatch: lockedBatch('hair-validation'),
    identityCandidate: candidate,
    selectedHairCandidate: candidate,
    characterCode: 'CHR-001',
    characterStatus: 'hair_locked',
    form: {
      hairSilhouette: 'readable silhouette',
      partingAndHairline: 'natural hairline',
      lengthAndTexture: 'natural texture',
      storyRequirements: 'supports story states',
      forbiddenDrift: 'do not change identity',
      modelKey: 'atlascloud::flux-2-pro',
      resolution: '',
      aspectRatio: '3:4',
    },
    imageModels: [],
    isGenerating: false,
    isLoading: false,
    onFieldChange: vi.fn(),
    onGenerateExploration: vi.fn(),
    onSelectDirection: vi.fn(),
    onGenerateValidation: vi.fn(),
    onReviewValidation: vi.fn(),
    onLock: vi.fn(),
  }
}

const productionFields = Object.fromEntries(
  PRODUCTION_FIELD_IDS.map((field) => [field, field]),
) as Record<ProductionFieldId, string>

const productionTranslations: ProductionStageTranslations = {
  prerequisite: '上一階段未鎖定',
  prerequisiteHint: '請先完成上一階段',
  designRecord: '設計紀錄',
  briefTitle: '劇本設計基準',
  briefDescription: '由劇本與 Canon 自動建立',
  briefModel: '分析模型',
  briefCreate: '建立基準',
  briefCreating: '建立中',
  briefRequired: '請先建立基準',
  briefImmutable: '唯讀',
  briefEvidence: '劇本依據',
  briefConstraints: '不可違反',
  creativePromptTitle: '導演調整提示詞',
  creativePromptDescription: '只調整本輪方向',
  creativePromptPlaceholder: '輸入調整',
  resetPrompt: '清空調整',
  modelBinding: '模型',
  imageModelRequired: '選擇生圖模型',
  videoModelRequired: '選擇影片模型',
  modelHint: '模型提示',
  resolution: '尺寸',
  aspectRatio: '畫幅',
  duration: '秒數',
  generate: '生成',
  generating: '生成中',
  outputs: '資產審核',
  outputsDescription: '逐張審核',
  waiting: '等待',
  approve: '通過',
  approved: '已通過',
  reject: '退回',
  rejectionPrompt: '退回原因',
  primary: '主資產',
  makePrimary: '設為主資產',
  seedUnsupported: 'SEED N/A',
  lock: '鎖定本階段 Canon',
  locked: '本階段 Canon 已鎖定',
  lockHint: '完成後鎖定',
  nextPhase: '進入下一階段',
  complete: '角色開發流程已完成',
  fields: productionFields,
}

function productionController(stageId: 'costume' | 'video'): ProductionStageWorkspaceController {
  const stage = getProductionStage(stageId)
  return {
    stage,
    stageBrief: {
      version: 1,
      stageId,
      characterCode: 'CHR-001',
      modelKey: 'openrouter::gemini',
      createdAt: '2026-07-30T00:00:00.000Z',
      sourceAnalysisId: 'analysis-1',
      summary: '從劇本建立的階段基準',
      fields: Object.fromEntries(stage.fields.map((field) => [field, productionFields[field]])),
      evidence: ['劇本證據'],
      constraints: ['不可改變角色身分'],
    },
    stageBriefTaskStatus: 'completed',
    stageBriefError: null,
    analysisModel: 'Gemini',
    batch: lockedBatch(stage.dbStage),
    characterStatus: stage.lockedStatus,
    prerequisiteReady: true,
    form: {
      stageRecord: productionFields,
      creativePrompt: '',
      modelKey: '',
      resolution: '',
      aspectRatio: '',
      duration: 5,
    },
    models: [],
    isGenerating: false,
    isGeneratingBrief: false,
    isLoading: false,
    onCreateStageBrief: vi.fn(),
    onCreativePromptChange: vi.fn(),
    onResetCreativePrompt: vi.fn(),
    onSettingChange: vi.fn(),
    onGenerate: vi.fn(),
    onReview: vi.fn(),
    onSelectPrimary: vi.fn(),
    onLock: vi.fn(),
  }
}

describe('visual development locked-stage navigation', () => {
  it('requires a screenplay-derived baseline before enabling the editable director prompt', () => {
    const controller = productionController('costume')
    controller.stageBrief = null
    controller.stageBriefTaskStatus = null
    controller.batch = null
    controller.characterStatus = 'hair_locked'
    controller.form.creativePrompt = ''

    render(
      <ProductionStageWorkspace
        controller={controller}
        nextStage={{ code: '05', shortTitle: '配件道具' }}
        onAdvance={vi.fn()}
        translations={productionTranslations}
      />,
    )

    const create = screen.getByRole('button', { name: '建立基準' })
    expect(create).toBeEnabled()
    fireEvent.click(create)
    expect(controller.onCreateStageBrief).toHaveBeenCalledTimes(1)
    expect(screen.getByPlaceholderText('請先建立基準')).toBeDisabled()
  })

  it('shows the immutable baseline separately from the editable director adjustment', () => {
    const controller = productionController('costume')
    controller.form.creativePrompt = '減少裝飾'

    render(
      <ProductionStageWorkspace
        controller={controller}
        nextStage={{ code: '05', shortTitle: '配件道具' }}
        onAdvance={vi.fn()}
        translations={productionTranslations}
      />,
    )

    expect(screen.getByText('從劇本建立的階段基準')).toBeInTheDocument()
    expect(screen.getByText('劇本證據')).toBeInTheDocument()
    const prompt = screen.getByPlaceholderText('輸入調整')
    expect(prompt).toHaveValue('減少裝飾')
    fireEvent.change(prompt, { target: { value: '保留磨損、縮短外套' } })
    expect(controller.onCreativePromptChange).toHaveBeenCalledWith('保留磨損、縮短外套')
    fireEvent.click(screen.getByRole('button', { name: '清空調整' }))
    expect(controller.onResetCreativePrompt).toHaveBeenCalledTimes(1)
  })

  it('replaces the locked Hair Canon button with an enabled Phase 4 action', () => {
    const onAdvance = vi.fn()
    render(
      <HairDesignWorkspace
        controller={hairController()}
        nextStage={{ code: '04', shortTitle: '服裝' }}
        onAdvance={onAdvance}
        translations={hairTranslations}
      />,
    )

    const next = screen.getByRole('button', { name: '進入下一階段 · 04 服裝' })
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('offers the next production phase after a Canon is locked', () => {
    const onAdvance = vi.fn()
    render(
      <ProductionStageWorkspace
        controller={productionController('costume')}
        nextStage={{ code: '05', shortTitle: '配件道具' }}
        onAdvance={onAdvance}
        translations={productionTranslations}
      />,
    )

    const next = screen.getByRole('button', { name: '進入下一階段 · 05 配件道具' })
    expect(next).toBeEnabled()
    fireEvent.click(next)
    expect(onAdvance).toHaveBeenCalledTimes(1)
  })

  it('shows completion instead of a disabled next button after Phase 13', () => {
    render(
      <ProductionStageWorkspace
        controller={productionController('video')}
        nextStage={null}
        onAdvance={vi.fn()}
        translations={productionTranslations}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('角色開發流程已完成')
    expect(screen.queryByRole('button', { name: /進入下一階段/ })).not.toBeInTheDocument()
  })
})
