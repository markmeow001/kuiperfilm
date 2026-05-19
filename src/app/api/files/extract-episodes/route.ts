/**
 * Episode extraction from uploaded file.
 *
 * Accepts .docx / .txt / .md. Tries detection in this order:
 *
 *   1. `ep`      — EP01 / EP02 / EP 03 — TITLE markers. Industry-standard
 *                  for mixed-language pro scripts (a leading 三幕大綱
 *                  table sits ABOVE the EP markers and would otherwise
 *                  hijack table mode). Optional anchor heading like
 *                  "四、剧本" / "剧本" / "SCREENPLAY" / "SCRIPT" lets us
 *                  skip the outline/character sections entirely.
 *
 *   2. `table`   — DOCX with a 集数 column table (e.g. The Beastbound
 *                  Queen). Walks cells via cheerio. Zero LLM cost.
 *
 *   3. `markers` — Other text markers: "第X集" / "Chapter X" / numeric
 *                  prefixes. Routes through existing
 *                  episode-marker-detector regex pipeline.
 *
 *   4. `prose`   — Falls back to raw text so the caller can hand it to
 *                  the existing EPISODE_SPLIT_LLM worker queue.
 *
 * Security:
 *   - 10 MB file size cap (enforced BEFORE buffering in memory).
 *   - .docm rejected (macro-enabled — VBA payload surface).
 *   - mammoth's xmldom does not resolve external entities (no XXE).
 *   - Filename is never echoed into the response or downstream prompt.
 */

import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
import * as cheerio from 'cheerio'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { detectEpisodeMarkers, splitByMarkers } from '@/lib/episode-marker-detector'
import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'api.files.extract_episodes' })

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

interface ExtractedEpisode {
  number: number
  title: string
  content: string
  wordCount: number
}

/**
 * Find the offset where the screenplay section starts. Returns 0 when no
 * anchor is found, which means the whole text is considered. Patterns
 * cover both Chinese ("四、剧本", "剧本部分", "【剧本】") and English
 * ("SCRIPT", "SCREENPLAY") section headers, plus the typical opening
 * pattern of a US screenplay slug line ("INT./EXT. ... — DAY/NIGHT").
 */
function findScriptAnchorOffset(plainText: string): number {
  // Chinese: "四、剧本" / "剧本" as a heading line / "【剧本】" / "剧本部分"
  // Use multiline so we don't match the word "剧本" embedded in prose.
  const cnAnchor = /^[\s ]*(?:[一二三四五六七八九十]+[、,，.]\s*)?(?:剧本|劇本)(?:部分|內容)?\s*$|【\s*剧本\s*】/m
  const cnMatch = cnAnchor.exec(plainText)
  if (cnMatch) return cnMatch.index + cnMatch[0].length

  // English: a SCRIPT / SCREENPLAY heading line on its own
  const enAnchor = /^[\s ]*(?:THE\s+)?(?:SCRIPT|SCREENPLAY)\s*$/m
  const enMatch = enAnchor.exec(plainText)
  if (enMatch) return enMatch.index + enMatch[0].length

  return 0
}

/**
 * Detect EP01 / EP 02 / EP 03 — TITLE markers. Returns null when fewer
 * than 2 distinct EP markers exist (so caller can fall back).
 *
 * Title format: "EP01" by default. If the marker line carries a tail
 * (e.g. "EP01 — 'THE HOLLOW ONE'"), the tail is appended after a single
 * em-dash separator so the workspace tab reads "EP01 — THE HOLLOW ONE".
 */
function extractEpMarkerEpisodes(plainText: string): {
  episodes: ExtractedEpisode[]
  anchorUsed: boolean
} | null {
  const anchorOffset = findScriptAnchorOffset(plainText)
  const searchText = anchorOffset > 0 ? plainText.slice(anchorOffset) : plainText

  // Match "EP" + optional space + digits anchored at line start. Capture
  // the rest of the line so we can preserve any "— TITLE" suffix the
  // author wrote on the same line.
  const epRegex = /^[\s\t]*EP\s*(\d+)([^\n]*)/gim
  const rawMatches: Array<{
    number: number
    titleRest: string
    start: number
    lineEnd: number
  }> = []
  let m: RegExpExecArray | null
  while ((m = epRegex.exec(searchText)) !== null) {
    rawMatches.push({
      number: parseInt(m[1], 10),
      titleRest: m[2] ?? '',
      start: m.index,
      lineEnd: m.index + m[0].length,
    })
  }

  if (rawMatches.length < 2) return null

  // Drop EP markers whose number repeats. Keep the LAST occurrence per
  // number — author may have a "EP01 — title" line that appears twice
  // (table-of-contents header + actual section start); the actual scene
  // text always follows the deeper one.
  const byNumber = new Map<number, typeof rawMatches[number]>()
  for (const r of rawMatches) byNumber.set(r.number, r)
  const matches = Array.from(byNumber.values()).sort((a, b) => a.start - b.start)
  if (matches.length < 2) return null

  const episodes: ExtractedEpisode[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].lineEnd
    const end = i + 1 < matches.length ? matches[i + 1].start : searchText.length
    const content = searchText.slice(start, end).trim()
    if (content.length < 50) continue // skip stub / TOC-only markers

    const padded = `EP${String(matches[i].number).padStart(2, '0')}`
    const tail = matches[i].titleRest.replace(/^[\s\-—–:：]+/, '').trim()
    const title = tail ? `${padded} — ${tail}` : padded

    episodes.push({
      number: matches[i].number,
      title,
      content,
      wordCount: content.length, // simple char count for CJK
    })
  }

  return episodes.length >= 2 ? { episodes, anchorUsed: anchorOffset > 0 } : null
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > MAX_FILE_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_TOO_LARGE',
      details: { maxBytes: MAX_FILE_BYTES, gotBytes: contentLength },
    })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('INVALID_PARAMS', { code: 'FILE_REQUIRED' })
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_TOO_LARGE',
      details: { maxBytes: MAX_FILE_BYTES, gotBytes: file.size },
    })
  }

  const filename = typeof file.name === 'string' ? file.name : ''
  const lowerName = filename.toLowerCase()
  // .docm = macro-enabled DOCX. Reject — VBA execution surface.
  if (lowerName.endsWith('.docm')) {
    throw new ApiError('INVALID_PARAMS', { code: 'MACRO_DOCX_REJECTED' })
  }

  let sourceFormat: 'docx' | 'txt' | 'md'
  if (lowerName.endsWith('.docx')) {
    sourceFormat = 'docx'
  } else if (lowerName.endsWith('.txt')) {
    sourceFormat = 'txt'
  } else if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    sourceFormat = 'md'
  } else {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_TYPE_UNSUPPORTED',
      details: { supported: ['.docx', '.txt', '.md'] },
    })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let plainText = ''
  let docxHtml: string | null = null

  if (sourceFormat === 'docx') {
    const [htmlResult, rawTextResult] = await Promise.all([
      mammoth.convertToHtml({ buffer }),
      mammoth.extractRawText({ buffer }),
    ])
    docxHtml = htmlResult.value
    plainText = rawTextResult.value
  } else {
    // txt / md — straight UTF-8 decode. Strip BOM if present.
    plainText = buffer.toString('utf-8').replace(/^﻿/, '')
  }

  if (!plainText || plainText.trim().length < 50) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FILE_EMPTY_OR_TOO_SHORT',
      details: { plainTextChars: plainText.length },
    })
  }

  // ── Mode 1: EP\d+ markers (highest priority) ────────────────────────
  //
  // Industry-format pro scripts have an outline table + character roster
  // BEFORE the actual EP01/EP02… screenplay section. EP markers always
  // win when present — otherwise the table walker below would hijack
  // the upload with the outline beats.

  const epResult = extractEpMarkerEpisodes(plainText)
  if (epResult) {
    logger.info({
      action: 'extract_episodes.ep_markers',
      message: 'episodes extracted via EP\\d+ markers',
      details: {
        sourceFormat,
        plainTextChars: plainText.length,
        episodeCount: epResult.episodes.length,
        anchorUsed: epResult.anchorUsed,
      },
    })
    return NextResponse.json({
      mode: 'markers',
      episodes: epResult.episodes,
      rawText: plainText,
      meta: {
        sourceFormat,
        plainTextChars: plainText.length,
        markerType: epResult.anchorUsed ? 'EP\\d+ (after 剧本 anchor)' : 'EP\\d+',
      },
    })
  }

  // ── Mode 2: table mode (Beastbound Queen 集数 format) ───────────────

  let tableEpisodes: ExtractedEpisode[] | null = null
  let tableRowsDetected: number | undefined

  if (sourceFormat === 'docx' && docxHtml) {
    const $ = cheerio.load(docxHtml)
    // Try to detect "episode tables" — tables whose first column holds
    // episode numbers and remaining columns hold the content. Beastbound
    // Queen format puts 集数 / 故事节拍 / 大事件 / 关键冲突与转折 as 4
    // columns; we treat the last column (or concatenation of columns
    // 2..N) as the episode content.
    //
    // Outlines often split episodes across multiple tables (one per Act).
    // We aggregate candidates across ALL tables, then dedupe globally by
    // episode number — densest content wins per number, so legend rows
    // get out-competed by the real episode row.
    const tables = $('table').toArray()
    const allCandidates: ExtractedEpisode[] = []
    let totalCandidateRows = 0
    for (const table of tables) {
      const rows = $(table).find('tr').toArray()
      for (const row of rows) {
        const cells = $(row).find('td').map((_i, td) => $(td).text().trim()).get()
        if (cells.length < 2) continue
        const numCell = cells[0]
        const num = parseInt(numCell, 10)
        if (!Number.isFinite(num) || num <= 0) continue
        const contentCell = cells[cells.length - 1]
        const rest = cells.slice(1).join('\n\n').trim()
        const content = contentCell.length > rest.length / 2 ? contentCell : rest
        // Raised from 50 to 200 chars — outline / three-act beat tables
        // typically have summary cells in the 100-200 char range; real
        // episode-content cells in 集数 tables run 400-1500+ chars.
        if (content.length < 200) continue
        const possibleTitle = cells.length >= 3 ? cells[1] : ''
        const title = possibleTitle.length > 0 && possibleTitle.length <= 40
          ? possibleTitle
          : `第 ${num} 集`
        allCandidates.push({
          number: num,
          title,
          content,
          wordCount: content.length,
        })
        totalCandidateRows++
      }
    }
    if (allCandidates.length >= 2) {
      const byNumber = new Map<number, ExtractedEpisode>()
      for (const ep of allCandidates) {
        const existing = byNumber.get(ep.number)
        if (!existing || ep.content.length > existing.content.length) {
          byNumber.set(ep.number, ep)
        }
      }
      tableEpisodes = Array.from(byNumber.values()).sort((a, b) => a.number - b.number)
      tableRowsDetected = totalCandidateRows
    }
  }

  if (tableEpisodes && tableEpisodes.length >= 2) {
    logger.info({
      action: 'extract_episodes.table',
      message: 'episodes extracted from DOCX table',
      details: {
        sourceFormat,
        plainTextChars: plainText.length,
        episodeCount: tableEpisodes.length,
        tableRowsDetected,
      },
    })
    return NextResponse.json({
      mode: 'table',
      episodes: tableEpisodes,
      rawText: plainText,
      meta: {
        sourceFormat,
        plainTextChars: plainText.length,
        tableRowsDetected,
      },
    })
  }

  // ── Mode 3: other markers (第X集 / Chapter X / numbered prefix) ─────

  const markerResult = detectEpisodeMarkers(plainText)
  if (markerResult.hasMarkers && markerResult.matches.length >= 2) {
    const markerEpisodes = splitByMarkers(plainText, markerResult).map<ExtractedEpisode>(
      (ep) => ({
        number: ep.number,
        title: ep.title,
        content: ep.content,
        wordCount: ep.wordCount,
      }),
    )
    logger.info({
      action: 'extract_episodes.markers',
      message: 'episodes extracted via marker detection',
      details: {
        sourceFormat,
        plainTextChars: plainText.length,
        episodeCount: markerEpisodes.length,
        markerType: markerResult.markerType,
        confidence: markerResult.confidence,
      },
    })
    return NextResponse.json({
      mode: 'markers',
      episodes: markerEpisodes,
      rawText: plainText,
      meta: {
        sourceFormat,
        plainTextChars: plainText.length,
        markerType: markerResult.markerType,
      },
    })
  }

  // ── Mode 4: prose ───────────────────────────────────────────────────
  //
  // No structure detected. Return raw text; the caller can either drop
  // the whole thing into a single episode or hand it to the existing
  // EPISODE_SPLIT_LLM worker for AI-driven splitting.

  logger.info({
    action: 'extract_episodes.prose',
    message: 'no structure detected, returning raw text for caller-side split',
    details: {
      sourceFormat,
      plainTextChars: plainText.length,
    },
  })
  return NextResponse.json({
    mode: 'prose',
    episodes: [],
    rawText: plainText,
    meta: {
      sourceFormat,
      plainTextChars: plainText.length,
    },
  })
})
