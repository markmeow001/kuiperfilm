import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

const pickerSource = read(
  'src/app/[locale]/v2/workspace/[projectId]/storyboard/GroupSceneAddPickerModal.tsx',
)
const viewsSource = read(
  'src/app/[locale]/v2/workspace/[projectId]/subjects/V2LocationViewsPanel.tsx',
)
const jobCardSource = read('src/components/v2/JobCard.tsx')

describe('V2 core chrome i18n source contract', () => {
  it('[V2 picker and location views] -> user-facing chrome comes from locale catalogs', () => {
    expect(pickerSource).toContain("useTranslations('v2Storyboard.groupScenePicker')")
    expect(viewsSource).toContain("useTranslations('v2Subjects.locationViews')")

    for (const retiredLiteral of [
      '加场景',
      '搜索场景',
      '没有匹配的场景',
      '圖片預覽：',
      '繼承主視角描述',
      '建立並生圖',
    ]) {
      expect(`${pickerSource}\n${viewsSource}`).not.toContain(retiredLiteral)
    }
  })

  it('[shared JobCard] -> locale context resolves all defaults without embedded Chinese copy', () => {
    expect(jobCardSource).toContain("useTranslations('v2Jobs.card')")
    expect(jobCardSource).not.toContain('DEFAULT_LABELS')
    expect(jobCardSource).not.toMatch(/[\u3400-\u9fff]/u)
  })

  it('[interactive controls] -> production focus, touch targets and process cyan are explicit', () => {
    for (const source of [pickerSource, viewsSource]) {
      expect(source).toContain('min-h-11')
      expect(source).toContain('focus-visible:ring-2')
      expect(source).toContain('var(--process-cyan')
    }

    expect(pickerSource).not.toMatch(/(?:emerald|amber|rose|red)-\d/)
    expect(viewsSource).not.toMatch(/(?:emerald|amber|rose)-\d/)
    expect(viewsSource).toContain('border-red-400/30')
  })
})
