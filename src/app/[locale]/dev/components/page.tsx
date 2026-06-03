/**
 * Phase 0 redesign — Component Library v2 preview.
 *
 * Route: /[locale]/dev/components
 *
 * Internal dev-only catalog of v2 design system primitives. Used to:
 *   - validate tokens-v2.css end-to-end (color, radius, spacing, motion)
 *   - eyeball Button v2 variants × sizes × states grid
 *   - inspect the §3.2 surface scale (canvas / raised / overlay)
 *   - confirm WCAG contrast of text-primary/secondary/tertiary on each
 *
 * This page never ships to public traffic — Next.js doesn't block it,
 * but it's not linked from any nav. Internal users browse directly.
 *
 * Future tasks (Phase 0 remaining): add Input, Field, Card, Modal,
 * Inspector, EmptyState, GenerationProgress, MediaReveal. Each new
 * component appends a section here.
 */

import { Button } from '@/components/v2/Button'

export default function ComponentsPreview() {
  return (
    <main className="min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <header className="mb-10 border-b border-border-soft pb-6">
          <h1 className="font-medium text-[36px] leading-[1.1] tracking-[-0.02em]">
            Component Library v2
          </h1>
          <p className="mt-2 text-[14px] text-text-secondary">
            Phase 0 redesign · tokens-v2.css validation surface
          </p>
        </header>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Surface scale</h2>
          <p className="mb-4 text-[13px] text-text-tertiary">
            §3.2 — a view may use ≤3 neutrals: canvas, raised, overlay.
            More = visual debt.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-card border border-border-soft bg-canvas p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-canvas
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #0A0A0A
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-raised p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-raised
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #171717
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-overlay p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-overlay
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #1F1F1F
              </div>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Text scale</h2>
          <div className="space-y-3 rounded-card border border-border-soft bg-raised p-6">
            <div className="text-text-primary text-[14px]">
              text-primary — 主要文字 18.7:1 contrast on canvas
            </div>
            <div className="text-text-secondary text-[14px]">
              text-secondary — 次要文字 7.2:1 contrast on canvas
            </div>
            <div className="text-text-tertiary text-[14px]">
              text-tertiary — 三級文字 4.6:1 AA large only
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Button v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            4 variants × 3 sizes × 5 states (idle / hover / pressed /
            focus-visible / disabled / loading)
          </p>

          <ButtonGrid label="primary" variant="primary" />
          <ButtonGrid label="secondary" variant="secondary" />
          <ButtonGrid label="ghost" variant="ghost" />
          <ButtonGrid label="danger" variant="danger" />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Radius scale</h2>
          <div className="flex flex-wrap items-end gap-4">
            <RadiusSwatch label="chip" cls="rounded-chip" px="4" />
            <RadiusSwatch label="input" cls="rounded-input" px="8" />
            <RadiusSwatch label="card" cls="rounded-card" px="12" />
            <RadiusSwatch label="modal" cls="rounded-modal" px="16" />
            <RadiusSwatch label="hero" cls="rounded-hero" px="24" />
            <RadiusSwatch label="pill" cls="rounded-pill" px="9999" />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Elevation scale</h2>
          <p className="mb-4 text-[13px] text-text-tertiary">
            §3.5 — dark mode lifts via surface + soft inset border, not
            drop shadow.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-card border border-border-soft bg-raised p-6 shadow-elev-1">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                elev-1
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-raised p-6 shadow-elev-2">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                elev-2
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-raised p-6 shadow-elev-3">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                elev-3
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function ButtonGrid({
  label,
  variant,
}: {
  label: string
  variant: 'primary' | 'secondary' | 'ghost' | 'danger'
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={variant} size="sm">Small</Button>
        <Button variant={variant} size="md">Medium</Button>
        <Button variant={variant} size="lg">Large</Button>
        <Button variant={variant} size="md" disabled>Disabled</Button>
        <Button variant={variant} size="md" loading>Loading</Button>
      </div>
    </div>
  )
}

function RadiusSwatch({ label, cls, px }: { label: string; cls: string; px: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`h-16 w-16 border border-border-soft bg-raised ${cls}`}
      />
      <div className="text-center font-mono text-[11px] text-text-tertiary">
        {label}
        <br />
        <span className="text-text-secondary">{px}px</span>
      </div>
    </div>
  )
}
