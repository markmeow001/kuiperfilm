/**
 * Build a spec-safe `Content-Disposition: attachment` header value.
 *
 * HTTP header values are ByteStrings — any code point > 255 makes the WHATWG
 * `Response`/`Headers` constructor throw `TypeError: Invalid character in header
 * content`. A CJK filename placed directly in the quoted `filename="…"` param
 * therefore crashes the whole response (users saw the 500 saved as
 * `download.json`, "无法存取网站"). We emit an ASCII-only quoted fallback for
 * legacy clients + the real UTF-8 name via `filename*` (RFC 5987), which every
 * modern browser prefers anyway. The returned value is pure Latin-1.
 */
export function contentDispositionAttachment(filename: string): string {
  const asciiFallback =
    filename
      .replace(/[^\x20-\x7e]/g, '_') // non-ASCII (incl. CJK) → '_'
      .replace(/["\\]/g, '_')
      .trim() || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
