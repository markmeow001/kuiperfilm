'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { CharacterOption, ProjectOption } from './visual-development-types'
import styles from './VisualDevelopmentShell.module.css'

interface VisualDevelopmentHeaderProps {
  projectId: string
  projects: ProjectOption[]
  characters: CharacterOption[]
  characterCode: string
  onProjectChange: (projectId: string) => void
  onCharacterChange: (characterCode: string) => void
  onCreateProject: (input: { name: string; description: string }) => Promise<void>
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  labels: {
    ariaLabel: string
    project: string
    noProject: string
    preview: string
    character: string
    noCharacter: string
    newProject: string
    projectName: string
    projectDescription: string
    create: string
    creating: string
    cancel: string
    close: string
    export: string
    exportCanon: string
    exportApproved: string
    exportFull: string
    saving: string
    saved: string
    saveError: string
  }
}

export function VisualDevelopmentHeader(props: VisualDevelopmentHeaderProps) {
  const {
    projectId,
    projects,
    characters,
    characterCode,
    onProjectChange,
    onCharacterChange,
    onCreateProject,
    saveStatus,
    labels,
  } = props
  const [dialogOpen, setDialogOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const createProject = async () => {
    if (!name.trim()) return
    setIsCreating(true)
    try {
      await onCreateProject({ name: name.trim(), description: description.trim() })
      setName('')
      setDescription('')
      setDialogOpen(false)
    } finally {
      setIsCreating(false)
    }
  }

  const saveLabel = saveStatus === 'saving'
    ? labels.saving
    : saveStatus === 'saved'
      ? labels.saved
      : labels.saveError

  return (
    <section aria-label={labels.ariaLabel} className={styles.toolbar}>
      <div className={styles.toolbarInner}>
        <div className={styles.toolbarControls}>
          <select
            value={projectId}
            onChange={(event) => onProjectChange(event.target.value)}
            aria-label={labels.project}
            className={`${styles.select} ${styles.projectSelect} min-h-11`}
          >
            <option value="">{labels.noProject}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={`${styles.createButton} min-h-11 min-w-11`}
          >
            <AppIcon name="plus" aria-hidden="true" className="h-4 w-4" />
            <span className={styles.buttonLabel}>{labels.newProject}</span>
          </button>

          <select
            value={characterCode}
            onChange={(event) => onCharacterChange(event.target.value)}
            aria-label={labels.character}
            className={`${styles.select} ${styles.characterSelect} min-h-11`}
          >
            <option value="">{labels.noCharacter}</option>
            {characters.map((character) => (
              <option key={character.code} value={character.code}>
                {character.name} · {character.code}
              </option>
            ))}
          </select>

          <span className={styles.previewBadge}>{labels.preview}</span>

          {saveStatus !== 'idle' ? (
            <span
              role="status"
              aria-live="polite"
              className={`${styles.saveStatus} ${saveStatus === 'error' ? styles.saveError : ''}`}
            >
              {saveLabel}
            </span>
          ) : null}

          <div className={styles.exportControl}>
            <button
              type="button"
              disabled={!projectId}
              aria-expanded={exportOpen && Boolean(projectId)}
              aria-haspopup="true"
              onClick={() => setExportOpen((open) => !open)}
              className={`${styles.exportButton} min-h-11 min-w-11`}
            >
              <AppIcon name="download" aria-hidden="true" className="h-4 w-4" />
              <span className={styles.buttonLabel}>{labels.export}</span>
            </button>
            {exportOpen && projectId ? (
              <div className={styles.exportMenu}>
                {(['canon', 'approved', 'full'] as const).map((scope) => (
                  <a
                    key={scope}
                    href={`/api/visual-development/${projectId}/export?scope=${scope}`}
                    onClick={() => setExportOpen(false)}
                    className={styles.exportLink}
                  >
                    {scope === 'canon'
                      ? labels.exportCanon
                      : scope === 'approved'
                        ? labels.exportApproved
                        : labels.exportFull}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {dialogOpen ? (
        <div className={styles.dialogBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="visual-development-create-project-title"
            className={styles.dialog}
          >
            <div className={styles.dialogHeading}>
              <h2 id="visual-development-create-project-title" className={styles.dialogTitle}>
                {labels.newProject}
              </h2>
              <button
                type="button"
                aria-label={labels.close}
                onClick={() => setDialogOpen(false)}
                className={`${styles.closeButton} min-h-11 min-w-11`}
              >
                <AppIcon name="close" aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <label className={styles.field}>
              <span>{labels.projectName}</span>
              <input
                autoFocus
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                className="min-h-11"
              />
            </label>
            <label className={styles.field}>
              <span>{labels.projectDescription}</span>
              <textarea
                value={description}
                maxLength={500}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <div className={styles.dialogActions}>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className={`${styles.cancelButton} min-h-11`}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                disabled={!name.trim() || isCreating}
                onClick={() => void createProject()}
                className={`${styles.confirmButton} min-h-11`}
              >
                {isCreating ? labels.creating : labels.create}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
