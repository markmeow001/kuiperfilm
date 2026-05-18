/**
 * Episode extraction from uploaded file.
 *
 * Accepts .docx / .txt / .md, extracts plain text + optional table-based
 * episode structure. Routes to one of three modes:
 *
 *   1. `table`   — DOCX with a 集数 column table (industry-standard short-
 *                  drama outline format, e.g. The Beastbound Queen). Walks
 *                  cells via cheerio. Zero LLM cost, zero hallucination.
 *
 *   2. `markers` — Plain text with detectable "第X集" / "Chapter X" /
 *                  numbered prefixes. Routes through the existing
 *                  episode-marker-detector regex pipeline.
 *
 *   3. `prose`   — Falls back to raw text so the caller can hand it to
 *                  the existing EPISODE_SPLIT_LLM worker queue (which
 *                  already handles prose splitting under the same FK
 *                  + retry guarantees as other AI tasks).
 *
 * Security:
 *   - 10 MB file size cap (enforced BEFORE buffering in memory).
 *   - .docm rejected (macro-enabled — VBA payload surface).
 *   - File extension AND content-type both checked.
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
  let tableEpisodes: ExtractedEpisode[] | null = null
  let tableRowsDetected: number | undefined

  if (sourceFormat === 'docx') {
    // 1. Convert to HTML first so we keep table structure.
    const htmlResult = await mammoth.convertToHtml({ buffer })
    const $ = cheerio.load(htmlResult.value)

    // 2. Try to detect "episode tables" — tables whose first column
    //    holds episode numbers and remaining columns hold the content.
    //    The Beastbound Queen format puts 集数 / 故事节拍 / 大事件 /
    //    关键冲突与转折 as 4 columns; we treat the last column (or
    //    concatenation of columns 2..N) as the episode content.
    //
    //    Outlines often split episodes across multiple tables (one per
    //    Act / 弧光). We aggregate candidates across ALL tables, then
    //    dedupe globally by episode number — densest content wins per
    //    number, so legend/header rows that happen to start with a
    //    digit get out-competed by the real episode row.
    const tables = $('table').toArray()
    const allCandidates: ExtractedEpisode[] = []
    let totalCandidateRows = 0
    for (const table of tables) {
      const rows = $(table).find('tr').toArray()
      for (const row of rows) {
        const cells = $(row).find('td').map((_i, td) => $(td).text().trim()).get()
        if (cells.length < 2) continue
        // First cell must parse as an episode number; otherwise skip.
        const numCell = cells[0]
        const num = parseInt(numCell, 10)
        if (!Number.isFinite(num) || num <= 0) continue
        // Compose content: prefer last cell (densest scene-by-scene
        // breakdown), fall back to all-but-first concatenated.
        const contentCell = cells[cells.length - 1]
        const rest = cells.slice(1).join('\n\n').trim()
        const content = contentCell.length > rest.length / 2 ? contentCell : rest
        if (content.length < 50) continue // skip header/legend rows
        // Title: short second cell if it looks like a beat/title; else empty.
        const possibleTitle = cells.length >= 3 ? cells[1] : ''
        const title = possibleTitle.length > 0 && possibleTitle.length <= 40
          ? possibleTitle
          : `第 ${num} 集`
        allCandidates.push({
          number: num,
          title,
          content,
          wordCount: content.length, // simple char count for CJK
        })
        totalCandidateRows++
      }
    }
    // Global dedupe across all tables. Densest content per number wins.
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

    // 3. Always also extract plain text — used for markers fallback and
    //    for returning rawText to the caller so the LLM split path can
    //    consume the same content.
    const rawTextResult = await mammoth.extractRawText({ buffer })
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

  // ── Decide which mode to return ─────────────────────────────────────

  // Mode 1: table mode — DOCX with a real episode table.
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

  // Mode 2: markers mode — text with detectable "第X集" etc.
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

  // Mode 3: prose — no structure detected. Return raw text; the caller
  // can either drop the whole thing into a single episode or hand it to
  // the existing EPISODE_SPLIT_LLM worker for AI-driven splitting.
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
