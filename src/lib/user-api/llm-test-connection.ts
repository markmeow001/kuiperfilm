import OpenAI from 'openai'
import { ApiError } from '@/lib/api-errors'
import { hunyuanChatCompletion, parseHunyuanCredentials } from '@/lib/llm/hunyuan-client'
import { ensureOpenAiV1Path } from '@/lib/llm/openai-base-url'

type SupportedProvider =
  | 'openrouter'
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'custom'
  | 'tencent-hunyuan'
  | 'tencent-vod'
  | 'taijiai'
  | 'fal'
  | 'atlascloud'
  | 'ark'

type TestConnectionPayload = {
  provider?: string
  apiKey?: string
  baseUrl?: string
  region?: string
  model?: string
}

export type LlmConnectionTestResult = {
  provider: SupportedProvider
  message: string
  model?: string
  answer?: string
}

function normalizeProvider(payload: TestConnectionPayload): SupportedProvider {
  const provider = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : ''
  if (!provider) {
    if (typeof payload.baseUrl === 'string' && payload.baseUrl.trim()) return 'custom'
    throw new ApiError('INVALID_PARAMS', { message: '缺少必要参数 provider' })
  }

  switch (provider) {
    case 'openrouter':
    case 'google':
    case 'anthropic':
    case 'openai':
    case 'custom':
    case 'tencent-hunyuan':
    case 'tencent-vod':
    case 'vod':
    case 'tencent':
    case 'taijiai':
    case 'fal':
    case 'atlascloud':
    case 'ark':
    case 'volcengine':
      // VOD / Hunyuan share the same Tencent credential format; normalise
      // the legacy 'vod' / 'tencent' keys onto 'tencent-vod' so the rest
      // of the switch only deals with two canonical names.
      if (provider === 'vod' || provider === 'tencent') return 'tencent-vod'
      // 'volcengine' is a common synonym for 'ark' on the docs side.
      if (provider === 'volcengine') return 'ark'
      return provider
    default:
      throw new ApiError('INVALID_PARAMS', { message: `不支持的渠道: ${provider}` })
  }
}

function requireApiKey(payload: TestConnectionPayload): string {
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!apiKey) {
    throw new ApiError('INVALID_PARAMS', { message: '缺少必要参数 apiKey' })
  }
  return apiKey
}

function requireBaseUrl(payload: TestConnectionPayload): string {
  const baseUrl = typeof payload.baseUrl === 'string' ? payload.baseUrl.trim() : ''
  if (!baseUrl) {
    throw new ApiError('INVALID_PARAMS', { message: '自定义渠道需要提供 baseUrl' })
  }
  return baseUrl
}

async function testGoogleAI(apiKey: string): Promise<void> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { method: 'GET' },
  )
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google AI 认证失败: ${error}`)
  }
}

async function testOpenAICompatibleConnection(params: {
  apiKey: string
  baseURL?: string
  model?: string
  defaultHeaders?: Record<string, string>
}): Promise<Pick<LlmConnectionTestResult, 'model' | 'answer'>> {
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    timeout: 30000,
    defaultHeaders: params.defaultHeaders,
  })

  if (params.model) {
    const response = await client.chat.completions.create({
      model: params.model,
      messages: [{ role: 'user', content: '1+1等于几？只回答数字' }],
      max_tokens: 10,
      temperature: 0,
    })
    const answer = response.choices[0]?.message?.content?.trim() || ''
    return {
      model: response.model || params.model,
      answer,
    }
  }

  await client.models.list()
  return {}
}

export async function testLlmConnection(payload: TestConnectionPayload): Promise<LlmConnectionTestResult> {
  const provider = normalizeProvider(payload)
  const apiKey = requireApiKey(payload)
  const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : ''

  switch (provider) {
    case 'openrouter': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        model: requestedModel || undefined,
      })
      return { provider, message: 'openrouter 连接成功', ...tested }
    }
    case 'google':
      await testGoogleAI(apiKey)
      return { provider, message: 'google 连接成功' }
    case 'anthropic': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        baseURL: 'https://api.anthropic.com/v1',
        model: requestedModel || 'claude-3-haiku-20240307',
        defaultHeaders: { 'anthropic-version': '2023-06-01' },
      })
      return { provider, message: 'anthropic 连接成功', ...tested }
    }
    case 'openai': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        model: requestedModel || undefined,
      })
      return { provider, message: 'openai 连接成功', ...tested }
    }
    case 'custom': {
      const tested = await testOpenAICompatibleConnection({
        apiKey,
        // Normalize to /v1 like the runtime provider config does, so the
        // test hits the same path the real LLM call uses (2026-06-07 — was
        // testing https://host/models, runtime uses https://host/v1/...).
        baseURL: ensureOpenAiV1Path(requireBaseUrl(payload)),
        model: requestedModel || undefined,
      })
      return { provider, message: 'custom 连接成功', ...tested }
    }
    case 'tencent-hunyuan': {
      const tested = await testTencentHunyuan(apiKey, requestedModel)
      return { provider, message: 'Tencent Hunyuan 连接成功', ...tested }
    }
    case 'tencent-vod': {
      const tested = await testTencentVOD(apiKey)
      return { provider, message: 'Tencent VOD 凭证有效', ...tested }
    }
    case 'taijiai': {
      await testTaijiai(apiKey)
      return { provider, message: 'BobAPI (taijiai) 凭证有效' }
    }
    case 'ark': {
      await testArk(apiKey)
      return { provider, message: 'Volcengine ARK (火山方舟) 凭证有效' }
    }
    case 'fal': {
      await testFal(apiKey)
      return { provider, message: 'fal.ai 凭证有效' }
    }
    case 'atlascloud': {
      await testAtlasCloud(apiKey)
      return { provider, message: 'AtlasCloud 凭证有效' }
    }
  }
}

async function testAtlasCloud(apiKey: string): Promise<void> {
  // AtlasCloud 没有 /models 列表端点；用「查询一个永远不存在的 prediction
  // id」当探针 —— 凭证有效会回 404 / 200（业务码非 200 但 HTTP 通），
  // 凭证失败则 401。和 fal / taijiai 一致的 cheapest-valid-probe 模式。
  const probeId = '00000000-0000-0000-0000-000000000000'
  const response = await fetch(
    `https://api.atlascloud.ai/api/v1/model/prediction/${probeId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  )
  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '')
    throw new Error(`ATLASCLOUD_AUTH_FAILED: ${text || 'Authentication failed'}`)
  }
  // 404 / 200 / 400 / 422 都视为 AtlasCloud 接受了 token，只是 prediction 不存在。
}

async function testFal(apiKey: string): Promise<void> {
  // fal.ai has no listing endpoint; the cheapest valid probe is a status
  // query for a UUID that will never exist. Behaviour with a real key:
  //   - 401 {"detail":"invalid key credentials"}  → well-shaped but rejected key
  //   - 401 {"detail":"Authentication is required"} → malformed / no key
  //   - 404                                       → auth OK, request id (correctly) not found
  // The 404 case is what we want; both 401 variants must throw.
  // We use fal-ai/fast-sdxl as the probe model because it has been
  // available since 2023 and is always reachable on the queue host.
  const probeId = '00000000-0000-0000-0000-000000000000'
  const response = await fetch(
    `https://queue.fal.run/fal-ai/fast-sdxl/requests/${probeId}/status`,
    { headers: { Authorization: `Key ${apiKey}` } },
  )
  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    // Surface fal's own error text so the user can distinguish "key
    // wrong" from "key missing/malformed" without re-reading the source.
    throw new Error(`FAL_AUTH_FAILED: ${text || 'Authentication failed'}`)
  }
  // 404 / 200 / 422 = auth accepted by the queue host. We do not need
  // to assert the body shape; the only signal we care about is "did fal
  // recognise the key".
}

// 2026-05-22 — ARK (Volcengine 火山方舟) connectivity probe.
// Free auth check: POST to /api/v3/contents/generations/tasks with an
// empty body. ARK returns:
//   401/403 → key bad
//   400 MissingParameter (model required) → key OK, endpoint reachable
//   5xx → service blip
// Confirms both Bearer auth and 中国大陆 ARK endpoint reachability without
// burning any 火山 token budget.
async function testArk(apiKey: string): Promise<void> {
  const response = await fetch(
    'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({}),
    },
  )
  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '')
    throw new Error(`ARK_AUTH_FAILED: ${text || 'Invalid API key'}`)
  }
  if (response.status >= 500) {
    throw new Error(`ARK_SERVICE_ERROR: ${response.status}`)
  }
  // 400 / 422 / any 2xx → auth passed.
}

async function testTaijiai(apiKey: string): Promise<void> {
  // BobAPI 没有 /models 之类的列表端点；最便宜的探针是查询一个
  // 几乎确定不存在的 video id —— 凭证有效会回 404/Invalid id，
  // 凭证失败会回 401 {"detail":"Invalid API key"}。
  const probeId = 'connection-test-' + Math.random().toString(36).slice(2, 10)
  const response = await fetch(
    `https://www.taijiai.online/v1/videos/${encodeURIComponent(probeId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  )
  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    throw new Error(`TAIJIAI_AUTH_FAILED: ${text || 'Invalid API key'}`)
  }
  // 404/422/200 都视为凭证已被 BobAPI 接受。
}

async function testTencentHunyuan(
  apiKey: string,
  requestedModel: string,
): Promise<Pick<LlmConnectionTestResult, 'model' | 'answer'>> {
  // Hunyuan apiKey is a JSON-stringified { secretId, secretKey, region }
  // — parseHunyuanCredentials enforces the shape; throws on bad format.
  parseHunyuanCredentials(apiKey)
  const model = requestedModel || 'hunyuan-turbos-latest'
  const resp = await hunyuanChatCompletion({
    apiKey,
    modelId: model,
    messages: [{ role: 'user', content: '1+1等于几？只回答数字' }],
    options: { temperature: 0 },
  })
  const answer = resp.choices[0]?.message?.content?.trim() || ''
  return { model: resp.model || model, answer }
}

async function testTencentVOD(apiKey: string): Promise<Pick<LlmConnectionTestResult, 'model'>> {
  // VOD shares the Hunyuan credential format (SecretId/SecretKey + region).
  // To validate without actually creating an AIGC video task, we call
  // cam.GetUserAppId — a free identity-verification endpoint that any
  // Tencent SecretId/SecretKey can hit. 401/403 here = bad creds.
  const creds = parseHunyuanCredentials(apiKey)
  const mod = (await import('tencentcloud-sdk-nodejs-common')) as {
    CommonClient?: new (
      endpoint: string,
      version: string,
      options: {
        credential: { secretId: string; secretKey: string }
        region?: string
        profile?: { httpProfile?: { endpoint?: string } }
      },
    ) => { request: (action: string, params: Record<string, unknown>) => Promise<unknown> }
    default?: { CommonClient?: unknown }
  }
  const CommonClient = mod.CommonClient
    ?? (mod.default as { CommonClient?: typeof mod.CommonClient } | undefined)?.CommonClient
  if (!CommonClient) {
    throw new Error('TENCENT_SDK_MISSING: tencentcloud-sdk-nodejs-common.CommonClient not found')
  }
  const client = new CommonClient('cam.tencentcloudapi.com', '2019-01-16', {
    credential: { secretId: creds.secretId, secretKey: creds.secretKey },
    region: creds.region,
    profile: { httpProfile: { endpoint: 'cam.tencentcloudapi.com' } },
  })
  const raw = await client.request('GetUserAppId', {}) as {
    Response?: Record<string, unknown> & { Error?: { Code?: string; Message?: string } }
  }
  const resp = raw?.Response
  const err = resp?.Error
  if (err?.Code) {
    throw new Error(`TENCENT_API_ERROR: ${err.Code} — ${err.Message ?? ''}`.trim())
  }
  // CAM's CommonClient response casing has varied across SDK versions —
  // sometimes AppId, sometimes appId. Walk both casings; also fall back
  // to OwnerUin so the user gets something concrete back even if Tencent
  // ships a different shape next time.
  const appId = (resp?.AppId ?? resp?.appId ?? resp?.Appid) as number | string | undefined
  const ownerUin = (resp?.OwnerUin ?? resp?.ownerUin) as string | undefined
  const label = appId !== undefined
    ? `AppId ${appId}`
    : ownerUin !== undefined
      ? `Uin ${ownerUin}`
      : undefined
  return { model: label }
}
