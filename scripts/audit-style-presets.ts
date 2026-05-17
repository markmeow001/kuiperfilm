/**
 * Style preset catalog audit + manual QA spec generator.
 *
 * Goal: cover the "每個風格 preset 有沒有用" verification user requested
 * in 2026-05-04 (see `project_kuiperfilm_style_preset_followups` memory).
 *
 * Structural integrity is covered by tests/unit/style-profile/presets.test.ts
 * (179 invariants, 100% deterministic). This script handles the
 * non-automatable half: produces a human-readable QA checklist with the
 * exact prompt strings, styleReferences, and a fixed test recipe so the
 * tester (iangyc / user) generates one character + one panel image per
 * preset using the SAME inputs across all 22 — meaning visual differences
 * come from the preset, not the test setup.
 *
 * Usage:
 *   npx tsx scripts/audit-style-presets.ts            # print to stdout
 *   npx tsx scripts/audit-style-presets.ts --write    # write to docs/runbooks/
 *   npx tsx scripts/audit-style-presets.ts --json     # machine-readable JSON
 *
 * No API calls. No DB access. Cost: zero. Runs offline.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetCategory,
  type PresetKey,
} from '@/lib/style-profile/presets'

interface PresetAuditRow {
  key: PresetKey
  category: PresetCategory
  label: string
  zhLabel: string
  zhDescription: string
  positivePrompt: string
  negativePrompt: string
  styleReferences: Array<{ era: string; url: string; label: string }>
  positiveLength: number
  negativeLength: number
}

function buildAuditRows(): PresetAuditRow[] {
  const rows: PresetAuditRow[] = []
  for (const [category, keys] of Object.entries(PRESET_ORDER_BY_CATEGORY) as Array<[PresetCategory, PresetKey[]]>) {
    for (const key of keys) {
      const entry = STYLE_PROFILE_PRESETS[key]
      rows.push({
        key,
        category,
        label: entry.label,
        zhLabel: entry.zhLabel,
        zhDescription: entry.zhDescription,
        positivePrompt: entry.positivePrompt,
        negativePrompt: entry.negativePrompt,
        styleReferences:
          entry.styleReferences?.map((r) => ({ era: r.eraHint, url: r.url, label: r.label })) ?? [],
        positiveLength: entry.positivePrompt.length,
        negativeLength: entry.negativePrompt.length,
      })
    }
  }
  return rows
}

function renderMarkdown(rows: PresetAuditRow[]): string {
  const generatedAt = new Date().toISOString()
  const out: string[] = []

  out.push(`# Style Preset Audit & Manual QA Checklist`)
  out.push(``)
  out.push(`Generated: ${generatedAt}`)
  out.push(`Total presets in picker: **${rows.length}** across **${Object.keys(PRESET_ORDER_BY_CATEGORY).length}** categories.`)
  out.push(``)
  out.push(`Companion deterministic check: \`tests/unit/style-profile/presets.test.ts\` (179 structural invariants).`)
  out.push(`This document covers the visual half — does Tencent VOD actually render xianxia when you pick \`cn-xianxia\`?`)
  out.push(``)

  // ─────── Reproducible test recipe ───────
  out.push(`## 0. Reproducible test recipe`)
  out.push(``)
  out.push(`To keep visual differences attributable to the preset (not the prompt), every preset should be tested with the SAME character + panel inputs:`)
  out.push(``)
  out.push(`**Test character profile** (paste into admin "新增角色" form):`)
  out.push(`\`\`\``)
  out.push(`name: 林夏`)
  out.push(`introduction: 28 歲女性，亞洲面孔，黑色及肩直髮，穿白色襯衫。職場 OL 設定。`)
  out.push(`visual_description: 亞洲面孔，黑色及肩直髮，柳眉杏眼，膚色偏白，身穿純白色襯衫搭配灰色西裝外套。氣質乾淨利落，30 歲左右。`)
  out.push(`\`\`\``)
  out.push(``)
  out.push(`**Test panel prompt** (paste into manual panel gen):`)
  out.push(`\`\`\``)
  out.push(`一個 28 歲女性，黑色及肩直髮，穿白色襯衫，坐在咖啡廳窗邊看書。室內柔光，傍晚時分。`)
  out.push(`\`\`\``)
  out.push(``)
  out.push(`**Per-preset steps:**`)
  out.push(`1. 開測試專案 → V2ProjectSettingsPanel → 「畫面風格」chip → 切到該 preset`)
  out.push(`2. 進角色頁 → 林夏 → 重新生成角色形象 → 等 30-60s`)
  out.push(`3. 進分鏡頁 → 任一 panel → 用上面的 panel prompt 觸發 panel image gen → 等 30-60s`)
  out.push(`4. 對照下面 §1 該 preset 的 zhDescription，眼判生圖是否吻合`)
  out.push(`5. 在該行的「Character image OK?」/「Panel image OK?」打勾或寫筆記`)
  out.push(`6. 撞 sensitive content / Tencent VOD 真人审核 timeout / 風格 leak 也記下來`)
  out.push(``)
  out.push(`預估時間：22 preset × 2 圖 × 60s + 觀察 ≈ 90-120 分鐘`)
  out.push(``)

  // ─────── Per-category preset table ───────
  out.push(`## 1. Preset checklist (group by category)`)
  out.push(``)

  for (const [category, keys] of Object.entries(PRESET_ORDER_BY_CATEGORY) as Array<[PresetCategory, PresetKey[]]>) {
    const catLabel = CATEGORY_LABEL_ZH[category]
    out.push(`### ${catLabel} (\`${category}\`)`)
    out.push(``)
    for (const key of keys) {
      const row = rows.find((r) => r.key === key)!
      out.push(`#### \`${key}\` — ${row.zhLabel} (${row.label})`)
      out.push(``)
      out.push(`**zhDescription:**`)
      out.push(`> ${row.zhDescription}`)
      out.push(``)
      out.push(`**Positive prompt (${row.positiveLength} chars):**`)
      out.push(`\`\`\``)
      out.push(row.positivePrompt)
      out.push(`\`\`\``)
      out.push(``)
      out.push(`**Negative prompt (${row.negativeLength} chars):**`)
      out.push(`\`\`\``)
      out.push(row.negativePrompt)
      out.push(`\`\`\``)
      out.push(``)
      if (row.styleReferences.length > 0) {
        out.push(`**Style reference images (photo anchor path — overrides text):**`)
        for (const r of row.styleReferences) {
          out.push(`- \`${r.era}\` → ${r.label}: ${r.url}`)
        }
        out.push(``)
      }
      out.push(`**QA — 林夏 + 咖啡廳場景:**`)
      out.push(`- [ ] Character image matches zhDescription`)
      out.push(`- [ ] Panel image matches zhDescription`)
      out.push(`- [ ] No sensitive-content / timeout failures`)
      out.push(`- Notes: ___`)
      out.push(``)
      out.push(`---`)
      out.push(``)
    }
  }

  // ─────── Known risks ───────
  out.push(`## 2. Known watch-outs (from prior bug history)`)
  out.push(``)
  out.push(`- **\`realistic\`**: Kling-2.1 / 3.0-Omni's Genshin-CG training prior can leak through text-only anchors. We added \`styleReferences\` (3 photos covering period/modern/neutral) on 2026-05-13 to dominate via image attention. If output looks CG/painted instead of photographic, check worker log for \`source:"styleReference"\` to confirm the photo anchor was attached.`)
  out.push(`- **\`chinese-ink\` / \`thick-paint\`**: heavily painterly. Watch that Tencent VOD doesn't fall back to its realistic default when scene contains modern keywords (phone, car, etc.).`)
  out.push(`- **\`korean-webtoon-fine\`**: super-fine line work is hard for Tencent's default model — likely needs Kling Omni to render correctly. If output still looks anime, route the gen through the Omni provider.`)
  out.push(`- **\`game-cg\`**: deliberately between realism and Pixar. Easy to confuse with \`realistic\` if you don't compare side-by-side; the porcelain skin is the give-away.`)
  out.push(`- **Legacy \`anime\` / \`thick-paint\`** keys: hidden from picker but valid in DB; if a pre-2026-05 project still references them they should resolve (covered by \`resolvePresetKeyByPositivePrompt\` roundtrip test).`)
  out.push(``)

  // ─────── Summary footer ───────
  out.push(`## 3. Tracking the result`)
  out.push(``)
  out.push(`When done, copy the filled-in checklist back into the project memory at:`)
  out.push(``)
  out.push(`\`~/.claude/projects/-Users-joshhung/memory/project_kuiperfilm_style_preset_followups.md\``)
  out.push(``)
  out.push(`Or summarise pass/fail counts in chat — anything below ~18/22 passing means the preset catalog needs prompt-tuning before shipping more visual-style features.`)
  out.push(``)

  return out.join('\n')
}

function renderJson(rows: PresetAuditRow[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      totalPresets: rows.length,
      categories: Object.keys(PRESET_ORDER_BY_CATEGORY),
      presets: rows,
    },
    null,
    2,
  )
}

function renderConsoleTable(rows: PresetAuditRow[]): string {
  const lines: string[] = []
  lines.push(`Style preset catalog — ${rows.length} active presets`)
  lines.push(`─`.repeat(110))
  lines.push(
    `${'key'.padEnd(22)} ${'category'.padEnd(11)} ${'zhLabel'.padEnd(14)} ${'+chars'.padStart(7)} ${'-chars'.padStart(7)} ${'refs'.padStart(5)}`,
  )
  lines.push(`─`.repeat(110))
  for (const r of rows) {
    lines.push(
      `${r.key.padEnd(22)} ${r.category.padEnd(11)} ${r.zhLabel.padEnd(14)} ${String(r.positiveLength).padStart(7)} ${String(r.negativeLength).padStart(7)} ${String(r.styleReferences.length).padStart(5)}`,
    )
  }
  lines.push(`─`.repeat(110))
  lines.push(`Tip: --write produces a markdown QA checklist at docs/runbooks/style-preset-audit.md`)
  return lines.join('\n')
}

function main(): void {
  const argv = process.argv.slice(2)
  const wantWrite = argv.includes('--write')
  const wantJson = argv.includes('--json')

  const rows = buildAuditRows()

  if (wantJson) {
    process.stdout.write(renderJson(rows))
    process.stdout.write('\n')
    return
  }

  if (wantWrite) {
    const outPath = resolve(process.cwd(), 'docs/runbooks/style-preset-audit.md')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, renderMarkdown(rows), 'utf8')
    process.stdout.write(`[audit-style-presets] wrote ${outPath} (${rows.length} presets)\n`)
    return
  }

  process.stdout.write(renderConsoleTable(rows))
  process.stdout.write('\n')
}

main()
