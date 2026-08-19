import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calcText, calcVoice } from '@/lib/billing/cost'
import type { TaskBillingInfo } from '@/lib/task/types'

const ledgerMock = vi.hoisted(() => ({
  confirmChargeWithRecord: vi.fn(),
  freezeBalance: vi.fn(),
  getBalance: vi.fn(),
  getFreezeByIdempotencyKey: vi.fn(),
  increasePendingFreezeAmount: vi.fn(),
  recordShadowUsage: vi.fn(),
  rollbackFreeze: vi.fn(),
}))

const modeMock = vi.hoisted(() => ({
  getBillingMode: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/billing/ledger', () => ledgerMock)
vi.mock('@/lib/billing/mode', () => modeMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { BillingOperationError, InsufficientBalanceError } from '@/lib/billing/errors'
import {
  handleBillingError,
  prepareTaskBilling,
  rollbackTaskBilling,
  settleTaskBilling,
  withTextBilling,
  withVoiceBilling,
} from '@/lib/billing/service'

const ATLAS_AUDIO_MODEL = 'atlascloud::bytedance/seed-audio-1.0'

describe('billing/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ledgerMock.confirmChargeWithRecord.mockResolvedValue(true)
    ledgerMock.freezeBalance.mockResolvedValue('freeze_1')
    ledgerMock.getBalance.mockResolvedValue({ balance: 0 })
    ledgerMock.getFreezeByIdempotencyKey.mockResolvedValue(null)
    ledgerMock.increasePendingFreezeAmount.mockResolvedValue(true)
    ledgerMock.recordShadowUsage.mockResolvedValue(true)
    ledgerMock.rollbackFreeze.mockResolvedValue(true)
    prismaMock.userPreference.findUnique.mockResolvedValue(null)
  })

  it('returns raw execution result in OFF mode', async () => {
    modeMock.getBillingMode.mockResolvedValue('OFF')

    const result = await withTextBilling(
      'u1',
      'anthropic/claude-sonnet-4',
      1000,
      1000,
      { projectId: 'p1', action: 'a1' },
      async () => ({ ok: true }),
    )

    expect(result).toEqual({ ok: true })
    expect(ledgerMock.freezeBalance).not.toHaveBeenCalled()
    expect(ledgerMock.confirmChargeWithRecord).not.toHaveBeenCalled()
  })

  it('records shadow usage in SHADOW mode without freezing', async () => {
    modeMock.getBillingMode.mockResolvedValue('SHADOW')

    const result = await withTextBilling(
      'u1',
      'anthropic/claude-sonnet-4',
      1000,
      1000,
      { projectId: 'p1', action: 'a1' },
      async () => ({ ok: true }),
    )

    expect(result).toEqual({ ok: true })
    expect(ledgerMock.freezeBalance).not.toHaveBeenCalled()
    expect(ledgerMock.recordShadowUsage).toHaveBeenCalledTimes(1)
  })

  it('throws InsufficientBalanceError when ENFORCE freeze fails', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.freezeBalance.mockResolvedValue(null)
    ledgerMock.getBalance.mockResolvedValue({ balance: 0.01 })

    await expect(
      withTextBilling(
        'u1',
        'anthropic/claude-sonnet-4',
        1000,
        1000,
        { projectId: 'p1', action: 'a1' },
        async () => ({ ok: true }),
      ),
    ).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it('rolls back freeze when execution throws', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.freezeBalance.mockResolvedValue('freeze_rollback')

    await expect(
      withTextBilling(
        'u1',
        'anthropic/claude-sonnet-4',
        1000,
        1000,
        { projectId: 'p1', action: 'a1' },
        async () => {
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')

    expect(ledgerMock.rollbackFreeze).toHaveBeenCalledWith('freeze_rollback')
  })

  it('provider character count differs from submitted text -> rejects and rolls back instead of re-pricing', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.freezeBalance.mockResolvedValue('freeze_voice')

    await expect(withVoiceBilling(
      'u1',
      ATLAS_AUDIO_MODEL,
      'Atlas',
      { projectId: 'p1', action: 'voice_gen' },
      async () => ({ actualCharacters: 50 }),
    )).rejects.toMatchObject({ code: 'BILLING_INVALID_USAGE_QUANTITY' })

    expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
    expect(ledgerMock.confirmChargeWithRecord).not.toHaveBeenCalled()
    expect(ledgerMock.rollbackFreeze).toHaveBeenCalledWith('freeze_voice')
  })

  it('matching provider character count settles without any overage freeze', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.freezeBalance.mockResolvedValue('freeze_voice_exact')

    await withVoiceBilling(
      'u1',
      ATLAS_AUDIO_MODEL,
      'Atlas',
      { projectId: 'p1', action: 'voice_gen' },
      async () => ({ actualCharacters: 5 }),
    )

    expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
    expect(ledgerMock.confirmChargeWithRecord).toHaveBeenCalledTimes(1)
    expect(ledgerMock.rollbackFreeze).not.toHaveBeenCalled()
  })

  it('rejects duplicate sync billing key when freeze is already confirmed', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.getFreezeByIdempotencyKey.mockResolvedValue({
      id: 'freeze_confirmed',
      userId: 'u1',
      amount: 0.5,
      status: 'confirmed',
    })
    const execute = vi.fn(async () => ({ ok: true }))

    await expect(
      withTextBilling(
        'u1',
        'anthropic/claude-sonnet-4',
        1000,
        1000,
        { projectId: 'p1', action: 'a1', billingKey: 'billing-key-1' },
        execute,
      ),
    ).rejects.toThrow('duplicate billing request already confirmed')

    expect(execute).not.toHaveBeenCalled()
    expect(ledgerMock.freezeBalance).not.toHaveBeenCalled()
  })

  it('rejects duplicate sync billing key when freeze is pending', async () => {
    modeMock.getBillingMode.mockResolvedValue('ENFORCE')
    ledgerMock.getFreezeByIdempotencyKey.mockResolvedValue({
      id: 'freeze_pending',
      userId: 'u1',
      amount: 0.5,
      status: 'pending',
    })
    const execute = vi.fn(async () => ({ ok: true }))

    await expect(
      withTextBilling(
        'u1',
        'anthropic/claude-sonnet-4',
        1000,
        1000,
        { projectId: 'p1', action: 'a1', billingKey: 'billing-key-2' },
        execute,
      ),
    ).rejects.toThrow('duplicate billing request is already in progress')

    expect(execute).not.toHaveBeenCalled()
    expect(ledgerMock.freezeBalance).not.toHaveBeenCalled()
  })

  it('maps insufficient balance error to 402 response payload', async () => {
    const response = handleBillingError(new InsufficientBalanceError(1.2, 0.3))
    expect(response).toBeTruthy()
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body?.code).toBe('INSUFFICIENT_BALANCE')
    expect(body?.required).toBeCloseTo(1.2, 8)
    expect(body?.available).toBeCloseTo(0.3, 8)
  })

  it('returns null for non-billing errors', () => {
    expect(handleBillingError(new Error('x'))).toBeNull()
    expect(handleBillingError('x')).toBeNull()
  })

  describe('task billing lifecycle helpers', () => {
    function buildTaskInfo(overrides: Partial<Extract<TaskBillingInfo, { billable: true }>> = {}): Extract<TaskBillingInfo, { billable: true }> {
      return {
        billable: true,
        source: 'task',
        taskType: 'voice_line',
        apiType: 'voice',
        model: ATLAS_AUDIO_MODEL,
        quantity: 5,
        unit: 'character',
        maxFrozenCost: calcVoice(ATLAS_AUDIO_MODEL, 5),
        action: 'voice_line_generate',
        metadata: { foo: 'bar' },
        ...overrides,
      }
    }

    it('prepareTaskBilling handles OFF/SHADOW/ENFORCE paths', async () => {
      modeMock.getBillingMode.mockResolvedValueOnce('OFF')
      const off = await prepareTaskBilling({
        id: 'task_off',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo(),
      })
      expect((off as Extract<TaskBillingInfo, { billable: true }>).status).toBe('skipped')

      modeMock.getBillingMode.mockResolvedValueOnce('SHADOW')
      const shadow = await prepareTaskBilling({
        id: 'task_shadow',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo(),
      })
      expect((shadow as Extract<TaskBillingInfo, { billable: true }>).status).toBe('quoted')

      modeMock.getBillingMode.mockResolvedValueOnce('ENFORCE')
      ledgerMock.freezeBalance.mockResolvedValueOnce('freeze_task_1')
      const enforce = await prepareTaskBilling({
        id: 'task_enforce',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo(),
      })
      const enforceInfo = enforce as Extract<TaskBillingInfo, { billable: true }>
      expect(enforceInfo.status).toBe('frozen')
      expect(enforceInfo.freezeId).toBe('freeze_task_1')
    })

    it('prepareTaskBilling tolerates unknown text model pricing in SHADOW mode', async () => {
      modeMock.getBillingMode.mockResolvedValueOnce('SHADOW')
      const unknownTextInfo = buildTaskInfo({
        taskType: 'story_to_script_run',
        apiType: 'text',
        model: 'gpt-5.2',
        quantity: 2400,
        unit: 'token',
        maxFrozenCost: 0,
        action: 'story_to_script_run',
      })

      const shadow = await prepareTaskBilling({
        id: 'task_shadow_unknown_text_model',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: unknownTextInfo,
      })

      const shadowInfo = shadow as Extract<TaskBillingInfo, { billable: true }>
      expect(shadowInfo.status).toBe('skipped')
      expect(shadowInfo.maxFrozenCost).toBe(0)
    })

    it('prepareTaskBilling throws InsufficientBalanceError when ENFORCE freeze fails', async () => {
      modeMock.getBillingMode.mockResolvedValue('ENFORCE')
      ledgerMock.freezeBalance.mockResolvedValue(null)
      ledgerMock.getBalance.mockResolvedValue({ balance: 0.001 })

      await expect(
        prepareTaskBilling({
          id: 'task_no_balance',
          userId: 'u1',
          projectId: 'p1',
          billingInfo: buildTaskInfo(),
        }),
      ).rejects.toBeInstanceOf(InsufficientBalanceError)
    })

    it('settleTaskBilling handles SHADOW and non-ENFORCE snapshots', async () => {
      const shadowSettled = await settleTaskBilling({
        id: 'task_shadow_settle',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'SHADOW', status: 'quoted' }),
      })
      const shadowInfo = shadowSettled as Extract<TaskBillingInfo, { billable: true }>
      expect(shadowInfo.status).toBe('settled')
      expect(shadowInfo.chargedCost).toBe(0)
      expect(ledgerMock.recordShadowUsage).toHaveBeenCalled()

      const offSettled = await settleTaskBilling({
        id: 'task_off_settle',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'OFF', status: 'quoted' }),
      })
      const offInfo = offSettled as Extract<TaskBillingInfo, { billable: true }>
      expect(offInfo.status).toBe('settled')
      expect(offInfo.chargedCost).toBe(0)
    })

    it('settleTaskBilling does not fail OFF snapshot when text usage model pricing is unknown', async () => {
      const settled = await settleTaskBilling({
        id: 'task_off_unknown_usage_model',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          taskType: 'story_to_script_run',
          apiType: 'text',
          model: 'gpt-5.2',
          quantity: 2400,
          unit: 'token',
          maxFrozenCost: 0,
          action: 'story_to_script_run',
          modeSnapshot: 'OFF',
          status: 'quoted',
        }),
      }, {
        textUsage: [{ model: 'gpt-5.2', inputTokens: 1200, outputTokens: 800 }],
      })

      const settledInfo = settled as Extract<TaskBillingInfo, { billable: true }>
      expect(settledInfo.status).toBe('settled')
      expect(settledInfo.chargedCost).toBe(0)
      expect(ledgerMock.recordShadowUsage).not.toHaveBeenCalled()
    })

    it('settleTaskBilling skips SHADOW settlement when text model pricing is unknown', async () => {
      const settled = await settleTaskBilling({
        id: 'task_shadow_unknown_usage_model',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          taskType: 'story_to_script_run',
          apiType: 'text',
          model: 'gpt-5.2',
          quantity: 2400,
          unit: 'token',
          maxFrozenCost: 0,
          action: 'story_to_script_run',
          modeSnapshot: 'SHADOW',
          status: 'quoted',
        }),
      }, {
        textUsage: [{ model: 'gpt-5.2', inputTokens: 1200, outputTokens: 800 }],
      })

      const settledInfo = settled as Extract<TaskBillingInfo, { billable: true }>
      expect(settledInfo.status).toBe('settled')
      expect(settledInfo.chargedCost).toBe(0)
      expect(ledgerMock.recordShadowUsage).not.toHaveBeenCalled()
    })

    it('settleTaskBilling handles ENFORCE success/failure branches', async () => {
      ledgerMock.confirmChargeWithRecord.mockResolvedValueOnce(true)
      const settled = await settleTaskBilling({
        id: 'task_enforce_settle',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_ok' }),
      })
      expect((settled as Extract<TaskBillingInfo, { billable: true }>).status).toBe('settled')

      const missingFreeze = await settleTaskBilling({
        id: 'task_enforce_no_freeze',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: null }),
      })
      expect((missingFreeze as Extract<TaskBillingInfo, { billable: true }>).status).toBe('failed')

      ledgerMock.confirmChargeWithRecord.mockRejectedValueOnce(new Error('confirm failed'))
      await expect(
        settleTaskBilling({
          id: 'task_enforce_confirm_fail',
          userId: 'u1',
          projectId: 'p1',
          billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_fail' }),
        }),
      ).rejects.toThrow('confirm failed')
    })

    it('settleTaskBilling throws BILLING_CONFIRM_FAILED when confirm and rollback both fail', async () => {
      ledgerMock.confirmChargeWithRecord.mockRejectedValueOnce(new Error('confirm failed'))
      ledgerMock.rollbackFreeze.mockRejectedValueOnce(new Error('rollback failed'))

      await expect(
        settleTaskBilling({
          id: 'task_confirm_and_rollback_fail',
          userId: 'u1',
          projectId: 'p1',
          billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_rb_fail_confirm' }),
        }),
      ).rejects.toMatchObject({
        name: 'BillingOperationError',
        code: 'BILLING_CONFIRM_FAILED',
      })
    })

    it('settleTaskBilling rethrows BillingOperationError with task context when rollback succeeds', async () => {
      ledgerMock.confirmChargeWithRecord.mockRejectedValueOnce(
        new BillingOperationError(
          'BILLING_INVALID_FREEZE',
          'invalid freeze',
          { reason: 'status_mismatch' },
        ),
      )

      let thrown: unknown = null
      try {
        await settleTaskBilling({
          id: 'task_confirm_billing_error',
          userId: 'u1',
          projectId: 'p1',
          billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_billing_error' }),
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(BillingOperationError)
      const billingError = thrown as BillingOperationError
      expect(billingError.code).toBe('BILLING_INVALID_FREEZE')
      expect(billingError.details).toMatchObject({
        reason: 'status_mismatch',
        taskId: 'task_confirm_billing_error',
        freezeId: 'freeze_billing_error',
      })
    })

    it('preserves the freeze when deferred task settlement fails', async () => {
      ledgerMock.confirmChargeWithRecord.mockRejectedValueOnce(new Error('billing temporarily unavailable'))

      await expect(settleTaskBilling({
        id: 'task_recoverable_settlement',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          modeSnapshot: 'ENFORCE',
          freezeId: 'freeze_recoverable',
          billingKey: 'task_recoverable_settlement',
        }),
      }, {
        preserveFreezeOnFailure: true,
      })).rejects.toThrow('billing temporarily unavailable')

      expect(ledgerMock.rollbackFreeze).not.toHaveBeenCalled()
    })

    it('settleTaskBilling keeps the frozen price snapshot when submitted characters match', async () => {
      const frozenQuote = 0.123456
      const settled = await settleTaskBilling({
        id: 'task_voice_price_snapshot',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          modeSnapshot: 'ENFORCE',
          freezeId: 'freeze_price_snapshot',
          quantity: 5,
          maxFrozenCost: frozenQuote,
          pricingVersion: 'prior-catalog-version',
        }),
      }, {
        result: { actualCharacters: 5 },
      })

      expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
      expect(ledgerMock.confirmChargeWithRecord).toHaveBeenCalled()
      expect((settled as Extract<TaskBillingInfo, { billable: true }>).chargedCost).toBeCloseTo(frozenQuote, 8)
      expect(ledgerMock.confirmChargeWithRecord.mock.calls.at(-1)?.[1]).toMatchObject({
        apiType: 'voice',
        model: ATLAS_AUDIO_MODEL,
        quantity: 5,
        unit: 'character',
        metadata: expect.objectContaining({ pricingVersion: 'prior-catalog-version' }),
      })
    })

    it('voice settlement duration-only output -> keeps the frozen character quantity', async () => {
      const settled = await settleTaskBilling({
        id: 'task_voice_duration_ignored',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_duration_ignored' }),
      }, {
        result: { actualDurationSeconds: 50 },
      })

      expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
      expect((settled as Extract<TaskBillingInfo, { billable: true }>).chargedCost).toBeCloseTo(
        calcVoice(ATLAS_AUDIO_MODEL, 5),
        8,
      )
      expect(ledgerMock.confirmChargeWithRecord.mock.calls.at(-1)?.[1]).toMatchObject({
        quantity: 5,
        unit: 'character',
      })
    })

    it('legacy paid FAL voice settlement -> confirms its frozen quote without re-pricing as Atlas characters', async () => {
      const settled = await settleTaskBilling({
        id: 'task_legacy_fal_paid',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          modeSnapshot: 'ENFORCE',
          freezeId: 'freeze_legacy_fal_paid',
          model: 'index-tts2',
          quantity: 12,
          unit: 'second',
          maxFrozenCost: 0.0144,
          pricingVersion: '2026-02-19',
        }),
      }, {
        result: { actualDurationSeconds: 12 },
      })

      expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
      expect(ledgerMock.confirmChargeWithRecord.mock.calls.at(-1)?.[1]).toMatchObject({
        apiType: 'voice',
        model: 'index-tts2',
        quantity: 12,
        unit: 'second',
        metadata: expect.objectContaining({
          quotedCost: 0.0144,
          actualCost: 0.0144,
          pricingVersion: '2026-02-19',
        }),
      })
      expect((settled as Extract<TaskBillingInfo, { billable: true }>).chargedCost)
        .toBeCloseTo(0.0144, 8)
    })

    it('voice settlement malformed actualCharacters -> fails instead of charging a guessed quantity', async () => {
      await expect(settleTaskBilling({
        id: 'task_voice_invalid_characters',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_invalid_characters' }),
      }, {
        result: { actualCharacters: 1.5 },
      })).rejects.toMatchObject({
        code: 'BILLING_INVALID_USAGE_QUANTITY',
      })

      expect(ledgerMock.confirmChargeWithRecord).not.toHaveBeenCalled()
    })

    it('task voice character mismatch -> fails before settlement mutation', async () => {
      await expect(settleTaskBilling({
        id: 'task_voice_character_mismatch',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: buildTaskInfo({
          modeSnapshot: 'ENFORCE',
          freezeId: 'freeze_character_mismatch',
          quantity: 5,
        }),
      }, {
        result: { actualCharacters: 50 },
        preserveFreezeOnFailure: true,
      })).rejects.toMatchObject({ code: 'BILLING_INVALID_USAGE_QUANTITY' })

      expect(ledgerMock.increasePendingFreezeAmount).not.toHaveBeenCalled()
      expect(ledgerMock.confirmChargeWithRecord).not.toHaveBeenCalled()
    })

    it('settleTaskBilling keeps quoted charge when text usage has no token counts', async () => {
      const quoted = calcText('anthropic/claude-sonnet-4', 500, 500)
      const textBillingInfo: Extract<TaskBillingInfo, { billable: true }> = {
        billable: true,
        source: 'task',
        taskType: 'analyze_novel',
        apiType: 'text',
        model: 'anthropic/claude-sonnet-4',
        quantity: 1000,
        unit: 'token',
        maxFrozenCost: quoted,
        action: 'analyze_novel',
        modeSnapshot: 'ENFORCE',
        status: 'frozen',
        freezeId: 'freeze_text_zero',
      }
      ledgerMock.confirmChargeWithRecord.mockResolvedValueOnce(true)

      const settled = await settleTaskBilling({
        id: 'task_text_zero_usage',
        userId: 'u1',
        projectId: 'p1',
        billingInfo: textBillingInfo,
      }, {
        textUsage: [{ model: 'openai/gpt-5', inputTokens: 0, outputTokens: 0 }],
      })

      expect((settled as Extract<TaskBillingInfo, { billable: true }>).chargedCost).toBeCloseTo(quoted, 8)
      const recordParams = ledgerMock.confirmChargeWithRecord.mock.calls.at(-1)?.[1] as { model: string }
      expect(recordParams.model).toBe('openai/gpt-5')
    })

    it('rollbackTaskBilling handles success and fallback branches', async () => {
      const rolledBack = await rollbackTaskBilling({
        id: 'task_rb_ok',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_rb_ok' }),
      })
      expect((rolledBack as Extract<TaskBillingInfo, { billable: true }>).status).toBe('rolled_back')

      ledgerMock.rollbackFreeze.mockRejectedValueOnce(new Error('rollback failed'))
      const rollbackFailed = await rollbackTaskBilling({
        id: 'task_rb_fail',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_rb_fail' }),
      })
      expect((rollbackFailed as Extract<TaskBillingInfo, { billable: true }>).status).toBe('failed')

      ledgerMock.rollbackFreeze.mockResolvedValueOnce(false)
      const rollbackReturnedFalse = await rollbackTaskBilling({
        id: 'task_rb_false',
        billingInfo: buildTaskInfo({ modeSnapshot: 'ENFORCE', freezeId: 'freeze_rb_false' }),
      })
      expect((rollbackReturnedFalse as Extract<TaskBillingInfo, { billable: true }>).status).toBe('failed')
    })
  })
})
