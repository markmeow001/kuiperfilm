import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'

describe('resolveAnalysisModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'openai-compatible:pref::gpt-4.1-mini',
    })
    prismaMock.user.findFirst.mockResolvedValue(null)
  })

  it('uses inputModel override when provided', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'openai-compatible:input::gpt-4.1',
      projectAnalysisModel: 'openai-compatible:project::gpt-4.1',
    })

    expect(result).toBe('openai-compatible:input::gpt-4.1')
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
  })

  it('uses project analysisModel when inputModel is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: 'openai-compatible:project::gpt-4.1',
    })

    expect(result).toBe('openai-compatible:project::gpt-4.1')
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to user preference analysisModel when project is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: null,
    })

    expect(result).toBe('openai-compatible:pref::gpt-4.1-mini')
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { analysisModel: true },
    })
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
  })

  it('skips invalid input/project model keys and still falls back to user preference', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'gpt-4.1',
      projectAnalysisModel: 'invalid-model-key',
    })

    expect(result).toBe('openai-compatible:pref::gpt-4.1-mini')
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1)
  })

  it('falls back to admin preference when user preference is missing (multi-user inheritance)', async () => {
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce({ analysisModel: null }) // member's own pref empty
      .mockResolvedValueOnce({ analysisModel: 'openai-compatible:admin::gpt-4.1-pro' }) // admin's pref
    prismaMock.user.findFirst.mockResolvedValue({ id: 'admin-user' })

    const result = await resolveAnalysisModel({
      userId: 'member-user',
      projectAnalysisModel: null,
    })

    expect(result).toBe('openai-compatible:admin::gpt-4.1-pro')
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { role: 'admin' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    expect(prismaMock.userPreference.findUnique).toHaveBeenNthCalledWith(2, {
      where: { userId: 'admin-user' },
      select: { analysisModel: true },
    })
  })

  it('does not query admin preference when the requesting user IS the admin', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({ analysisModel: null })
    prismaMock.user.findFirst.mockResolvedValue({ id: 'admin-user' })

    await expect(resolveAnalysisModel({
      userId: 'admin-user',
      projectAnalysisModel: null,
    })).rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')

    // user.findFirst was called (to discover admin), but the second
    // userPreference lookup must NOT happen since admin.id === userId.
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1)
  })

  it('throws explicit error when all levels are missing', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValue({ analysisModel: null })
    prismaMock.user.findFirst.mockResolvedValue(null)

    await expect(resolveAnalysisModel({
      userId: 'user-1',
      inputModel: '',
      projectAnalysisModel: null,
    })).rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
  })

  it('throws when user pref empty AND admin pref also empty', async () => {
    prismaMock.userPreference.findUnique
      .mockResolvedValueOnce({ analysisModel: null })
      .mockResolvedValueOnce({ analysisModel: null })
    prismaMock.user.findFirst.mockResolvedValue({ id: 'admin-user' })

    await expect(resolveAnalysisModel({
      userId: 'member-user',
      projectAnalysisModel: null,
    })).rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
  })
})
