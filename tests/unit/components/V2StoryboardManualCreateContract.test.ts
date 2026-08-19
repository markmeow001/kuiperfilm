import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const clientSource = readFileSync(
  'src/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient.tsx',
  'utf8',
)
const zhMessages = JSON.parse(
  readFileSync('messages/zh/v2Storyboard.json', 'utf8'),
) as {
  manualPanel?: Record<string, string>
}
const enMessages = JSON.parse(
  readFileSync('messages/en/v2Storyboard.json', 'utf8'),
) as {
  manualPanel?: Record<string, string>
}

function manualSubmitHandlerSource() {
  const start = clientSource.indexOf('async function handleManualPanelSubmit')
  const end = clientSource.indexOf('\n  /**', start + 1)
  if (start < 0 || end < 0) throw new Error('manual submit handler not found')
  return clientSource.slice(start, end)
}

function manualOpenHandlerSource() {
  const start = clientSource.indexOf('function handleManualPanelOpen')
  const end = clientSource.indexOf('\n  /**', start + 1)
  if (start < 0 || end < 0) throw new Error('manual open handler not found')
  return clientSource.slice(start, end)
}

describe('V2 storyboard manual create contract', () => {
  it('[手動建立] -> 只送 atomic initialPanel，不呼叫 panel create、regen 或 task', () => {
    const handler = manualSubmitHandlerSource()

    expect(handler).toContain('createStoryboardGroup.mutateAsync')
    expect(handler).toContain('initialPanel: draft')
    expect(handler).toContain('idempotencyKey')
    expect(handler).not.toContain('createPanel.')
    expect(handler).not.toContain('regenPanel.')
    expect(handler).not.toContain('submitTask')
    expect(handler).not.toContain('handleAnalyzeStoryboard')
  })

  it('[送出失敗或 outcome unknown] -> 保留同一 key、保留 modal 並顯示 inline error', () => {
    const handler = manualSubmitHandlerSource()
    const opener = manualOpenHandlerSource()

    expect(clientSource).toContain('manualPanelIdempotencyKeyRef')
    expect(clientSource).toContain('manualPanelError')
    expect(handler).toContain('manualPanelIdempotencyKeyRef.current')
    expect(handler).toContain('setManualPanelError')
    expect(handler).not.toMatch(/catch[\s\S]*setManualPanelOpen\(false\)/)
    expect(handler).not.toContain('alert(')
    expect(clientSource).toContain('submitError={manualPanelError}')
    expect(clientSource).toContain('initialDraft={manualPanelDraft}')
    expect(clientSource).toContain('onDraftChange={setManualPanelDraft}')
    expect(clientSource).toContain('draftLocked={manualPanelOutcomeUnknown}')
    expect(clientSource).toContain('manualPanelRecoveryEpisodeIdRef')
    expect(clientSource).toContain('manualPanelAnchorIdRef')
    expect(handler).toContain('manualStoryboardRecoveryMatchesEpisode')
    expect(handler).toContain('isManualStoryboardOutcomeUnknown')
    expect(handler).toContain('anchorPanelId: manualPanelAnchorId')
    expect(handler).toContain('idempotencyKey,')
    expect(handler).not.toContain('anchorPanelId: selected.id')
    expect(handler).not.toContain("manualPanelPosition === 'append' &&")
    expect(handler).toContain('if (!outcomeUnknown) {')
    expect(handler).toContain('manualPanelIdempotencyKeyRef.current = null')
    expect(opener.indexOf('if (manualPanelIdempotencyKeyRef.current)')).toBeLessThan(
      opener.indexOf('setManualPanelPosition(position)'),
    )
  })

  it('[viewer] -> opener 與 modal 雙重 fail-closed，零 callback/network', () => {
    expect(clientSource).toMatch(
      /function handleManualPanelOpen\([^)]*\) \{\n\s+if \(!canEdit \|\| !currentEpisodeId\) return/,
    )
    expect(clientSource).toContain('{manualPanelOpen && canEdit ?')
    expect(clientSource).toContain('disabled={!canEdit || !currentEpisodeId || manualPanelSubmitting}')
  })

  it('[Gallery、Timeline、Groups 與空狀態] -> 共用同一真實手動建立入口', () => {
    expect(clientSource).toContain("t('manualPanel.open')")
    expect(clientSource).toContain("t('manualPanel.emptyAction')")
    expect(clientSource).toContain('onClick={() => handleManualPanelOpen()}')
    expect(clientSource.match(/layoutToggleNode=\{layoutToggleNode\}/g)).toHaveLength(3)
  })

  it('[zh/en] -> 文案明示不使用 AI，操作名稱只描述建立分鏡', () => {
    expect(zhMessages.manualPanel).toMatchObject({
      title: '手動新增分鏡',
      create: '建立分鏡',
      open: '手動新增',
    })
    expect(zhMessages.manualPanel?.nonAiNotice).toContain('不會使用 AI')
    expect(enMessages.manualPanel).toMatchObject({
      title: 'Add storyboard manually',
      create: 'Create storyboard',
      open: 'Add manually',
    })
    expect(enMessages.manualPanel?.nonAiNotice).toContain('does not use AI')
  })
})
