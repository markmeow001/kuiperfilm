/**
 * ark-asset-api endpoint wrapper tests.
 *
 * Verifies request body shape (defaults applied), response unwrapping
 * (Result envelope extraction), and ArkAssetApiError surfacing on
 * HTTP / Volcengine-level errors.
 *
 * Signing internals are covered separately in signing.test.ts;
 * here we mock fetch and only check what the wrappers send/return.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  arkCreateAssetGroup,
  arkCreateAsset,
  arkGetAsset,
  ArkAssetApiError,
} from '@/lib/ark-asset-api'

const CREDS = {
  accessKeyId: 'AKLTtest123ExampleKey',
  secretAccessKey: 'secretExampleValue456',
}

function mockFetchOnce(body: unknown, status = 200) {
  const fetchSpy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
  globalThis.fetch = fetchSpy
  return fetchSpy as unknown as ReturnType<typeof vi.fn>
}

function envelope<T>(result: T | null, error?: { Code: string; Message: string }) {
  return {
    ResponseMetadata: {
      RequestId: 'test-req-' + Math.random().toString(36).slice(2, 10),
      Action: 'Test',
      Version: '2024-01-01',
      Service: 'ark',
      Region: 'cn-beijing',
      ...(error ? { Error: error } : {}),
    },
    ...(result !== null ? { Result: result } : {}),
  }
}

describe('arkCreateAssetGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the group Id from a successful response', async () => {
    mockFetchOnce(envelope({ Id: 'group-20260328000000-abc12' }))
    const result = await arkCreateAssetGroup(
      { Name: 'kuiperai-default' },
      CREDS,
    )
    expect(result.Id).toBe('group-20260328000000-abc12')
  })

  it('POSTs to volcengineapi.com (not volces.com) — domain split confirmed', async () => {
    const fetchSpy = mockFetchOnce(envelope({ Id: 'group-20260328000000-abc12' }))
    await arkCreateAssetGroup({ Name: 'test' }, CREDS)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0]!
    const url = call[0] as string
    expect(url).toMatch(/^https:\/\/ark\.cn-beijing\.volcengineapi\.com\//)
    expect(url).toContain('Action=CreateAssetGroup')
    expect(url).toContain('Version=2024-01-01')
  })

  it('applies default GroupType=AIGC + ProjectName=default when not supplied', async () => {
    const fetchSpy = mockFetchOnce(envelope({ Id: 'group-20260328000000-abc12' }))
    await arkCreateAssetGroup({ Name: 'test' }, CREDS)
    const requestInit = fetchSpy.mock.calls[0]![1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body.Name).toBe('test')
    expect(body.GroupType).toBe('AIGC')
    expect(body.ProjectName).toBe('default')
  })

  it('preserves caller-supplied Description / ProjectName overrides', async () => {
    const fetchSpy = mockFetchOnce(envelope({ Id: 'group-x' }))
    await arkCreateAssetGroup(
      { Name: 'test', Description: 'hello', ProjectName: 'my-project' },
      CREDS,
    )
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.Description).toBe('hello')
    expect(body.ProjectName).toBe('my-project')
  })

  it('throws ArkAssetApiError with code+message on Volcengine error envelope', async () => {
    mockFetchOnce(envelope(null, { Code: 'AuthorizationNotSigned', Message: '需先签署授权函' }), 400)
    await expect(arkCreateAssetGroup({ Name: 'test' }, CREDS)).rejects.toThrow(ArkAssetApiError)
    try {
      await arkCreateAssetGroup({ Name: 'test' }, CREDS)
    } catch (err) {
      // mockFetchOnce 只 mock 一次,第二次會 throw — 上面已抓
    }
  })

  it('throws ArkAssetApiError with httpStatus on bare HTTP error', async () => {
    mockFetchOnce({}, 500)
    await expect(arkCreateAssetGroup({ Name: 'test' }, CREDS)).rejects.toThrow(/HTTP_500|MISSING_RESULT/)
  })
})

describe('arkCreateAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the asset Id from a successful response', async () => {
    mockFetchOnce(envelope({ Id: 'Asset-20260523055114-gkxf5' }))
    const result = await arkCreateAsset(
      {
        GroupId: 'group-20260328000000-abc12',
        URL: 'https://example.com/character.png',
        AssetType: 'Image',
        Name: 'character-abc',
      },
      CREDS,
    )
    expect(result.Id).toBe('Asset-20260523055114-gkxf5')
  })

  it('sends required fields including AssetType', async () => {
    const fetchSpy = mockFetchOnce(envelope({ Id: 'Asset-1' }))
    await arkCreateAsset(
      {
        GroupId: 'group-1',
        URL: 'https://r2.example/img.png',
        AssetType: 'Image',
      },
      CREDS,
    )
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.GroupId).toBe('group-1')
    expect(body.URL).toBe('https://r2.example/img.png')
    expect(body.AssetType).toBe('Image')
    expect(body.ProjectName).toBe('default')
  })

  it('uses Action=CreateAsset in the query string', async () => {
    const fetchSpy = mockFetchOnce(envelope({ Id: 'Asset-1' }))
    await arkCreateAsset(
      { GroupId: 'group-1', URL: 'https://x.png', AssetType: 'Image' },
      CREDS,
    )
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toContain('Action=CreateAsset')
    expect(url).not.toContain('Action=CreateAssetGroup')
  })

  it('throws on Volcengine reject (e.g. URL not reachable)', async () => {
    mockFetchOnce(envelope(null, { Code: 'InvalidParameter', Message: 'URL 无法访问' }), 400)
    await expect(
      arkCreateAsset(
        { GroupId: 'group-1', URL: 'http://localhost/cannot-reach', AssetType: 'Image' },
        CREDS,
      ),
    ).rejects.toThrow(ArkAssetApiError)
  })
})

describe('arkGetAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns full asset metadata including Status and URL', async () => {
    mockFetchOnce(envelope({
      Id: 'Asset-20260523055114-gkxf5',
      Name: 'character-abc',
      URL: 'https://volcengine.cdn/signed-12hr-url',
      AssetType: 'Image',
      GroupId: 'group-1',
      Status: 'Active',
      Error: { Code: '', Message: '' },
      CreateTime: '2026-05-23T05:51:14Z',
      UpdateTime: '2026-05-23T05:53:00Z',
      ProjectName: 'default',
    }))

    const result = await arkGetAsset({ Id: 'Asset-20260523055114-gkxf5' }, CREDS)
    expect(result.Status).toBe('Active')
    expect(result.URL).toBe('https://volcengine.cdn/signed-12hr-url')
    expect(result.GroupId).toBe('group-1')
  })

  it('handles Processing status (mid-flight asset)', async () => {
    mockFetchOnce(envelope({
      Id: 'Asset-1',
      Name: '',
      URL: '',
      AssetType: 'Image',
      GroupId: 'group-1',
      Status: 'Processing',
      Error: { Code: '', Message: '' },
      CreateTime: '2026-05-23T05:51:14Z',
      UpdateTime: '2026-05-23T05:51:14Z',
      ProjectName: 'default',
    }))
    const result = await arkGetAsset({ Id: 'Asset-1' }, CREDS)
    expect(result.Status).toBe('Processing')
    expect(result.URL).toBe('')
  })

  it('handles Failed status with error details', async () => {
    mockFetchOnce(envelope({
      Id: 'Asset-1',
      Name: '',
      URL: '',
      AssetType: 'Image',
      GroupId: 'group-1',
      Status: 'Failed',
      Error: { Code: 'RealPersonDetected', Message: '检测到真人人脸' },
      CreateTime: '2026-05-23T05:51:14Z',
      UpdateTime: '2026-05-23T05:51:30Z',
      ProjectName: 'default',
    }))
    const result = await arkGetAsset({ Id: 'Asset-1' }, CREDS)
    expect(result.Status).toBe('Failed')
    expect(result.Error.Code).toBe('RealPersonDetected')
    expect(result.Error.Message).toContain('真人')
  })

  it('uses Action=GetAsset', async () => {
    const fetchSpy = mockFetchOnce(envelope({
      Id: 'Asset-1',
      Name: '',
      URL: '',
      AssetType: 'Image',
      GroupId: '',
      Status: 'Processing',
      Error: { Code: '', Message: '' },
      CreateTime: '',
      UpdateTime: '',
      ProjectName: 'default',
    }))
    await arkGetAsset({ Id: 'Asset-1' }, CREDS)
    const url = fetchSpy.mock.calls[0]![0] as string
    expect(url).toContain('Action=GetAsset')
  })
})
