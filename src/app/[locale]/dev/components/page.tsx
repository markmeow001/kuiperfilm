'use client'

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
 * Future tasks (Phase 0 remaining): Inspector, EmptyState,
 * GenerationProgress, MediaReveal. Each new component appends a
 * section here. 5/9 done as of 2026-06-04.
 *
 * Marked 'use client' so the Modal demo can hold open/close state.
 */

import { useState } from 'react'
import { Button } from '@/components/v2/Button'
import { Input } from '@/components/v2/Input'
import { Card } from '@/components/v2/Card'
import { Field } from '@/components/v2/Field'
import { Modal } from '@/components/v2/Modal'
import { Inspector } from '@/components/v2/Inspector'
import { EmptyState } from '@/components/v2/EmptyState'
import { GenerationProgress } from '@/components/v2/GenerationProgress'
import { MediaReveal } from '@/components/v2/MediaReveal'
import { ProductionContractPreview } from './ProductionContractPreview'
import { ThemeContractPreview } from './ThemeContractPreview'
import {
  useSkills,
  useInstallSkill,
  useUpdateSkillInstallation,
  type SkillRow,
} from '@/lib/query/hooks/useSkills'

export default function ComponentsPreview() {
  return (
    <main className="kuiper-dashboard min-h-screen bg-canvas text-text-primary">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <header className="mb-10 border-b border-border-soft pb-6">
          <h1 className="font-medium text-[36px] leading-[1.1] tracking-[-0.02em]">
            Component Library v2
          </h1>
          <p className="mt-2 text-[14px] text-text-secondary">
            Phase 0 redesign · tokens-v2.css validation surface
          </p>
        </header>

        <ThemeContractPreview />

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Surface scale</h2>
          <p className="mb-4 text-[13px] text-text-tertiary">
            §3.2 — a view may use ≤3 neutrals: canvas, raised, overlay.
            More = visual debt.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-card border border-border-soft bg-canvas p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-canvas
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #070B0F
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-raised p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-raised
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #111B24
              </div>
            </div>
            <div className="rounded-card border border-border-soft bg-overlay p-6">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                bg-overlay
              </div>
              <div className="mt-2 font-mono text-[14px] text-text-secondary">
                #17232D
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

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Field v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Generic form-field wrapper. Use for non-Input controls
            (textarea, select, checkbox group, custom widgets). For
            single-line text, prefer <code>{'<Input label="…" />'}</code> directly.
          </p>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field label="Project name" required helper="顯示在側邊欄 + 分享連結預覽">
              <Input size="md" placeholder="《迁徙》第一季" />
            </Field>

            <Field
              label="Description"
              description="可選；用於 SEO 跟團隊內部溝通。"
              helper="60-160 字之間最理想。"
            >
              <textarea
                rows={3}
                placeholder="一句話描述劇情主題…"
                className="w-full rounded-input border border-border-soft bg-raised px-3 py-2 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none transition-colors duration-[120ms] ease-out hover:border-border-strong focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/40"
              />
            </Field>

            <Field
              label="Genre"
              required
              error="請至少選一個類型"
            >
              <div className="flex flex-wrap gap-2">
                {['短劇', '紀錄片', 'MV', '產品廣告'].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="rounded-pill border border-border-soft bg-raised px-3 py-1 text-[12px] text-text-secondary hover:bg-overlay"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Aspect ratio"
              description="後續可在分鏡頁覆蓋"
            >
              <select
                className="w-full rounded-input border border-border-soft bg-raised px-3 py-2 text-[14px] text-text-primary outline-none transition-colors duration-[120ms] ease-out hover:border-border-strong focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/40"
              >
                <option>9:16 — 直式（短劇預設）</option>
                <option>16:9 — 橫式</option>
                <option>1:1 — 方形</option>
              </select>
            </Field>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Modal v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Controlled overlay with portal, focus trap, Escape close,
            backdrop click dismiss, scroll lock. 4 sizes
            (sm / md / lg / xl). Compose with{' '}
            <code>Modal.Header</code> / <code>Modal.Body</code> /{' '}
            <code>Modal.Footer</code>. Animation: 200ms fade backdrop +
            320ms scale-spring body (respects prefers-reduced-motion).
          </p>

          <ModalDemo />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Inspector v2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Collapsible 360px side panel. Per <strong>REDESIGN_PLAN §3.4</strong>{' '}
            workspace layout: Sidebar 256 + Canvas fluid + Inspector 360
            (collapsible). Demo here mounts inside a fixed 480px-tall mock
            workspace so the collapse animation is observable.
          </p>

          <InspectorDemo />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">EmptyState v2 — §3.7.3</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Signature cold-start moment. Spec: ONE illustration + ONE
            display heading + ONE primary CTA. <strong>Forbidden</strong>:
            tips lists, three example cards, stock 3D, AI mascot.
            Confidence comes from restraint.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <Card variant="raised" padding="none">
              <EmptyState
                size="md"
                heading="尚未建立任何專案"
                description="從一個劇本或想法開始你的第一部短劇。"
                ctaLabel="建立新專案"
                onCta={() => undefined}
              />
            </Card>
            <Card variant="hero" padding="none" elevation={2}>
              <EmptyState
                size="lg"
                heading="你的第一部短劇從這裡開始"
                description="Your first drama starts here."
                ctaLabel="從一個故事開始"
                onCta={() => undefined}
              />
            </Card>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">GenerationProgress v2 — §3.7.1</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Signature in-progress moment. Spec: 9:16 frame +{' '}
            <strong>accent-500 violet glow breathing 2s loop</strong> +
            ghost-typing scene description + silent tertiary ETA.{' '}
            <strong>Forbidden</strong>: spinner, percentage. Watch the
            caret blink and the description erase + retype on loop.
          </p>

          <Card variant="raised" padding="none">
            <GenerationProgress
              description="鏡頭 1：CATHERINE 走進廚房，端著生日蛋糕，鏡頭由低角度緩慢推近。"
              eta="約 90 秒"
            />
          </Card>
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">MediaReveal v2 — §3.7.2</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Signature result-reveal moment. Spec: 600ms fade from black +
            scale 0.96→1.0 spring + 400ms hold + muted autoplay + 2s chrome
            dim to 40% opacity. Click 「重播」 to re-trigger the reveal
            sequence. Real consumers swap from <code>GenerationProgress</code>{' '}
            to <code>MediaReveal</code> in the same slot when the run
            completes.
          </p>

          <MediaRevealDemo />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">Skill picker — Phase 2.5</h2>
          <p className="mb-6 text-[13px] text-text-tertiary">
            Skill primitive prototype. Spec: <code>IMPL_PREP/R-skill-primitive.md</code>.
            Mirrors flova&apos;s 「我的 Skill」 list + picker affordance. Mock
            data only — production version reads from the Skill +
            SkillInstallation Prisma tables shipping in this branch&apos;s
            schema migration.
          </p>

          <SkillPickerDemo />
        </section>

        <section className="mb-12">
          <h2 className="mb-4 text-[20px] font-medium">
            Production UI contract — 2026 platform upgrade
          </h2>
          <p className="mb-6 max-w-3xl text-[13px] leading-6 text-text-tertiary">
            統一深色製片工作區與完整狀態語言的整合預覽。
            下方資料只用於開發驗收，不會送出生成、建立資料或產生費用。
          </p>
          <ProductionContractPreview />
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

function ModalDemo() {
  const [openSm, setOpenSm] = useState(false)
  const [openMd, setOpenMd] = useState(false)
  const [openLg, setOpenLg] = useState(false)
  const [openComposed, setOpenComposed] = useState(false)

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => setOpenSm(true)}>
          Open sm (confirm)
        </Button>
        <Button variant="primary" onClick={() => setOpenMd(true)}>
          Open md (form)
        </Button>
        <Button variant="primary" onClick={() => setOpenLg(true)}>
          Open lg (content)
        </Button>
        <Button variant="secondary" onClick={() => setOpenComposed(true)}>
          Open composed (header + body + footer)
        </Button>
      </div>

      <Modal open={openSm} onClose={() => setOpenSm(false)} size="sm">
        <Modal.Header
          heading="確定刪除？"
          subtitle="此動作不可復原。"
          onClose={() => setOpenSm(false)}
        />
        <Modal.Body>
          專案「《迁徙》第一季」將被永久刪除。所有分鏡、生成檔、配音紀錄
          都會一起刪除。
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setOpenSm(false)}>
            取消
          </Button>
          <Button variant="danger" size="sm" onClick={() => setOpenSm(false)}>
            確定刪除
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal open={openMd} onClose={() => setOpenMd(false)} size="md">
        <Modal.Header heading="新增專案" onClose={() => setOpenMd(false)} />
        <Modal.Body>
          <Field label="專案名" required>
            <Input size="md" placeholder="《迁徙》第二季" autoFocus />
          </Field>
          <div className="mt-4">
            <Field label="目標時長" description="後續可在分鏡頁覆蓋">
              <select className="w-full rounded-input border border-border-soft bg-raised px-3 py-2 text-[14px] text-text-primary outline-none">
                <option>90 秒</option>
                <option>120 秒</option>
                <option>180 秒</option>
              </select>
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setOpenMd(false)}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => setOpenMd(false)}>
            建立專案
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal open={openLg} onClose={() => setOpenLg(false)} size="lg">
        <Modal.Header
          heading="預覽：第一集 · ep01"
          subtitle="生成 9 段中 7 段已完成"
          onClose={() => setOpenLg(false)}
        />
        <Modal.Body>
          <div className="aspect-video rounded-card border border-border-soft bg-canvas grid place-items-center text-text-tertiary text-[12px] uppercase tracking-[0.04em]">
            video preview placeholder
          </div>
          <p className="mt-3 text-[13px] text-text-tertiary">
            內容 modal — 大型預覽、分享連結、asset 詳情。lg = 720px max。
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setOpenLg(false)}>
            關閉
          </Button>
          <Button variant="primary" size="sm" onClick={() => setOpenLg(false)}>
            分享
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal open={openComposed} onClose={() => setOpenComposed(false)} size="md">
        <Modal.Header
          heading="設定 · 一般"
          subtitle="這些設定僅影響你個人帳號的偏好。"
          onClose={() => setOpenComposed(false)}
        />
        <Modal.Body>
          <Field label="語言" description="影響介面與 AI 對話語言">
            <select className="w-full rounded-input border border-border-soft bg-raised px-3 py-2 text-[14px] text-text-primary outline-none">
              <option>繁體中文</option>
              <option>简体中文</option>
              <option>English</option>
            </select>
          </Field>
          <div className="mt-4">
            <Field label="鍵盤快捷鍵" helper="按 ? 可隨時呼叫快捷鍵列表">
              <Input size="md" defaultValue="?" />
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setOpenComposed(false)}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => setOpenComposed(false)}>
            儲存
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

function InspectorDemo() {
  const [open, setOpen] = useState(true)
  const [position, setPosition] = useState<'left' | 'right'>('right')

  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收合' : '展開'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPosition((p) => (p === 'right' ? 'left' : 'right'))}
        >
          {position === 'right' ? '改靠左' : '改靠右'}
        </Button>
      </div>

      <div className="flex h-[480px] overflow-hidden rounded-card border border-border-soft bg-canvas">
        {position === 'left' ? (
          <Inspector open={open} onCollapseChange={setOpen} position="left">
            <Inspector.Header
              heading="檢視器"
              subtitle="第一鏡 · CATHERINE"
              onCollapseChange={setOpen}
              position="left"
            />
            <Inspector.Body>
              <div className="space-y-3">
                <Field label="鏡頭時長"><Input size="sm" defaultValue="3.2s" /></Field>
                <Field label="運鏡"><Input size="sm" defaultValue="dolly forward" /></Field>
                <Field label="人物動作">
                  <Input size="sm" defaultValue="緩慢將蛋糕放下" />
                </Field>
              </div>
            </Inspector.Body>
            <Inspector.Footer>
              <Button variant="ghost" size="sm">重設</Button>
              <Button variant="primary" size="sm">套用</Button>
            </Inspector.Footer>
          </Inspector>
        ) : null}

        <div className="flex flex-1 items-center justify-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-text-tertiary">
            canvas (fluid)
          </span>
        </div>

        {position === 'right' ? (
          <Inspector open={open} onCollapseChange={setOpen} position="right">
            <Inspector.Header
              heading="檢視器"
              subtitle="第一鏡 · CATHERINE"
              onCollapseChange={setOpen}
              position="right"
            />
            <Inspector.Body>
              <div className="space-y-3">
                <Field label="鏡頭時長"><Input size="sm" defaultValue="3.2s" /></Field>
                <Field label="運鏡"><Input size="sm" defaultValue="dolly forward" /></Field>
                <Field label="人物動作">
                  <Input size="sm" defaultValue="緩慢將蛋糕放下" />
                </Field>
              </div>
            </Inspector.Body>
            <Inspector.Footer>
              <Button variant="ghost" size="sm">重設</Button>
              <Button variant="primary" size="sm">套用</Button>
            </Inspector.Footer>
          </Inspector>
        ) : null}
      </div>
    </>
  )
}

function MediaRevealDemo() {
  // Stable demo video — Google's public sample (Big Buck Bunny 16:9).
  // Real consumers feed an mp4 / m3u8 from their own COS / R2 bucket.
  const SAMPLE_VIDEO =
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'

  const [revealKey, setRevealKey] = useState(0)

  return (
    <>
      <div className="mb-3 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRevealKey((k) => k + 1)}>
          重播 reveal
        </Button>
      </div>
      <Card variant="raised" padding="none">
        <MediaReveal
          key={revealKey}
          src={SAMPLE_VIDEO}
          aspectRatio="16:9"
          dimChromeOnReveal={false}
        />
      </Card>
    </>
  )
}

// ─── Skill picker demo (Phase 2.5 — real API) ───
//
// Wired to the real /api/skills + /api/skill-installations endpoints
// via the hooks in src/lib/query/hooks/useSkills.ts. Requires the
// Skill tables to exist in DB (`npx prisma db push`) + at least one
// Skill seeded (`npx tsx --env-file=.env scripts/seed-official-skills.ts`).
//
// When DB is empty, the picker renders the EmptyState cold-start
// (the spec-mandated 「尚未啟用任何 Skill」 affordance).
//
// `npm run dev:next` without DB → calls 500. To preview UI without
// DB, set SKIP_INSTRUMENTATION=1 and skip this section (the rest of
// /dev/components still works since it's pure UI components).

function SkillPickerDemo() {
  const skillsQuery = useSkills()
  const installMutation = useInstallSkill()
  const updateMutation = useUpdateSkillInstallation()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null)

  const skills = skillsQuery.data?.skills ?? []
  const installed = skills.filter((s) => s.installed)
  const browse = skills.filter((s) => !s.installed)

  // First installed Skill becomes active by default; user can swap.
  const effectiveActiveId = activeSkillId ?? installed[0]?.id ?? null
  const active = skills.find((s) => s.id === effectiveActiveId) ?? null

  function toggleEnabled(s: SkillRow) {
    if (!s.installationId) return
    updateMutation.mutate({
      installationId: s.installationId,
      enabled: !s.enabled,
    })
  }

  function install(s: SkillRow) {
    installMutation.mutate(s.id, {
      onSuccess: () => setActiveSkillId(s.id),
    })
  }

  if (skillsQuery.isLoading) {
    return (
      <Card variant="raised" padding="lg">
        <div className="text-center text-[13px] text-text-tertiary">
          載入 Skill 庫…
        </div>
      </Card>
    )
  }

  if (skillsQuery.isError) {
    return (
      <Card variant="raised" padding="lg">
        <div className="space-y-2 text-center">
          <div className="text-[14px] text-error">無法載入 Skill 庫</div>
          <div className="text-[12px] text-text-tertiary">
            確認已執行 <code>npx prisma db push</code> + seeder，
            或本地有 MySQL 可連線。
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* ─── Picker chip — what appears inline in a creation flow ─── */}
      <div>
        <div className="mb-2 text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
          Picker chip (inline in narrative editor / new-project flow)
        </div>
        <Card variant="raised" padding="md">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                Active Skill
              </div>
              <div className="mt-1 text-[16px] font-medium text-text-primary">
                🎬 {active?.name ?? '尚未選擇'}
              </div>
              {active ? (
                <div className="mt-0.5 text-[12px] text-text-secondary">
                  by {active.authorDisplay}
                </div>
              ) : null}
            </div>
            <Button variant="secondary" size="md" onClick={() => setPickerOpen(true)}>
              更換 Skill
            </Button>
          </div>
        </Card>
      </div>

      {/* ─── Library page — 「我的 Skill」 ─── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-medium text-text-primary">
            我的 Skill <span className="text-text-tertiary">· {installed.length}</span>
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
            + 新增 Skill
          </Button>
        </div>
        {installed.length === 0 ? (
          <Card variant="raised" padding="none">
            <EmptyState
              size="md"
              heading="尚未啟用任何 Skill"
              description="從精選列表挑一個開始。"
              ctaLabel="瀏覽 Skill 庫"
              onCta={() => setPickerOpen(true)}
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {installed.map((s) => (
              <Card key={s.id} variant="raised" padding="md" interactive>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-text-primary">
                        {s.name}
                      </span>
                      {s.isFeatured ? (
                        <span className="rounded-pill bg-primary-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.04em] text-primary-500">
                          熱門
                        </span>
                      ) : null}
                      <span className="text-[12px] text-text-tertiary">
                        {s.authorDisplay}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-text-secondary">
                      {s.description}
                    </p>
                  </div>
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={() => toggleEnabled(s)}
                      disabled={updateMutation.isPending}
                      className="h-4 w-4 cursor-pointer accent-primary-500 disabled:cursor-not-allowed"
                    />
                    <span className="text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
                      {s.enabled ? '啟用' : '停用'}
                    </span>
                  </label>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ─── Browse Modal — 精選 / marketplace（Phase 3.5 預告） ─── */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} size="lg">
        <Modal.Header
          heading="瀏覽 Skill 庫"
          subtitle="精選 Skill — 由 KuiperAI 與簽約創作者打造（Phase 3.5 開放社區提交）"
          onClose={() => setPickerOpen(false)}
        />
        <Modal.Body>
          {browse.length === 0 ? (
            <EmptyState
              size="md"
              heading="已啟用全部精選 Skill"
              description="社區 Skill 即將開放。"
            />
          ) : (
            <div className="space-y-3">
              {browse.map((s) => (
                <Card key={s.id} variant="raised" padding="md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-text-primary">
                          {s.name}
                        </span>
                        <span className="text-[12px] text-text-tertiary">
                          {s.authorDisplay}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">
                        {s.description}
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => install(s)}
                      loading={installMutation.isPending}
                      disabled={installMutation.isPending}
                    >
                      + 新增
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
            關閉
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}
