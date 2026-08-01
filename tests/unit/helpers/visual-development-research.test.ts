import { describe, expect, it } from 'vitest'
import {
  EMPTY_RESEARCH,
  RESEARCH_REFERENCE_CATEGORIES,
  approvedResearchReferenceKeys,
  evaluateResearchGate,
  type ResearchDocument,
  type ResearchReference,
} from '@/lib/visual-development/research'

function reference(overrides: Partial<ResearchReference>): ResearchReference {
  return {
    id: 'ref-1',
    key: 'images/ref-1.png',
    name: 'Reference',
    category: 'casting-face',
    usage: 'use',
    note: 'Adopt the grounded facial proportions.',
    sourceUrl: 'https://example.com/reference',
    creator: 'Archive',
    license: 'Internal research only',
    rightsStatus: 'editorial-reference',
    externalProcessingAllowed: false,
    downstreamEnabled: false,
    reviewStatus: 'approved',
    rejectionNote: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  }
}

function completeResearch(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    ...EMPTY_RESEARCH,
    designQuestion: 'How can sacred order conceal an industrial extraction system?',
    visualHypothesis: 'Warm ritual surfaces conceal cold biological infrastructure.',
    eraAndCulture: 'Post-collapse subterranean civic religion.',
    materialReality: 'Aged brass, yellowed lace, oxidized steel, damp membranes.',
    cinematicLanguage: 'Restrained lenses, motivated practical light, deep blacks.',
    culturalBoundaries: 'No direct use of living religious symbols.',
    assumptionsAndUnknowns: 'The precise period of surviving mechanical craft remains open.',
    sourcePolicy: 'Trace every adopted image and use it for internal design research only.',
    references: [
      reference({ id: 'face', key: 'images/face.png', category: 'casting-face' }),
      reference({ id: 'costume', key: 'images/costume.png', category: 'costume-material' }),
      reference({ id: 'film', key: 'images/film.png', category: 'film-color' }),
      reference({ id: 'culture', key: 'images/culture.png', category: 'culture-symbol' }),
    ],
    ...overrides,
  }
}

describe('visual development research gate', () => {
  it('四類可追溯採用證據皆通過 -> Research Gate 可鎖定', () => {
    const gate = evaluateResearchGate(completeResearch())

    expect(gate).toEqual({
      ready: true,
      missingFields: [],
      missingCategories: [],
      pendingReferenceIds: [],
      untraceableReferenceIds: [],
      blockedExternalReferenceIds: [],
      excessDownstreamReferenceIds: [],
      missingConstraintNoteReferenceIds: [],
    })
  })

  it('文化證據僅標為排除 -> 採用證據類別仍視為缺少', () => {
    const document = completeResearch({
      references: completeResearch().references.map((item) => (
        item.category === 'culture-symbol' ? { ...item, usage: 'avoid' } : item
      )),
    })

    expect(evaluateResearchGate(document).missingCategories).toEqual(['culture-symbol'])
  })

  it('採用素材來源未知 -> 回報不可追溯且不得鎖定', () => {
    const document = completeResearch({
      references: completeResearch().references.map((item) => (
        item.id === 'film' ? { ...item, rightsStatus: 'unknown', creator: '', sourceUrl: '' } : item
      )),
    })
    const gate = evaluateResearchGate(document)

    expect(gate.ready).toBe(false)
    expect(gate.untraceableReferenceIds).toEqual(['film'])
  })

  it('非 HTTP 來源字串 -> 不得被視為可追溯證據', () => {
    const document = completeResearch({
      references: completeResearch().references.map((item) => (
        item.id === 'culture' ? { ...item, sourceUrl: 'source unknown' } : item
      )),
    })

    expect(evaluateResearchGate(document).untraceableReferenceIds).toEqual(['culture'])
  })

  it('Research Canon 未鎖定 -> 不向 Phase 00 輸出參考圖', () => {
    expect(approvedResearchReferenceKeys(completeResearch())).toEqual([])
    expect(approvedResearchReferenceKeys(completeResearch({
      status: 'locked',
      references: completeResearch().references.map((item) => ({
        ...item,
        rightsStatus: 'owned',
        externalProcessingAllowed: true,
        downstreamEnabled: true,
      })),
    }))).toEqual([
      'images/face.png',
      'images/costume.png',
      'images/film.png',
      'images/culture.png',
    ])
  })

  it('內部研究素材已通過 -> 不向外部模型傳送圖片但仍可鎖定 Canon', () => {
    const document = completeResearch()

    expect(evaluateResearchGate(document).ready).toBe(true)
    expect(approvedResearchReferenceKeys({ ...document, status: 'locked' })).toEqual([])
  })

  it('超過十二張外部下游參考 -> Gate 阻擋且保留可解除的素材編號', () => {
    const references = Array.from({ length: 13 }, (_, index) => reference({
      id: `ref-${index + 1}`,
      key: `images/ref-${index + 1}.png`,
      category: RESEARCH_REFERENCE_CATEGORIES[index % RESEARCH_REFERENCE_CATEGORIES.length],
      rightsStatus: 'owned',
      externalProcessingAllowed: true,
      downstreamEnabled: true,
    }))
    const gate = evaluateResearchGate(completeResearch({ references }))

    expect(gate.ready).toBe(false)
    expect(gate.excessDownstreamReferenceIds).toEqual(['ref-13'])
  })

  it('內部研究授權素材被標記為下游圖片 -> Gate 阻擋外送', () => {
    const document = completeResearch({
      references: completeResearch().references.map((item) => (
        item.id === 'face' ? { ...item, downstreamEnabled: true } : item
      )),
    })

    expect(evaluateResearchGate(document).blockedExternalReferenceIds).toEqual(['face'])
  })

  it('排除素材缺少可執行文字原則 -> Gate 不得鎖定', () => {
    const document = completeResearch({
      references: [...completeResearch().references, reference({ id: 'avoid-1', usage: 'avoid', note: '' })],
    })

    expect(evaluateResearchGate(document).missingConstraintNoteReferenceIds).toEqual(['avoid-1'])
  })
})
