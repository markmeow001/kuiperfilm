import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

/**
 * Builds a minimal but structurally valid single-page PDF whose text layer
 * contains the given lines (one Tj op per line). Enough for pdf.js/unpdf to
 * parse and extract — no external fixture file needed.
 */
function buildPdf(lines: string[]): Buffer {
  const textOps = lines
    .map((line, i) => `BT /F1 12 Tf 50 ${750 - i * 20} Td (${line}) Tj ET`)
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${textOps.length} >>\nstream\n${textOps}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((content, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${content}\nendobj\n`
  })
  const xrefStart = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function postFile(bytes: Uint8Array, filename: string) {
  const form = new FormData()
  form.append('file', new File([bytes], filename, { type: 'application/pdf' }))
  const request = new NextRequest('http://localhost/api/files/extract-episodes', { method: 'POST', body: form })
  const mod = await import('@/app/api/files/extract-episodes/route')
  return mod.POST(request)
}

describe('extract-episodes PDF support', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
  })

  it('extracts text and EP markers from a PDF with a text layer', async () => {
    const pdf = buildPdf([
      'EP01 - THE HOLLOW ONE',
      'INT. ABANDONED WAREHOUSE - NIGHT',
      'A figure moves through the darkness, footsteps echoing in the dark.',
      'EP02 - THE RECKONING',
      'EXT. CITY ROOFTOP - DAWN',
      'The city wakes as our hero surveys the skyline below the clouds.',
    ])
    const response = await postFile(new Uint8Array(pdf), 'script.pdf')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.meta.sourceFormat).toBe('pdf')
    expect(body.rawText).toContain('EP01 - THE HOLLOW ONE')
    expect(body.rawText).toContain('EXT. CITY ROOFTOP - DAWN')
    expect(body.mode).toBe('markers')
    expect(body.episodes).toHaveLength(2)
    expect(body.episodes[0]).toMatchObject({ number: 1, title: 'EP01' })
    expect(body.episodes[1]).toMatchObject({ number: 2, title: 'EP02' })
  })

  it('rejects a .pdf file whose content is not a PDF', async () => {
    const response = await postFile(new TextEncoder().encode('plain text pretending to be pdf'), 'fake.pdf')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('PDF_CONTENT_INVALID')
  })

  it('rejects a PDF without a usable text layer (scanned pages)', async () => {
    const response = await postFile(new Uint8Array(buildPdf([])), 'scanned.pdf')
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('PDF_NO_TEXT_LAYER')
  })
})
