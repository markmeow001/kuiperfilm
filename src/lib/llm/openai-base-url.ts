/**
 * Ensure an OpenAI-compatible base URL ends with a `/v1` path segment.
 *
 * Single source of truth used by BOTH the runtime provider config
 * (api-config.ts normalizeProviderBaseUrl) AND the ⚡ test-connection
 * (llm-test-connection.ts), so the connection test hits the same URL the
 * real LLM call uses. Before this was shared, the test used the raw base
 * URL (no /v1) and reported a false 401 for providers like X-AIO whose
 * gateway only serves /v1/* — even though generation worked. (2026-06-07)
 *
 * - No path / trailing slash → append `/v1`.
 * - A path already containing a `v1` segment → leave unchanged.
 * - A non-v1 sub-path (e.g. /openai) → append `/v1` after it.
 * - Invalid URL → return unchanged (don't hide a misconfiguration).
 */
export function ensureOpenAiV1Path(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.includes('v1')) return baseUrl
    const trimmedPath = parsed.pathname.replace(/\/+$/, '')
    parsed.pathname = `${trimmedPath === '' || trimmedPath === '/' ? '' : trimmedPath}/v1`
    return parsed.toString()
  } catch {
    return baseUrl
  }
}
