import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Phase 11.1 — ProjectSettings 唯讀區塊測試（Q-1 C 合約）
 *
 * 跑：`npx vitest run -c vitest.dom.config.ts tests/unit/components/ProjectSettings.test.tsx`
 *
 * 合約（Q-1 C）：
 *   - 風格 badge 只顯示「自訂 / 未設定」+ 「參考圖：N 張」，不反推 preset 名
 *   - videoRatio / targetDuration / ttsRate 唯讀展示
 *   - 6 個 model（analysis / character / location / storyboard / edit / video），null → fallback
 *   - 「打開項目設定」按鈕 → onOpenSettingsModal callback 被呼叫
 *   - 「點擊到任一集的『配置』階段編輯」hint 存在（key: editStyleHint）
 */

// next-intl mock：回 `${key}:${count}` 讓參考圖張數可斷言
vi.mock('next-intl', () => ({
  useTranslations: (_namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count !== 'undefined') {
      return `${key}:${values.count}`
    }
    return key
  },
}))

// AppIcon mock — 純展示，避免 jsx 噪音
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}))

import ProjectSettings, {
  type ProjectSettingsProps,
  type ProjectSettingsModelsSummary,
  type ProjectStyleProfileSummary,
} from '@/app/[locale]/workspace/[projectId]/components/ProjectSettings'

// Helper：build 預設 props，individual case 只覆蓋差異欄位
function buildProps(overrides: Partial<ProjectSettingsProps> = {}): ProjectSettingsProps {
  const defaultModels: ProjectSettingsModelsSummary = {
    analysis: 'gpt-4o-mini',
    character: 'gemini-2.0-flash',
    location: 'gpt-4o',
    storyboard: 'fal-ai/flux/dev',
    edit: 'fal-ai/nano-banana',
    video: 'fal-ai/seedance',
  }
  const defaultStyle: ProjectStyleProfileSummary = {
    isCustom: false,
    referenceImageCount: 0,
  }
  return {
    videoRatio: '9:16',
    targetDuration: 60,
    ttsRate: '+0%',
    models: defaultModels,
    styleProfileSummary: defaultStyle,
    onOpenSettingsModal: vi.fn(),
    ...overrides,
  }
}

function renderProjectSettings(overrides: Partial<ProjectSettingsProps> = {}) {
  const props = buildProps(overrides)
  render(<ProjectSettings {...props} />)
  return props
}

describe('ProjectSettings (Phase 11.1 / Q-1 C)', () => {
  it('isCustom=false + referenceImageCount=0 -> 顯示「未設定 (noStyleSet)」+「參考圖：0 張」', () => {
    renderProjectSettings({
      styleProfileSummary: { isCustom: false, referenceImageCount: 0 },
    })

    // Q-1 C：未設定走 noStyleSet key
    expect(screen.getByText('noStyleSet')).toBeInTheDocument()
    // mocked t 帶 count → `${key}:${count}` → 「referenceImageCount:0」
    expect(screen.getByText('referenceImageCount:0')).toBeInTheDocument()
    // 不應誤顯示 customStyle（避免反推）
    expect(screen.queryByText('customStyle')).toBeNull()
  })

  it('isCustom=true + referenceImageCount=0 -> 顯示「自訂 (customStyle)」+「參考圖：0 張」', () => {
    renderProjectSettings({
      styleProfileSummary: { isCustom: true, referenceImageCount: 0 },
    })

    expect(screen.getByText('customStyle')).toBeInTheDocument()
    expect(screen.getByText('referenceImageCount:0')).toBeInTheDocument()
    // 不應誤顯示 noStyleSet
    expect(screen.queryByText('noStyleSet')).toBeNull()
  })

  it('isCustom=true + referenceImageCount=3 -> 顯示「自訂」+「參考圖：3 張」', () => {
    renderProjectSettings({
      styleProfileSummary: { isCustom: true, referenceImageCount: 3 },
    })

    expect(screen.getByText('customStyle')).toBeInTheDocument()
    expect(screen.getByText('referenceImageCount:3')).toBeInTheDocument()
  })

  it('videoRatio / targetDuration / ttsRate 唯讀展示對應傳入值', () => {
    renderProjectSettings({
      videoRatio: '16:9',
      targetDuration: 90,
      ttsRate: '+10%',
    })

    expect(screen.getByText('16:9')).toBeInTheDocument()
    // targetDuration 後面附 's'：90 -> "90s"
    expect(screen.getByText('90s')).toBeInTheDocument()
    expect(screen.getByText('+10%')).toBeInTheDocument()
  })

  it('6 個 model 名稱顯示對應 props.models 的值', () => {
    renderProjectSettings({
      models: {
        analysis: 'analysis-model-x',
        character: 'character-model-x',
        location: 'location-model-x',
        storyboard: 'storyboard-model-x',
        edit: 'edit-model-x',
        video: 'video-model-x',
      },
    })

    expect(screen.getByText('analysis-model-x')).toBeInTheDocument()
    expect(screen.getByText('character-model-x')).toBeInTheDocument()
    expect(screen.getByText('location-model-x')).toBeInTheDocument()
    expect(screen.getByText('storyboard-model-x')).toBeInTheDocument()
    expect(screen.getByText('edit-model-x')).toBeInTheDocument()
    expect(screen.getByText('video-model-x')).toBeInTheDocument()
  })

  it('models.analysis=null -> 該 badge 顯示 fallback (common.none)', () => {
    renderProjectSettings({
      models: {
        analysis: null,
        character: 'character-model',
        location: 'location-model',
        storyboard: 'storyboard-model',
        edit: 'edit-model',
        video: 'video-model',
      },
    })

    // analysis null -> 顯示 common.none key（namespace 'common' 但 mock 直接回 key 'none'）
    // 其他 5 個 model 名仍應正常顯示 — none 只應出現一次（analysis 那欄）
    const noneOccurrences = screen.getAllByText('none')
    expect(noneOccurrences).toHaveLength(1)

    // 其他五個 model 仍顯示
    expect(screen.getByText('character-model')).toBeInTheDocument()
    expect(screen.getByText('video-model')).toBeInTheDocument()
  })

  it('點「打開項目設定」按鈕 -> onOpenSettingsModal 被呼叫一次', () => {
    const onOpenSettingsModal = vi.fn()
    renderProjectSettings({ onOpenSettingsModal })

    // 按鈕透過 i18n key 'openSettings' 顯示文字
    const button = screen.getByText('openSettings')
    fireEvent.click(button)

    expect(onOpenSettingsModal).toHaveBeenCalledTimes(1)
  })

  it('「點擊到任一集的配置階段編輯」hint 存在（key: editStyleHint）', () => {
    renderProjectSettings()
    expect(screen.getByText('editStyleHint')).toBeInTheDocument()
  })
})
