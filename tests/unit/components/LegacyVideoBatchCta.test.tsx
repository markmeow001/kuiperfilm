import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import enVideo from '../../../messages/en/video.json'
import VideoToolbar from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/VideoToolbar'

describe('legacy workspace batch video CTA', () => {
  it('is disabled and directs editors to the V2 storyboard instead of discarding a quote', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ video: enVideo }}>
        <VideoToolbar
          totalPanels={2}
          runningCount={0}
          videosWithUrl={0}
          failedCount={0}
          isAnyTaskRunning={false}
          isDownloading={false}
          batchGenerateHref="/en/v2/workspace/project-1/storyboard?episode=episode-1"
          onDownloadAll={vi.fn()}
          onBack={vi.fn()}
        />
      </NextIntlClientProvider>,
    )

    const legacyButton = screen.getByRole('button', { name: 'Generate All Videos' })
    expect(legacyButton).toBeDisabled()
    fireEvent.click(legacyButton)

    expect(screen.getByRole('link', { name: 'Open V2 storyboard' })).toHaveAttribute(
      'href',
      '/en/v2/workspace/project-1/storyboard?episode=episode-1',
    )
    expect(screen.getByText('Batch generation has moved to the V2 storyboard.')).toBeInTheDocument()
  })
})
