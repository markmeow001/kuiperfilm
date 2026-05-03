/**
 * Tencent Hunyuan LLM client.
 *
 * Calls hunyuan.tencentcloudapi.com using TC3-HMAC-SHA256 signing,
 * REUSING the same SecretId / SecretKey the admin already pasted for
 * Tencent VOD. This is deliberate: the user said "key 是內部人員給我
 * 的, 我沒辦法額外申請" — going through the OpenAI-compatible endpoint
 * (which needs its own bearer key) wasn't viable for them.
 *
 * Auth payload format (encrypted JSON in provider.apiKey, same shape
 * as tencent-vod minus subAppId):
 *
 *   { "secretId": "...", "secretKey": "...", "region": "ap-guangzhou" }
 *
 * Response is shaped like Tencent's native ChatCompletions:
 *
 *   { "Response": { "Choices": [{ "Message": { "Content": "..." }, ... }],
 *                   "Usage": { "PromptTokens": 1, "CompletionTokens": 2, ... } } }
 *
 * We translate that to OpenAI's `Chat.Completions.ChatCompletion` shape
 * so the rest of the codebase (which expects OpenAI shape) works
 * unmodified.
 *
 * Uses tencentcloud-sdk-nodejs-common's CommonClient — already a
 * transitive dep of tencentcloud-sdk-nodejs-vod, no new package install
 * needed.
 */
import type OpenAI from 'openai'

const HUNYUAN_ENDPOINT = 'hunyuan.tencentcloudapi.com'
const HUNYUAN_API_VERSION = '2023-09-01'
const DEFAULT_REGION = 'ap-guangzhou'

export interface HunyuanCredentials {
  secretId: string
  secretKey: string
  region?: string
}

export interface HunyuanChatOptions {
  temperature?: number
  topP?: number
  maxTokens?: number
}

interface TencentChatChoice {
  Index?: number
  FinishReason?: string
  Message?: {
    Role?: string
    Content?: string
    ReasoningContent?: string
  }
}

interface TencentChatResponse {
  Response: {
    Id?: string
    Created?: number
    Note?: string
    RequestId?: string
    Choices?: TencentChatChoice[]
    Usage?: {
      PromptTokens?: number
      CompletionTokens?: number
      TotalTokens?: number
    }
    Error?: { Code?: string; Message?: string }
  }
}

/**
 * Parse the JSON-encoded credential blob stored in provider.apiKey.
 * Same shape as tencent-vod's encoder so admins can paste once and
 * have both VOD and Hunyuan working off the same SecretId/SecretKey.
 */
export function parseHunyuanCredentials(apiKey: string): HunyuanCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(apiKey)
  } catch {
    throw new Error(
      'TENCENT_HUNYUAN_INVALID_CREDENTIALS: apiKey must be a JSON object with secretId/secretKey',
    )
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      'TENCENT_HUNYUAN_INVALID_CREDENTIALS: apiKey must be a JSON object',
    )
  }
  const obj = parsed as Record<string, unknown>
  const secretId = typeof obj.secretId === 'string' ? obj.secretId.trim() : ''
  const secretKey = typeof obj.secretKey === 'string' ? obj.secretKey.trim() : ''
  if (!secretId) throw new Error('TENCENT_HUNYUAN_INVALID_CREDENTIALS: missing secretId')
  if (!secretKey) throw new Error('TENCENT_HUNYUAN_INVALID_CREDENTIALS: missing secretKey')
  const region = typeof obj.region === 'string' && obj.region.trim()
    ? obj.region.trim()
    : DEFAULT_REGION
  return { secretId, secretKey, region }
}

interface CommonClientCtor {
  new (
    endpoint: string,
    version: string,
    options: {
      credential: { secretId: string; secretKey: string }
      region?: string
      profile?: { httpProfile?: { endpoint?: string } }
    },
  ): {
    request: (action: string, params: Record<string, unknown>) => Promise<unknown>
  }
}

let cachedCommonClient: CommonClientCtor | null = null

async function loadCommonClient(): Promise<CommonClientCtor> {
  if (cachedCommonClient) return cachedCommonClient
  // tencentcloud-sdk-nodejs-common is a transitive dep of -vod; we
  // don't want to add it to package.json explicitly. Lazy-load so a
  // user without it installed only fails when they actually try to
  // use Hunyuan (other LLM providers keep working).
  const mod = (await import('tencentcloud-sdk-nodejs-common')) as {
    Common?: { CommonClient?: CommonClientCtor }
    default?: { Common?: { CommonClient?: CommonClientCtor } }
  }
  const Common = mod.Common ?? mod.default?.Common
  if (!Common?.CommonClient) {
    throw new Error('TENCENT_HUNYUAN_SDK_MISSING: tencentcloud-sdk-nodejs-common.CommonClient not found')
  }
  cachedCommonClient = Common.CommonClient
  return cachedCommonClient
}

function tencentChatToOpenAi(
  raw: unknown,
  modelId: string,
): OpenAI.Chat.Completions.ChatCompletion {
  const tencent = raw as TencentChatResponse
  const resp = tencent.Response
  if (!resp) {
    throw new Error('TENCENT_HUNYUAN_BAD_RESPONSE: no Response field')
  }
  if (resp.Error?.Code) {
    throw new Error(
      `TENCENT_HUNYUAN_API_ERROR: ${resp.Error.Code} — ${resp.Error.Message ?? ''}`.trim(),
    )
  }

  const choices: OpenAI.Chat.Completions.ChatCompletion.Choice[] = (resp.Choices ?? []).map(
    (c, idx) => ({
      index: typeof c.Index === 'number' ? c.Index : idx,
      finish_reason: (c.FinishReason ?? 'stop') as OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'],
      message: {
        role: 'assistant',
        content: c.Message?.Content ?? '',
        // Hunyuan reasoning models (hunyuan-t1*) put think output in
        // ReasoningContent — surface it in the same shape ark / openai
        // reasoning models use so getCompletionParts picks it up.
        ...(c.Message?.ReasoningContent
          ? { reasoning_content: c.Message.ReasoningContent }
          : {}),
        refusal: null,
      } as OpenAI.Chat.Completions.ChatCompletion.Choice['message'],
      logprobs: null,
    }),
  )

  return {
    id: resp.Id ?? `hunyuan-${Date.now()}`,
    object: 'chat.completion',
    created: typeof resp.Created === 'number' ? resp.Created : Math.floor(Date.now() / 1000),
    model: modelId,
    choices,
    usage: {
      prompt_tokens: resp.Usage?.PromptTokens ?? 0,
      completion_tokens: resp.Usage?.CompletionTokens ?? 0,
      total_tokens: resp.Usage?.TotalTokens ?? 0,
    },
  }
}

export async function hunyuanChatCompletion(input: {
  apiKey: string
  modelId: string
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  options?: HunyuanChatOptions
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const creds = parseHunyuanCredentials(input.apiKey)
  const CommonClient = await loadCommonClient()

  const client = new CommonClient(HUNYUAN_ENDPOINT, HUNYUAN_API_VERSION, {
    credential: { secretId: creds.secretId, secretKey: creds.secretKey },
    region: creds.region,
    profile: { httpProfile: { endpoint: HUNYUAN_ENDPOINT } },
  })

  // Tencent uses PascalCase fields. Map our OpenAI-shaped messages.
  const tencentMessages = input.messages.map((m) => ({
    Role: m.role,
    Content: m.content,
  }))

  const params: Record<string, unknown> = {
    Model: input.modelId,
    Messages: tencentMessages,
    Stream: false,
  }
  if (typeof input.options?.temperature === 'number') {
    params.Temperature = input.options.temperature
  }
  if (typeof input.options?.topP === 'number') {
    params.TopP = input.options.topP
  }

  const raw = await client.request('ChatCompletions', params)
  return tencentChatToOpenAi(raw, input.modelId)
}
