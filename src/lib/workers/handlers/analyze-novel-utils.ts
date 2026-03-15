export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

/** 按别名匹配：按 '/' 拆分后任一别名精确匹配即为命中 */
export function nameMatchesWithAlias(existingName: string, newName: string): boolean {
  const a = existingName.toLowerCase().trim()
  const b = newName.toLowerCase().trim()
  if (a === b) return true
  const aliasesA = a.split('/').map(s => s.trim()).filter(Boolean)
  const aliasesB = b.split('/').map(s => s.trim()).filter(Boolean)
  return aliasesB.some(alias => aliasesA.includes(alias))
}

export function parseJsonResponse(responseText: string): Record<string, unknown> {
  let cleanedText = responseText.trim()
  cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
  const firstBrace = cleanedText.indexOf('{')
  const lastBrace = cleanedText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanedText = cleanedText.substring(firstBrace, lastBrace + 1)
  }
  return JSON.parse(cleanedText) as Record<string, unknown>
}
