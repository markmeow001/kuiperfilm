import { describe, expect, it } from 'vitest'
import { getPromptTemplate } from '@/lib/prompt-i18n/template-store'
import { PROMPT_IDS } from '@/lib/prompt-i18n/prompt-ids'
import { PROMPT_CATALOG } from '@/lib/prompt-i18n/catalog'

describe('Kling-specific storyboard detail prompt', () => {
  it('is registered in the prompt id table', () => {
    expect(PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL).toBe(
      'np_kling_agent_storyboard_detail',
    )
  })

  it('has a catalog entry pointing to the kling subfolder', () => {
    const entry = PROMPT_CATALOG[PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL]
    expect(entry).toBeDefined()
    expect(entry.pathStem).toBe('novel-promotion/kling/agent_storyboard_detail')
  })

  it('declares the same variable keys as the generic storyboard detail prompt', () => {
    // Variable contract must match so the same caller payload works for both prompts.
    const klingEntry = PROMPT_CATALOG[PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL]
    const genericEntry = PROMPT_CATALOG[PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL]
    expect(klingEntry.variableKeys.slice().sort()).toEqual(
      genericEntry.variableKeys.slice().sort(),
    )
  })

  it.each(['zh', 'en'] as const)('loads the %s template and includes Kling-specific guidance', (locale) => {
    const tmpl = getPromptTemplate(PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL, locale)
    expect(tmpl.length).toBeGreaterThan(800)
    // Kling-specific markers
    expect(tmpl).toMatch(/Kling/)
    expect(tmpl).toMatch(/multi_shot_group/)
    expect(tmpl).toMatch(/Motion Control/)
    // Required template variables must be present
    expect(tmpl).toContain('{panels_json}')
    expect(tmpl).toContain('{characters_age_gender}')
    expect(tmpl).toContain('{locations_description}')
  })
})
