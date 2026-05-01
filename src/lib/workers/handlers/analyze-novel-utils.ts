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
  return JSON.parse(sanitizeJsonControlChars(cleanedText)) as Record<string, unknown>
}

/**
 * Escape (or strip) literal control characters that appear *inside* JSON
 * string literals. LLM outputs occasionally embed raw \t / \n / \r inside
 * a string instead of the escape sequences \\t / \\n / \\r — strict
 * JSON.parse rejects those with "Bad control character in string literal".
 *
 * We walk char by char tracking the in-string state so whitespace between
 * tokens (which is allowed by JSON) stays untouched. Only control chars
 * found inside a "..." literal get rewritten to their escape sequences.
 * Other unprintable bytes (0x00-0x1F minus the ones we handle) are
 * dropped to be safe.
 */
export function sanitizeJsonControlChars(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (inString && ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString) {
      const code = text.charCodeAt(i)
      if (code === 0x09) { out += '\\t'; continue }
      if (code === 0x0a) { out += '\\n'; continue }
      if (code === 0x0d) { out += '\\r'; continue }
      if (code === 0x08) { out += '\\b'; continue }
      if (code === 0x0c) { out += '\\f'; continue }
      if (code < 0x20) continue
    }
    out += ch
  }
  return out
}

/**
 * Detect the dominant script of the source text and return both the
 * detected language code and a human-readable ethnicity hint string the
 * LLM uses as a default when the script does NOT explicitly call out a
 * character's ethnicity.
 *
 * Why this exists: Tencent VOD GEM-3.1 (the default character image
 * model) is trained predominantly on East-Asian data. A description
 * that omits ethnicity defaults to Asian faces even for an English or
 * Spanish-language script — surprising for users producing
 * non-Chinese content. Pushing the hint into the LLM prompt lets the
 * generated visual_description bake the right ethnicity in, which the
 * downstream image model then respects.
 */
export function detectScriptEthnicityHint(text: string): {
  language: string
  ethnicityHint: string
} {
  if (!text || typeof text !== 'string') {
    return { language: 'unknown', ethnicityHint: '不限種族(原文未指定語言)' }
  }
  // Larger sample — screenplays often mix narrator/stage directions in
  // one language with dialogue in another, and the dialogue lines are
  // shorter than scene descriptions. Want enough text to surface
  // dialogue markers even when narration dominates the byte count.
  const sample = text.slice(0, 8000)
  const cjk = (sample.match(/[一-鿿]/g) || []).length
  const hiragana = (sample.match(/[぀-ゟ]/g) || []).length
  const katakana = (sample.match(/[゠-ヿ]/g) || []).length
  const hangul = (sample.match(/[가-힯]/g) || []).length
  const latin = (sample.match(/[a-zA-Z]/g) || []).length
  const total = cjk + hiragana + katakana + hangul + latin
  if (total === 0) {
    return { language: 'unknown', ethnicityHint: '不限種族(原文未指定語言)' }
  }

  // Pre-check: Spanish-specific markers (¿ ¡ ñ á é í ó ú ü or common
  // function words) by ABSOLUTE count, not ratio. Screenplays where
  // narration is in zh/en but dialogue is Spanish would otherwise be
  // misclassified as zh/en just because narration has more bytes.
  const spanishMarkers = (sample.match(/[ñáíóúü¿¡]|é(?![a-z])|\b(que|los|las|para|pero|este|esta|cómo|así|porque|también|cuando|hola|gracias|adiós|señor|señora|mira|nada|todo|aquí|amigo|hijo|hija|madre|padre)\b/gi) || []).length
  if (spanishMarkers >= 15) {
    return {
      language: 'es',
      ethnicityHint: '拉丁裔/Hispanic-Latino(偵測到西班牙語台詞;LLM 請以台詞語言為主)',
    }
  }

  // Other Asian scripts: ratio-based since they only appear in their
  // native scripts (no mixing with another base language for dialogue
  // is common in our user base).
  if (hangul / total > 0.2) {
    return { language: 'ko', ethnicityHint: '韓國/Korean(東亞面孔)' }
  }
  if ((hiragana + katakana) / total > 0.1) {
    return { language: 'ja', ethnicityHint: '日本/Japanese(東亞面孔)' }
  }
  if (cjk / total > 0.3) {
    return { language: 'zh', ethnicityHint: '華人/East Asian(亞洲面孔,中國/台灣/香港背景)' }
  }

  // Lower-threshold Spanish fallback — Latin-script with even modest
  // Spanish flavour leans Hispanic over default English.
  if (spanishMarkers >= 5) {
    return { language: 'es', ethnicityHint: '拉丁裔/Hispanic-Latino(西班牙語劇本)' }
  }

  return {
    language: 'en',
    ethnicityHint: '歐美白人/Caucasian(英語劇本默認;若原文有提及其他族裔請以原文為準)',
  }
}
