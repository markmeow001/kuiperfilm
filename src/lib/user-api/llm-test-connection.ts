import OpenAI from 'openai'
import { ApiError } from '@/lib/api-errors'
import { hunyuanChatCompletion, parseHunyuanCredentials } from '@/lib/llm/hunyuan-client'

type SupportedProvider =
  | 'openrouter'
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'custom'
  | 'tencent-hunyuan'
  | 'tencent-vod'

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
      // VOD / Hunyuan share the same Tencent credential format; normalise
      // the legacy 'vod' / 'tencent' keys onto 'tencent-vod' so the rest
      // of the switch only deals with two canonical names.
      if (provider === 'vod' || provider === 'tencent') return 'tencent-vod'
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
        baseURL: requireBaseUrl(payload),
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
  }
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
    Response?: { AppId?: number; OwnerUin?: string; Error?: { Code?: string; Message?: string } }
  }
  const err = raw?.Response?.Error
  if (err?.Code) {
    throw new Error(`TENCENT_API_ERROR: ${err.Code} — ${err.Message ?? ''}`.trim())
  }
  const appId = raw?.Response?.AppId
  return { model: appId ? `AppId ${appId}` : undefined }
}
