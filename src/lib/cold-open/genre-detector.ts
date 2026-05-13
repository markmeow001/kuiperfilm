/**
 * Heuristic genre detection for cold-open variant selection.
 *
 * Phase 1 = keyword scan over the group's panel text + character names
 * + scene names. Phase 3 will replace this with an LLM-tagged genre
 * stored on NovelPromotionEpisode (see design doc §4 Phase 3).
 *
 * Precedence: action > period > modern. Rationale: explicit violence /
 * disaster framing benefits from the action variant even when the
 * setting is also period (battle scene in a wuxia drama). Pure period
 * cultivation falls back to the period variant. Modern is the default.
 */

import type { ColdOpenVariant } from './types'

const PERIOD_KEYWORDS = [
  '古装', '古裝', '仙', '修真', '修仙', '洞府',
  '皇上', '皇帝', '宫殿', '宮殿', '宫', '宮',
  '王朝', '剑', '劍', '袍', '丹药', '丹藥',
  '宗门', '宗門', '弟子', '元婴', '元嬰',
  '法宝', '法寶', '神器', '飞剑', '飛劍',
  '玄', '道', '禅', '禪', '阵法', '陣法',
]

const ACTION_KEYWORDS = [
  '战斗', '戰鬥', '雷劫', '妖兽', '妖獸',
  '废墟', '廢墟', '追逐', '战场', '戰場',
  '爆炸', '杀', '殺', '血', '伤', '傷',
  '攻击', '攻擊', '袭击', '襲擊',
  '危机', '危機', '灾', '災',
]

const MODERN_KEYWORDS = [
  '咖啡', '公司', '办公', '辦公',
  'CEO', '总裁', '總裁', '富豪',
  '亿万', '億萬', '婚', '電話', '电话',
  '手机', '手機', '汽车', '汽車',
  '机场', '機場', '酒店', '医院', '醫院',
  '银行', '銀行', '股票', '会议', '會議',
]

interface GenreScore {
  action: number
  period: number
  modern: number
}

function scoreKeywords(textBlob: string): GenreScore {
  const haystack = textBlob.toLowerCase()
  const score: GenreScore = { action: 0, period: 0, modern: 0 }
  for (const kw of ACTION_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) score.action++
  }
  for (const kw of PERIOD_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) score.period++
  }
  for (const kw of MODERN_KEYWORDS) {
    if (haystack.includes(kw.toLowerCase())) score.modern++
  }
  return score
}

/**
 * Detect the best cold-open variant from a free-text blob.
 *
 * Threshold logic:
 *   - action score >= 2 AND action >= period → action (violence dominates)
 *   - period > modern → period
 *   - otherwise → modern (default for ambiguous / contemporary cases)
 *
 * @param textBlob Concatenated panel descriptions, character names, and
 *                 scene names. Caller is responsible for stitching.
 */
export function detectColdOpenGenre(textBlob: string): ColdOpenVariant {
  const score = scoreKeywords(textBlob)
  if (score.action >= 2 && score.action >= score.period) return 'action'
  if (score.period > score.modern) return 'period'
  return 'modern'
}

/** Exported for tests and admin tooling. */
export function scoreColdOpenGenres(textBlob: string): GenreScore {
  return scoreKeywords(textBlob)
}
