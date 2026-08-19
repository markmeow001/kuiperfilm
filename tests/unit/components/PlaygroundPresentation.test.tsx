import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import enPlayground from '../../../messages/en/playground.json'
import zhPlayground from '../../../messages/zh/playground.json'
import { ReconstructionBriefForm } from '@/app/[locale]/playground/ReconstructionBriefForm'
import { ReconstructionPromptReview } from '@/app/[locale]/playground/ReconstructionGenerationControls'
import { ReconstructionResultStage } from '@/app/[locale]/playground/ReconstructionResultStage'
import type { ReconstructionCreativeBrief } from '@/lib/playground/reconstruction-contract'

const brief: ReconstructionCreativeBrief = {
  era: '',
  location: '',
  story: '',
  characterDesign: '',
  wardrobe: '',
  mood: '',
  weatherAndTime: '',
  backgroundMotion: '',
  replacePeople: true,
}

function renderBrief(locale: 'zh' | 'en') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ playground: locale === 'zh' ? zhPlayground : enPlayground }}
    >
      <ReconstructionBriefForm
        brief={brief}
        onBriefChange={vi.fn()}
        dialogue={[]}
        onAddDialogue={vi.fn()}
        onUpdateDialogue={vi.fn()}
        onRemoveDialogue={vi.fn()}
        audioMode="generate"
        onAudioModeChange={vi.fn()}
        hasAudio={false}
      />
    </NextIntlClientProvider>,
  )
}

describe('Playground presentation components', () => {
  it('[英文] -> reconstruction brief renders localized labels without Chinese fallback', () => {
    const { container } = renderBrief('en')

    expect(screen.getByRole('heading', { name: 'Rebuild settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add dialogue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate audio with the model' })).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/重建設定|新增對白|讓模型生成聲音/)
    expect(container.querySelector('[data-playground-touch-surface]')).toBeInTheDocument()
  })

  it('[繁中] -> prompt review exposes state semantics and stays inside the touch surface', () => {
    render(
      <NextIntlClientProvider locale="zh" messages={{ playground: zhPlayground }}>
        <ReconstructionPromptReview
          prompt="人物沿著街道前進"
          isStale
          isBusy={false}
          isGenerating={false}
          onBuild={vi.fn()}
          onPromptChange={vi.fn()}
          onGenerate={vi.fn()}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('heading', { name: '生成前檢查描述詞' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('設定已變更')
    expect(screen.getByRole('button', { name: '確認描述詞並生成影片' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '確認描述詞並生成影片' }))
      .toHaveClass('min-h-11')
  })

  it('[英文] -> reconstruction result stage has no Traditional Chinese fallback', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ playground: enPlayground }}>
        <ReconstructionResultStage
          locale="en"
          sourceVideoUrl={null}
          sourceDurationSec={null}
          sourceWidth={null}
          sourceHeight={null}
          generatedRun={null}
          generatedUrl={null}
          characterReferenceUrl={null}
          sceneReferenceUrl={null}
        />
      </NextIntlClientProvider>,
    )

    expect(screen.getByText('Source performance reference')).toBeInTheDocument()
    expect(screen.getByText('Rebuild result')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/原始表演參考|重建結果|上傳新角色/)
  })
})
