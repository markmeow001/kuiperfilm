/**
 * 2026-06-03 — guard the storyboard-plan placeholder parity.
 *
 * The 4-agent audit found the EN plan template had NO {target_panel_count}
 * or {target_duration} placeholders (only prose), so storyboard-phases.ts /
 * orchestrator.ts .replace() bound nothing for English-locale projects →
 * no panel-count floor / duration target → under-splitting / dropped beats.
 * The prompt-i18n-guard only checks file-pair existence + language
 * directives, never placeholder sets, so it can't catch this. This test
 * locks both placeholders into BOTH locale templates.
 */
import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const PROMPT_DIR = path.resolve(__dirname, '../../../lib/prompts/novel-promotion')

function read(locale: 'zh' | 'en'): string {
  return fs.readFileSync(path.join(PROMPT_DIR, `agent_storyboard_plan.${locale}.txt`), 'utf8')
}

describe('storyboard-plan placeholder parity', () => {
  for (const locale of ['zh', 'en'] as const) {
    it(`${locale} plan binds {target_panel_count} so the count is a real number, not prose`, () => {
      expect(read(locale)).toContain('{target_panel_count}')
    })
    it(`${locale} plan binds {target_duration}`, () => {
      expect(read(locale)).toContain('{target_duration}')
    })
  }
})
