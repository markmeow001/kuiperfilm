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
import { Input } from '@/components/v2/Input'
import { Card } from '@/components/v2/Card'

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

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Input v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            3 sizes × 5 states (idle / hover / focus / error / disabled).
            Container owns border + ring + bg; input itself is
            transparent so focus ring lives on a single layer.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <Input size="sm" label="Small" placeholder="Type something…" />
              <Input size="md" label="Medium" placeholder="Type something…" />
              <Input size="lg" label="Large" placeholder="Type something…" />
              <Input size="md" label="Disabled" placeholder="Cannot edit" disabled />
            </div>

            <div className="space-y-4">
              <Input
                size="md"
                label="With error"
                defaultValue="invalid value"
                error="此欄位必填且不可包含空白"
              />
              <Input
                size="md"
                label="With helper"
                placeholder="ep01_final.mp4"
                helper="檔名為自動生成，可手動覆蓋"
              />
              <Input
                size="md"
                label="Addons (start + end)"
                placeholder="0.96"
                addonStart="$"
                addonEnd="USD"
              />
              <Input
                size="md"
                label="With icons"
                placeholder="Search subjects…"
                leftIcon={<span className="font-mono text-[14px]">⌕</span>}
                rightIcon={<span className="font-mono text-[12px]">⌘K</span>}
              />
            </div>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Card v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            3 variants (raised / overlay / hero) × 4 padding scales × 4
            elevation levels. Sub-components: <code>Card.Header</code>,{' '}
            <code>Card.Body</code>, <code>Card.Footer</code>.
          </p>

          <div className="mb-6 grid grid-cols-3 gap-4">
            <Card variant="raised" padding="md">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary mb-1">
                raised
              </div>
              <div className="text-[14px] text-text-secondary">
                Default content surface
              </div>
            </Card>
            <Card variant="overlay" padding="md">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary mb-1">
                overlay
              </div>
              <div className="text-[14px] text-text-secondary">
                Popover / dropdown
              </div>
            </Card>
            <Card variant="hero" padding="lg" elevation={2}>
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary mb-1">
                hero · elev-2
              </div>
              <div className="text-[18px] font-medium text-text-primary">
                Feature surface
              </div>
            </Card>
          </div>

          <Card variant="raised" padding="none" className="mb-4">
            <div className="p-4">
              <Card.Header>
                <div>
                  <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                    Composed
                  </div>
                  <div className="text-[16px] font-medium text-text-primary">
                    專案：第一集 · ep01
                  </div>
                </div>
                <Button variant="ghost" size="sm">更多</Button>
              </Card.Header>
              <Card.Body>
                <div className="text-[14px] text-text-secondary">
                  Header + Body + Footer composition. 適合 modal 內 form、
                  project detail panel、settings group。
                </div>
              </Card.Body>
              <Card.Footer>
                <Button variant="ghost" size="sm">取消</Button>
                <Button variant="primary" size="sm">儲存</Button>
              </Card.Footer>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card variant="raised" padding="md" interactive>
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary mb-1">
                interactive
              </div>
              <div className="text-[14px] text-text-secondary">
                Hover lifts to overlay surface. Useful for clickable list rows.
              </div>
            </Card>
            <Card variant="raised" padding="md" borderless>
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary mb-1">
                borderless
              </div>
              <div className="text-[14px] text-text-secondary">
                For full-bleed media tiles or chip-rail items.
              </div>
            </Card>
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
