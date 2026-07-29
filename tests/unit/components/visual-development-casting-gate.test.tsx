import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CastingWorkspace } from '@/app/[locale]/visual-development/CastingWorkspace'
import type { CastingWorkspaceController } from '@/app/[locale]/visual-development/visual-development-types'

const translations = {
  batch: 'Casting',
  model: '模型',
  notConnected: '尚未連接',
  count: 'OUTPUT',
  ratio: '比例',
  generate: '生成 8 張',
  waiting: '等待生成',
  seedPending: 'SEED —',
  seedUnsupported: 'SEED 不支援',
  seedApplied: 'SEED 支援',
  candidate: '候選人',
  projectSetup: '角色設定',
  worldPremise: '世界前提',
  visualThesis: '視覺命題',
  characterName: '角色名稱',
  characterCode: '角色代碼',
  characterRole: '角色定位',
  coreTraits: '核心性格',
  apparentAge: '角色銀幕年齡',
  performerAge: '成年演員年齡',
  ethnicity: '族裔',
  faceStructure: '臉部骨相',
  emotionalRead: '第一眼情緒',
  lifeHistory: '生命經歷',
  resolution: '模型預設尺寸',
  modelBinding: '生圖模型綁定',
  historyTitle: '此角色的選角歷史',
  historyDescription: '切換批次只會查看舊結果',
  historyNewest: '最新',
  historyBatch: '批次 {number}',
  historyImages: '{count} 張',
  generateHint: '生成說明',
  shortlist: '短名單',
  canonLock: '定角',
  canonLocked: '已定角',
  generating: '送出中…',
  worldRequired: '請先到 Phase 00 完成並鎖定 World Canon',
  worldLocked: 'World Canon 已載入',
  completeWorld: '完成 Phase 00',
}

function controller(overrides: Partial<CastingWorkspaceController> = {}): CastingWorkspaceController {
  return {
    batch: null,
    batches: [],
    activeBatchId: '',
    form: {
      worldBible: { projectPremise: '世界', visualThesis: '命題' },
      characterDna: { role: '主角', coreTraits: '堅定' },
      castingBrief: { apparentAge: '18', performerAge: '21+', emotionalRead: '警覺' },
      characterCode: 'CHAR-001',
      characterName: '絲諾',
      modelKey: 'atlascloud::flux-2-pro',
      resolution: '',
      aspectRatio: '3:4',
    },
    worldStatus: 'world_draft',
    imageModels: [{
      value: 'atlascloud::flux-2-pro',
      label: 'FLUX.2 Pro',
      provider: 'atlascloud',
      providerName: 'AtlasCloud',
      capabilities: { image: { supportSeed: false, resolutionOptions: [], aspectRatioOptions: ['3:4', '2:3'] } },
    }],
    isGenerating: false,
    isLoading: false,
    onFieldChange: vi.fn(),
    onIdentityChange: vi.fn(),
    onOpenWorldBible: vi.fn(),
    onGenerate: vi.fn(),
    onSelectBatch: vi.fn(),
    onCandidateAction: vi.fn(),
    ...overrides,
  }
}

describe('CastingWorkspace World Canon gate', () => {
  it('World Canon 未鎖定 -> 顯示可操作的 Phase 00 導引，不呈現無說明的灰色生成鍵', () => {
    const value = controller()
    render(<CastingWorkspace candidateCount={8} controller={value} onCandidateCountChange={vi.fn()} translations={translations} />)

    const action = screen.getByRole('button', { name: '完成 Phase 00' })
    expect(action).toBeEnabled()
    expect(screen.queryByRole('button', { name: '生成 8 張' })).not.toBeInTheDocument()
    fireEvent.click(action)
    expect(value.onOpenWorldBible).toHaveBeenCalledTimes(1)
  })

  it('World Canon 已鎖定 -> 恢復模型批次生成操作', () => {
    const value = controller({ worldStatus: 'world_locked' })
    render(<CastingWorkspace candidateCount={8} controller={value} onCandidateCountChange={vi.fn()} translations={translations} />)

    expect(screen.getByLabelText('角色銀幕年齡')).toHaveValue('18')
    expect(screen.getByLabelText('成年演員年齡')).toHaveValue('21+')
    expect(screen.getByRole('option', { name: '3:4' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成 8 張' }))
    expect(value.onGenerate).toHaveBeenCalledTimes(1)
  })

  it('同一角色有多次選角生成 -> 顯示完整批次歷史並可切回舊結果', () => {
    const oldBatch = {
      id: 'batch-old',
      stage: 'casting',
      createdAt: '2026-07-29T20:00:00.000Z',
      candidateCount: 4,
      modelKey: 'atlascloud::flux-2-pro',
      provider: 'atlascloud',
      modelId: 'flux-2-pro',
      seedSupported: true,
      aspectRatio: '3:4',
      resolution: null,
      status: 'completed',
      candidates: [],
    }
    const newestBatch = {
      ...oldBatch,
      id: 'batch-new',
      createdAt: '2026-07-29T21:00:00.000Z',
      candidateCount: 8,
      aspectRatio: '4:3',
    }
    const onSelectBatch = vi.fn()
    const value = controller({
      worldStatus: 'world_locked',
      batch: newestBatch,
      batches: [newestBatch, oldBatch],
      activeBatchId: newestBatch.id,
      onSelectBatch,
    })

    render(<CastingWorkspace candidateCount={8} controller={value} onCandidateCountChange={vi.fn()} translations={translations} />)

    expect(screen.getByText('此角色的選角歷史')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /批次 02[\s\S]*8 張[\s\S]*4:3/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /批次 01[\s\S]*4 張[\s\S]*3:4/ }))
    expect(onSelectBatch).toHaveBeenCalledWith('batch-old')
  })
})
