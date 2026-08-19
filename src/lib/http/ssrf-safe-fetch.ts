import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

export type SsrfSafeFetchErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'BLOCKED_HOST'
  | 'BLOCKED_ADDRESS'
  | 'DNS_FAILED'
  | 'NETWORK_FAILED'
  | 'TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_REDIRECT'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'INVALID_CONTENT_LENGTH'
  | 'RESPONSE_TOO_LARGE'

export class SsrfSafeFetchError extends Error {
  readonly code: SsrfSafeFetchErrorCode

  constructor(code: SsrfSafeFetchErrorCode) {
    super(code)
    this.name = 'SsrfSafeFetchError'
    this.code = code
  }
}

export interface SsrfSafeFetchOptions {
  timeoutMs: number
  maxResponseBytes: number
  allowedContentTypes: readonly string[]
  maxRedirects?: number
  /**
   * Exact origins generated from server-controlled storage configuration.
   * This is intentionally origin-scoped so a redirect never inherits trust.
   * Never populate it from a caller-supplied URL.
   */
  trustedInternalOrigins?: readonly string[]
}

export interface ResolvedOutboundAddress {
  address: string
  family: 4 | 6
}

interface SsrfSafeTransportContext {
  addresses: readonly ResolvedOutboundAddress[]
  signal: AbortSignal
}

export type SsrfSafeFetchTransport = (
  url: URL,
  context: SsrfSafeTransportContext,
) => Promise<Response>

interface SsrfSafeFetcherDependencies {
  resolveHost(hostname: string): Promise<readonly ResolvedOutboundAddress[]>
  transport: SsrfSafeFetchTransport
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_REDIRECTS = 3
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'instance-data',
  'metadata.google.internal',
  'metadata.aws.internal',
  'metadata.azure.internal',
])

const blockedAddresses = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function mappedIpv4Address(address: string): string | null {
  let normalized = address.toLowerCase().split('%', 1)[0]
  // DNS implementations are allowed to return the expanded spelling
  // (`0:0:0:0:0:ffff:7f00:1`). Canonicalise before recognising the mapped
  // prefix so an alternate textual representation cannot bypass the private
  // IPv4 checks. Do not add the whole mapped subnet to Node's BlockList:
  // BlockList internally represents ordinary IPv4 addresses as mapped IPv6,
  // which would accidentally reject every public IPv4 address too.
  if (isIP(normalized) === 6) {
    try {
      normalized = new URL(`http://[${normalized}]/`).hostname
        .replace(/^\[|\]$/g, '')
        .toLowerCase()
    } catch {
      return null
    }
  }
  if (!normalized.startsWith('::ffff:')) return null
  const tail = normalized.slice('::ffff:'.length)
  if (isIP(tail) === 4) return tail

  const parts = tail.split(':')
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const high = Number.parseInt(parts[0], 16)
  const low = Number.parseInt(parts[1], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

export function isBlockedOutboundAddress(address: string): boolean {
  const normalized = normalizeHostname(address).split('%', 1)[0]
  const mapped = mappedIpv4Address(normalized)
  if (mapped) return blockedAddresses.check(mapped, 'ipv4')

  const family = isIP(normalized)
  if (family === 4) return blockedAddresses.check(normalized, 'ipv4')
  if (family === 6) return blockedAddresses.check(normalized, 'ipv6')
  return true
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return BLOCKED_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost')
}

function parseOutboundUrl(input: string | URL): URL {
  let parsed: URL
  try {
    parsed = input instanceof URL ? new URL(input.toString()) : new URL(input)
  } catch {
    throw new SsrfSafeFetchError('INVALID_URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfSafeFetchError('UNSUPPORTED_PROTOCOL')
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new SsrfSafeFetchError('INVALID_URL')
  }
  return parsed
}

async function defaultResolveHost(hostname: string): Promise<readonly ResolvedOutboundAddress[]> {
  const normalized = normalizeHostname(hostname)
  const family = isIP(normalized)
  if (family === 4 || family === 6) {
    return [{ address: normalized, family }]
  }
  const addresses = await dnsLookup(normalized, { all: true, verbatim: true })
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }))
}

function createPinnedLookup(addresses: readonly ResolvedOutboundAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : 0
    const candidates = requestedFamily === 0
      ? [...addresses]
      : addresses.filter((entry) => entry.family === requestedFamily)
    if (candidates.length === 0) {
      const error = Object.assign(new Error('No validated address for requested family'), {
        code: 'EAI_ADDRFAMILY',
      }) as NodeJS.ErrnoException
      callback(error, '', 0)
      return
    }
    if (options.all) {
      callback(null, candidates)
      return
    }
    callback(null, candidates[0].address, candidates[0].family)
  }
}

function responseHeadersFromNode(headers: import('node:http').IncomingHttpHeaders): Headers {
  const result = new Headers()
  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ])
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || hopByHop.has(name.toLowerCase())) continue
    result.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return result
}

const defaultTransport: SsrfSafeFetchTransport = async (url, { addresses, signal }) => {
  return await new Promise<Response>((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(url, {
      method: 'GET',
      agent: false,
      signal,
      lookup: createPinnedLookup(addresses),
      headers: {
        accept: 'video/*, application/octet-stream;q=0.8',
      },
    }, (upstream) => {
      const status = upstream.statusCode || 502
      const hasBody = ![101, 204, 205, 304].includes(status)
      const body = hasBody
        ? Readable.toWeb(upstream) as ReadableStream<Uint8Array>
        : null
      resolve(new Response(body, {
        status,
        statusText: upstream.statusMessage,
        headers: responseHeadersFromNode(upstream.headers),
      }))
    })
    req.once('error', reject)
    req.end()
  })
}

function waitForAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function normalizedTrustedOrigins(values: readonly string[] | undefined): Set<string> {
  const origins = new Set<string>()
  for (const value of values ?? []) {
    try {
      const url = parseOutboundUrl(value)
      origins.add(url.origin)
    } catch {
      // A malformed server configuration must not create a trust exception.
    }
  }
  return origins
}

function contentTypeAllowed(value: string, allowlist: readonly string[]): boolean {
  const normalized = value.split(';', 1)[0].trim().toLowerCase()
  if (!normalized) return false
  return allowlist.some((entry) => {
    const allowed = entry.trim().toLowerCase()
    if (allowed.endsWith('/*')) return normalized.startsWith(`${allowed.slice(0, -1)}`)
    return normalized === allowed
  })
}

function limitedResponseBody(input: {
  body: ReadableStream<Uint8Array>
  signal: AbortSignal
  maxBytes: number
  onFinished(): void
}): ReadableStream<Uint8Array> {
  const reader = input.body.getReader()
  let receivedBytes = 0
  let finished = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const finish = () => {
    if (finished) return
    finished = true
    input.signal.removeEventListener('abort', onAbort)
    input.onFinished()
  }
  const onAbort = () => {
    if (finished) return
    const reason = input.signal.reason instanceof Error
      ? input.signal.reason
      : new SsrfSafeFetchError('TIMEOUT')
    finish()
    void reader.cancel(reason).catch(() => undefined)
    controllerRef?.error(reason)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      input.signal.addEventListener('abort', onAbort, { once: true })
      if (input.signal.aborted) onAbort()
    },
    async pull(controller) {
      if (finished) return
      try {
        const result = await reader.read()
        if (finished) return
        if (result.done) {
          finish()
          controller.close()
          return
        }
        receivedBytes += result.value.byteLength
        if (receivedBytes > input.maxBytes) {
          const error = new SsrfSafeFetchError('RESPONSE_TOO_LARGE')
          finish()
          void reader.cancel(error).catch(() => undefined)
          controller.error(error)
          return
        }
        controller.enqueue(result.value)
      } catch (error) {
        if (finished) return
        finish()
        controller.error(error)
      }
    },
    cancel(reason) {
      finish()
      return reader.cancel(reason)
    },
  })
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  if (!/^\d+$/.test(value.trim())) throw new SsrfSafeFetchError('INVALID_CONTENT_LENGTH')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SsrfSafeFetchError('INVALID_CONTENT_LENGTH')
  }
  return parsed
}

export function createSsrfSafeFetcher(
  overrides: Partial<SsrfSafeFetcherDependencies> = {},
) {
  const dependencies: SsrfSafeFetcherDependencies = {
    resolveHost: overrides.resolveHost ?? defaultResolveHost,
    transport: overrides.transport ?? defaultTransport,
  }

  return async function fetchPublicResource(
    input: string | URL,
    options: SsrfSafeFetchOptions,
  ): Promise<Response> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new SsrfSafeFetchError('TIMEOUT')
    }
    if (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0) {
      throw new SsrfSafeFetchError('RESPONSE_TOO_LARGE')
    }
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
    if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
      throw new SsrfSafeFetchError('INVALID_REDIRECT')
    }
    const trustedOrigins = normalizedTrustedOrigins(options.trustedInternalOrigins)
    let current = parseOutboundUrl(input)

    const abortController = new AbortController()
    const timeout = setTimeout(() => {
      abortController.abort(new SsrfSafeFetchError('TIMEOUT'))
    }, options.timeoutMs)
    const finish = () => clearTimeout(timeout)
    let redirectCount = 0
    let responseHandedOff = false

    try {
      while (true) {
        const trustedInternalOrigin = trustedOrigins.has(current.origin)
        if (!trustedInternalOrigin && isBlockedHostname(current.hostname)) {
          throw new SsrfSafeFetchError('BLOCKED_HOST')
        }

        let addresses: readonly ResolvedOutboundAddress[]
        try {
          addresses = await waitForAbortable(
            dependencies.resolveHost(normalizeHostname(current.hostname)),
            abortController.signal,
          )
        } catch (error) {
          if (abortController.signal.aborted) throw abortController.signal.reason
          if (error instanceof SsrfSafeFetchError) throw error
          throw new SsrfSafeFetchError('DNS_FAILED')
        }
        if (addresses.length === 0) throw new SsrfSafeFetchError('DNS_FAILED')
        if (!trustedInternalOrigin && addresses.some((entry) => isBlockedOutboundAddress(entry.address))) {
          throw new SsrfSafeFetchError('BLOCKED_ADDRESS')
        }

        let response: Response
        try {
          response = await waitForAbortable(
            dependencies.transport(current, {
              addresses,
              signal: abortController.signal,
            }),
            abortController.signal,
          )
        } catch (error) {
          if (abortController.signal.aborted) throw abortController.signal.reason
          if (error instanceof SsrfSafeFetchError) throw error
          throw new SsrfSafeFetchError('NETWORK_FAILED')
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          if (redirectCount >= maxRedirects) {
            void response.body?.cancel().catch(() => undefined)
            throw new SsrfSafeFetchError('TOO_MANY_REDIRECTS')
          }
          const location = response.headers.get('location')
          void response.body?.cancel().catch(() => undefined)
          if (!location) throw new SsrfSafeFetchError('INVALID_REDIRECT')
          try {
            current = parseOutboundUrl(new URL(location, current))
          } catch (error) {
            if (error instanceof SsrfSafeFetchError) throw error
            throw new SsrfSafeFetchError('INVALID_REDIRECT')
          }
          redirectCount += 1
          continue
        }

        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? ''
          if (!contentTypeAllowed(contentType, options.allowedContentTypes)) {
            void response.body?.cancel().catch(() => undefined)
            throw new SsrfSafeFetchError('UNSUPPORTED_CONTENT_TYPE')
          }

          const contentLength = parseContentLength(response.headers.get('content-length'))
          if (contentLength !== null && contentLength > options.maxResponseBytes) {
            void response.body?.cancel().catch(() => undefined)
            throw new SsrfSafeFetchError('RESPONSE_TOO_LARGE')
          }
        }

        if (!response.body) {
          finish()
          responseHandedOff = true
          return response
        }
        const body = limitedResponseBody({
          body: response.body,
          signal: abortController.signal,
          maxBytes: options.maxResponseBytes,
          onFinished: finish,
        })
        responseHandedOff = true
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
    } finally {
      if (!responseHandedOff) finish()
    }
  }
}

export const fetchPublicResource = createSsrfSafeFetcher()
