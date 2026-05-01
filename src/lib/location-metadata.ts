/**
 * Location 環境設置 metadata — Approach A 寬景的延伸。
 *
 * 用戶在 V2LocationEditModal 設「天氣 / 時段 / 光源 / 色溫 / 標籤」等
 * 環境條件,這些值需要持久化並注入到 location image 的 prompt 裡。
 *
 * 為了避免 schema migration 在 prod 上開新欄位,metadata 直接序列化進
 * 既有的 NovelPromotionLocation.summary 欄位。讀寫一律透過這支模組
 * 的 helper,讓 worker / UI 都看到同一個 source of truth。
 *
 * 序列化格式:
 *   summary 為 JSON 物件 → 解析出 { note, metadata }
 *   summary 為純文字     → fallback 為 { note: <原字串>, metadata: null }
 *
 * 寫回時:
 *   metadata 為 null → 直接回寫 note 純字串(legacy 行為)
 *   metadata 不為 null → 寫 JSON.stringify({ note, metadata })
 *
 * 這樣 legacy 場景仍能讀寫,新場景也能加環境參數,不需動 schema。
 */

export interface LocationMetadata {
  /** 場景類型 — 'interior' / 'exterior' */
  type?: string | null
  /** 風格分類 — '現代' / '古代' / '未來' / '奇幻' 等 */
  category?: string | null
  /** 天氣 — '晴天' / '陰天' / '雨天' / '雪天' / '霧' 等 */
  weather?: string | null
  /** 時間段 — '清晨' / '白天' / '黃昏' / '夜晚' 等 */
  timeOfDay?: string | null
  /** 光源類型 — '自然光' / '人工光' / '混合光' */
  lightSource?: string | null
  /** 光照方向 — '順光' / '側光' / '逆光' / '頂光' */
  lightDirection?: string | null
  /** 色溫 — '暖色調' / '冷色調' / '中性' */
  colorTone?: string | null
  /** 自由標籤 — 例如 '溫馨', '現代極簡', '工業風' */
  tags?: string[]
}

export interface ParsedLocationSummary {
  note: string
  metadata: LocationMetadata | null
}

const EMPTY: ParsedLocationSummary = { note: '', metadata: null }

export function parseLocationSummary(summary: string | null | undefined): ParsedLocationSummary {
  if (!summary) return EMPTY
  const trimmed = summary.trim()
  if (!trimmed) return EMPTY
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    return { note: summary, metadata: null }
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return { note: summary, metadata: null }
    }
    const obj = parsed as Record<string, unknown>
    if ('metadata' in obj || 'note' in obj) {
      return {
        note: typeof obj.note === 'string' ? obj.note : '',
        metadata: extractMetadata(obj.metadata),
      }
    }
    return { note: summary, metadata: null }
  } catch {
    return { note: summary, metadata: null }
  }
}

function extractMetadata(raw: unknown): LocationMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const out: LocationMetadata = {}
  let hasAny = false
  // Explicit per-field narrowing — Array<keyof T> with mixed value types
  // (string vs string[]) doesn't narrow `out[k] = v` even after typeof
  // string check, so we just enumerate.
  const readString = (key: 'type' | 'category' | 'weather' | 'timeOfDay' | 'lightSource' | 'lightDirection' | 'colorTone') => {
    const v = m[key]
    if (typeof v === 'string' && v.trim()) {
      out[key] = v.trim()
      hasAny = true
    }
  }
  readString('type')
  readString('category')
  readString('weather')
  readString('timeOfDay')
  readString('lightSource')
  readString('lightDirection')
  readString('colorTone')
  if (Array.isArray(m.tags)) {
    const tags = m.tags
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim())
    if (tags.length > 0) {
      out.tags = tags
      hasAny = true
    }
  }
  return hasAny ? out : null
}

export function stringifyLocationSummary(input: ParsedLocationSummary): string | null {
  const note = (input.note || '').trim()
  if (!input.metadata) return note || null
  return JSON.stringify({ note, metadata: input.metadata })
}

/**
 * Worker-side: convert metadata into a Chinese prompt prefix that the
 * image generator can latch onto. Order is the same the UI shows so
 * users can sanity-check by reading either side.
 */
export function metadataToPromptPrefix(meta: LocationMetadata | null | undefined): string {
  if (!meta) return ''
  const lines: string[] = []
  if (meta.type) lines.push(`【場景類型】${meta.type === 'interior' ? '內景' : meta.type === 'exterior' ? '外景' : meta.type}`)
  if (meta.category) lines.push(`【風格分類】${meta.category}`)
  if (meta.weather) lines.push(`【天氣】${meta.weather}`)
  if (meta.timeOfDay) lines.push(`【時間段】${meta.timeOfDay}`)
  if (meta.lightSource) lines.push(`【光源類型】${meta.lightSource}`)
  if (meta.lightDirection) lines.push(`【光照方向】${meta.lightDirection}`)
  if (meta.colorTone) lines.push(`【色溫】${meta.colorTone}`)
  if (meta.tags && meta.tags.length > 0) lines.push(`【標籤】${meta.tags.join('、')}`)
  return lines.join('\n')
}

export const LOCATION_METADATA_OPTIONS = {
  type: [
    { value: 'interior', label: '內景' },
    { value: 'exterior', label: '外景' },
  ],
  category: ['現代', '古代', '未來', '奇幻', '懸疑', '都會', '鄉村', '工業'],
  weather: ['晴天', '陰天', '多雲', '雨天', '雪天', '霧', '雷暴'],
  timeOfDay: ['清晨', '白天', '黃昏', '夜晚', '深夜'],
  lightSource: ['自然光', '人工光', '混合光', '燭光', '霓虹光'],
  lightDirection: ['順光', '側光', '逆光', '頂光', '底光'],
  colorTone: ['暖色調', '冷色調', '中性', '高對比', '低飽和'],
} as const
