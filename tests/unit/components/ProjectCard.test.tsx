import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectCard,
  type ProjectCardProject,
} from '@/app/[locale]/v2/ProjectCard'

const editableProject: ProjectCardProject = {
  id: 'project-1',
  name: 'Night train',
  description: 'A contained thriller.',
  updated: '2026/08/09 10:00',
  canDelete: true,
  roleLabel: 'EDITOR',
  stats: {
    episodes: 3,
    images: 12,
    videos: 2,
    firstEpisodePreview: null,
  },
}

function renderCard(project: ProjectCardProject, onDelete = vi.fn()) {
  render(
    <ProjectCard
      project={project}
      overviewHref="/zh/v2/workspace/project-1?stay=1"
      continueHref="/zh/v2/workspace/project-1?startAt=storyboard"
      overviewLabel="開啟總覽"
      continueLabel="繼續製作"
      deleteLabel="刪除專案"
      untitledDraftLabel="尚未加入專案說明"
      deleting={false}
      onDelete={onDelete}
    />,
  )
  return onDelete
}

describe('ProjectCard', () => {
  it('separates overview and continue destinations without nesting actions', () => {
    renderCard(editableProject)

    expect(screen.getByRole('link', { name: '開啟總覽' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1?stay=1',
    )
    expect(screen.getByRole('link', { name: /繼續製作/ })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1?startAt=storyboard',
    )
    expect(screen.getByRole('button', { name: '刪除專案: Night train' }).closest('a')).toBeNull()
  })

  it('hides destructive controls for a viewer while keeping both read paths', () => {
    renderCard({ ...editableProject, canDelete: false, roleLabel: 'VIEWER' })

    expect(screen.queryByRole('button', { name: /刪除專案/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '開啟總覽' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /繼續製作/ })).toBeInTheDocument()
    expect(screen.getByText('VIEWER')).toBeInTheDocument()
  })

  it('invokes delete with the selected project', () => {
    const onDelete = renderCard(editableProject)
    fireEvent.click(screen.getByRole('button', { name: '刪除專案: Night train' }))
    expect(onDelete).toHaveBeenCalledWith(editableProject)
  })
})
