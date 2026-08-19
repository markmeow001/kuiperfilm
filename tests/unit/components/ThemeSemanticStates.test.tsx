import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill } from '@/components/v2/StatusPill'

describe('unified dark studio semantic states', () => {
  it('reserves editorial gold for approval without replacing success or warning', () => {
    const { rerender } = render(
      <StatusPill tone="approval" label="已核准" />,
    )

    expect(screen.getByText('已核准').parentElement?.className).toContain(
      'production-gold',
    )

    rerender(<StatusPill tone="success" label="已完成" />)
    expect(screen.getByText('已完成').parentElement?.className).not.toContain(
      'production-gold',
    )

    rerender(<StatusPill tone="warning" label="需要處理" />)
    expect(screen.getByText('需要處理').parentElement?.className).not.toContain(
      'production-gold',
    )
  })

  it('keeps the studio upload fallback on readable production colours', () => {
    const source = readFileSync(
      'src/app/[locale]/v2/workspace/[projectId]/script/BulkEpisodeUploadButton.tsx',
      'utf8',
    )

    expect(source).toContain("tone === 'studio'")
    expect(source).toContain("? 'kuiper-dashboard-secondary")
    expect(source).toContain('text-[var(--production-ink-muted)]')
    expect(source).not.toContain('<span className="text-amber-300">單一集</span>')
  })

  it('keeps shared controls and production handoff states on the dark studio contract', () => {
    const preview = readFileSync(
      'src/app/[locale]/dev/components/ProductionContractPreview.tsx',
      'utf8',
    )
    const button = readFileSync('src/components/v2/Button.tsx', 'utf8')
    const input = readFileSync('src/components/v2/Input.tsx', 'utf8')
    const stickyNextStep = readFileSync(
      'src/components/v2/StickyNextStep.tsx',
      'utf8',
    )

    expect(preview).toContain('onSelect={setCurrentStep} tone="dark"')
    expect(button).toContain('bg-[var(--production-blue)] text-white')
    expect(button).toContain('ring-[rgba(85,175,192,0.55)]')
    expect(input).toContain('focus-within:border-[var(--process-cyan)]')
    expect(button).not.toContain('focus-visible:ring-accent-500')
    expect(input).not.toContain('focus-within:border-accent-500')
    expect(stickyNextStep).toContain('bg-emerald-400/10 text-emerald-200')
    expect(stickyNextStep).not.toContain('bg-[#eef8f2]')
  })
})
