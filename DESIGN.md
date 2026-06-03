# KuiperAI Design System v2

> **Status**: Phase 0 — token spec live, component library v2 in progress
> **Date**: 2026-06-03
> **Owner**: feat/redesign-phase-0
> **Source of truth**: this file + `src/styles/tokens-v2.css` +
> `src/components/v2/*`
>
> For the why / strategy / phased plan, see
> [`REDESIGN_PLAN.md`](./REDESIGN_PLAN.md).

---

## 1. Design routes

KuiperAI runs two parallel design routes. A page is on exactly one.

| Route | When | Surface mix | Identity |
|---|---|---|---|
| **Cinematic Immersive** (default) | All creation pages: home / new / script / subjects / storyboard / voice / final / marketing / landing | canvas / raised / overlay + cinema-gold primary + violet AI-accent | Theater-dark, signature reveal moments, restraint as confidence |
| **Studio Dark** (secondary) | All management pages: admin / settings / workspace / billing / profile | raised / overlay only, no signature moments, dense tables, function over flourish | Linear-clone density + utility |

**Rule**: don't mix routes in one view. If a page can't decide, default to Cinematic Immersive.

---

## 2. Tokens

All token CSS variables live in `src/styles/tokens-v2.css`. Tailwind utility mappings live in `globals.css` `@theme inline` block.

### 2.1 Color

**Neutrals** — canvas (deepest) → raised → overlay (lightest):

```
--surface-canvas:  #0A0A0A
--surface-raised:  #171717
--surface-overlay: #1F1F1F
--surface-glass:   rgba(23, 23, 23, 0.72)  // media-only
```

**Rule**: a single view uses ≤3 neutrals. More = visual debt.

**Primary** — cinema marquee gold (extends current amber lineage):

```
--primary-400: #FFD96E  (hover)
--primary-500: #F5C24A  (base)
--primary-600: #C99A2E  (pressed)
```

**Accent** — AI generation moments only (electric violet):

```
--accent-500: #7C5CFF
--accent-glow: radial-gradient(#7C5CFF66, transparent 70%)
```

**Semantic**:

```
--success: #22C55E
--warning: #F59E0B
--error:   #EF4444
--info:    #3B82F6
```

**Text** (WCAG verified on canvas):

```
--text-primary:   #FAFAFA  // 18.7:1
--text-secondary: #A3A3A3  // 7.2:1
--text-tertiary:  #737373  // 4.6:1, AA large only
```

**Borders** — single rule, two intensities:

```
--border-soft:   rgba(255, 255, 255, 0.08)
--border-strong: rgba(255, 255, 255, 0.14)
```

### 2.2 Typography

```css
font-family: 'Inter', 'Source Han Sans SC', 'PingFang SC', system-ui, sans-serif;
```

- Display: Inter Display + Source Han Sans SC (500/600/700)
- Body: Inter + Source Han Sans SC (400/500)
- Mono: JetBrains Mono

**Scale (1.25 ratio)**: 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 / 72

**Line height**: body 1.6 / UI 1.45 / display 1.1 / **CJK body 1.75**.

**Tracking**: display 30px+ collapses to -0.02em; uppercase labels open to +0.04em.

**Forbidden**:
- Noto Serif SC display
- Serif CJK + sans Latin in the same text run (translation-tell)

### 2.3 Spacing & layout

**Base unit 4px**: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80 / 128

**Containers**: 1440 (app) / 1280 (content) / 720 (reading)

**Workspace layout standard**: Sidebar 256 + Canvas fluid + Inspector 360 (collapsible)

**Gutter**: desktop 24 / tablet 16 / mobile 12

**Storyboard grid**: 9:16 native — desktop 3-up / tablet 2-up / mobile 1-up. Gap 16.

### 2.4 Shape

```
--r-chip:  4px
--r-input: 8px
--r-card:  12px
--r-modal: 16px
--r-hero:  24px
--r-pill:  9999px
```

### 2.5 Elevation

Dark mode lifts via surface change + soft inset border. **Never drop-shadow** the dark-mode card pattern.

```
--elev-1: 0 1px 2px rgba(0,0,0,0.4)
--elev-2: 0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)
--elev-3: 0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)
```

### 2.6 Motion

```
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)  // reveal only
```

**Duration scale**:

```
--d-hover:  120ms
--d-state:  200ms
--d-panel:  320ms
--d-page:   600ms
--d-reveal: 1200ms  // signature moments
```

**Respect `prefers-reduced-motion`** — anything >200ms gets killed.

### 2.7 Iconography

- **Lucide or Phosphor**, 1.5px stroke, 20px default, single weight
- **Forbidden**: mixing filled + outline icons, emoji in chrome (emoji = user content, not UI)
- **Illustration**: commissioned single-color line art (primary gold accent), reserved for empty states / onboarding / marketing only

---

## 3. Signature moments (the three things that must feel premium)

### 3.1 Generation in progress

Full-bleed dark canvas + 9:16 frame centered + accent-500 violet glow border in a 2-second slow breathing loop. Below: one line of ghost-typing scene description.

**Forbidden**: spinner, progress percentage.

Estimated time goes in silent tertiary text below the description.

### 3.2 Result reveal

Frame fades from black over 600ms, scales 0.96 → 1.0 with the spring easing. First frame holds 400ms then muted autoplay. Chrome around the player dims to 40% opacity for 2 seconds to lock the eye on the video.

This is the dopamine hit. Protect it.

### 3.3 Empty / cold start

One commissioned line illustration (clapperboard, empty stage), one line of display type ("你的第一部短劇從這裡開始 / Your first drama starts here"), one primary CTA.

**Forbidden**: tip lists, three example cards, hero with stock 3D illustration.

Confidence comes from restraint.

---

## 4. Anti-patterns (10 things never to ship)

1. A single view using >3 neutrals.
2. Gradient buttons (purple-to-pink is especially flagged — it's the ChatGPT-wrapper tell).
3. Emoji in chrome / nav / button labels.
4. Glassmorphism over solid color (it just becomes darker gray).
5. Dark-mode cards with drop shadow (use border + surface lift).
6. A single toolbar mixing filled and outline icons.
7. Serif CJK with sans Latin in one text run.
8. Loading spinners for AI generation (use the §3.1 signature moment).
9. A single page with >4 distinct button styles.
10. Stock 3D illustration, isometric humans, AI-generated mascot.

---

## 5. Migration policy

**Coexistence**: tokens-v2.css is additive. The legacy `ui-tokens-glass.css` + `ui-semantic-glass.css` stay imported in `globals.css` until each page is migrated in Phase 1. No name collisions — new code uses `--surface-*` / `--space-*` / `--r-*` / `--d-*`; legacy code keeps `--glass-*`.

**Per-page migration sequence**:
1. Replace inline color/font hex with v2 token utilities (`bg-canvas`, `text-text-primary`, `rounded-card`).
2. Replace ad-hoc spacing with `--space-*` scale.
3. Replace legacy glass-card components with v2 `<Card />`.
4. Pass a `/qa-only` sweep before merging.
5. Once all Phase 1 pages migrate, delete the legacy `ui-*-glass.css` imports.

**Naming**: anything new in `src/components/v2/` is auth-of-truth. Anything in `src/components/ui/` or page-local `*.module.css` is legacy and slated for replacement.

---

## 6. Component library v2 inventory

| Component | Status | File |
|---|---|---|
| `<Button />` | ✅ Phase 0 | `src/components/v2/Button.tsx` |
| `<Input />` | ⏳ Phase 0 | _todo_ |
| `<Field />` | ⏳ Phase 0 | _todo_ |
| `<Card />` | ⏳ Phase 0 | _todo_ |
| `<Modal />` | ⏳ Phase 0 | _todo_ |
| `<Inspector />` | ⏳ Phase 0 | _todo_ |
| `<EmptyState />` | ⏳ Phase 0 | _todo_ |
| `<GenerationProgress />` | ⏳ Phase 0 | _todo_ |
| `<MediaReveal />` | ⏳ Phase 0 | _todo_ |

**Preview**: `/zh/dev/components` — eyeball validation surface.

---

## 7. References

- [`REDESIGN_PLAN.md`](./REDESIGN_PLAN.md) — full master plan
- [`IMPL_PREP/`](./IMPL_PREP/) — 17 cross-cutting prep docs (schema, RBAC, pricing math, observability, legal, openapi, component inventory, etc.)
- [`design-preview/`](./design-preview/) — 36 HTML mockups for visual reference (NOT shipped React)
