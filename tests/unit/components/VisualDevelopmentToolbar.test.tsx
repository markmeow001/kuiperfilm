// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VisualDevelopmentHeader } from '@/app/[locale]/visual-development/VisualDevelopmentHeader'

const labels = {
  ariaLabel: '專案與角色',
  back: '返回專案首頁',
  eyebrow: '創作工具',
  system: '角色 Canon 系統',
  title: '角色視覺開發',
  project: '綁定專案',
  noProject: '尚未選擇專案',
  preview: '選角測試版',
  character: '目前開發角色',
  noCharacter: '尚未建立角色',
  newProject: '建立專案',
  projectName: '專案名稱',
  projectDescription: '專案說明（選填）',
  create: '建立並綁定',
  creating: '建立中…',
  cancel: '取消',
  close: '關閉建立專案視窗',
  export: '打包匯出',
  exportCanon: '下載 Canon 資產包',
  exportApproved: '下載已通過資產包',
  exportFull: '下載完整專案包',
  saving: '自動儲存中…',
  saved: '已自動儲存',
  saveError: '自動儲存失敗',
}

function setup(projectId = 'project-1') {
  const onProjectChange = vi.fn()
  const onCharacterChange = vi.fn()
  const onCreateProject = vi.fn().mockResolvedValue(undefined)
  const props = {
    locale: 'zh',
    projectId,
    projects: [{ id: 'project-1', name: '黑髮魔女' }],
    characters: [{ code: 'CHAR-01', name: '艾拉', status: 'draft' }],
    characterCode: 'CHAR-01',
    onProjectChange,
    onCharacterChange,
    onCreateProject,
    saveStatus: 'saved' as const,
    labels,
  }

  render(<VisualDevelopmentHeader {...props} />)
  return { onProjectChange, onCharacterChange, onCreateProject }
}

describe('VisualDevelopmentHeader contextual toolbar', () => {
  it('[已選專案] -> 所有 contextual controls 可操作且沒有第二個頁面標題', () => {
    const { onProjectChange, onCharacterChange } = setup()
    const toolbar = screen.getByRole('region', { name: '專案與角色' })

    expect(within(toolbar).queryByRole('heading', { level: 1 })).toBeNull()
    expect(within(toolbar).queryByRole('link', { name: '返回專案首頁' })).toBeNull()

    const project = within(toolbar).getByRole('combobox', { name: '綁定專案' })
    const character = within(toolbar).getByRole('combobox', { name: '目前開發角色' })
    fireEvent.change(project, { target: { value: '' } })
    fireEvent.change(character, { target: { value: '' } })

    expect(onProjectChange).toHaveBeenLastCalledWith('')
    expect(onCharacterChange).toHaveBeenLastCalledWith('')
    expect(project).toHaveClass('min-h-11')
    expect(character).toHaveClass('min-h-11')
    expect(screen.getByRole('status')).toHaveTextContent('已自動儲存')
  })

  it('[匯出專案] -> 公開展開狀態並保留三個既有下載網址', () => {
    setup()
    const exportButton = screen.getByRole('button', { name: '打包匯出' })

    expect(exportButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(exportButton)
    expect(exportButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '下載 Canon 資產包' })).toHaveAttribute(
      'href',
      '/api/visual-development/project-1/export?scope=canon',
    )
    expect(screen.getByRole('link', { name: '下載已通過資產包' })).toHaveAttribute(
      'href',
      '/api/visual-development/project-1/export?scope=approved',
    )
    expect(screen.getByRole('link', { name: '下載完整專案包' })).toHaveAttribute(
      'href',
      '/api/visual-development/project-1/export?scope=full',
    )
  })

  it('[建立專案] -> 傳出 trim 後名稱與說明且關閉鍵有名稱', async () => {
    const { onCreateProject } = setup()
    fireEvent.click(screen.getByRole('button', { name: '建立專案' }))

    const dialog = screen.getByRole('dialog', { name: '建立專案' })
    expect(within(dialog).getByRole('button', { name: '關閉建立專案視窗' })).toHaveClass(
      'min-h-11',
      'min-w-11',
    )
    fireEvent.change(within(dialog).getByRole('textbox', { name: '專案名稱' }), {
      target: { value: '  新專案  ' },
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '專案說明（選填）' }), {
      target: { value: '  世界觀測試  ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '建立並綁定' }))

    expect(onCreateProject).toHaveBeenLastCalledWith({
      name: '新專案',
      description: '世界觀測試',
    })
  })
})
