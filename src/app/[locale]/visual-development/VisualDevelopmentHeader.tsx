'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { CharacterOption, ProjectOption } from './visual-development-types'

interface VisualDevelopmentHeaderProps {
  locale: string
  projectId: string
  projects: ProjectOption[]
  characters: CharacterOption[]
  characterCode: string
  onProjectChange: (projectId: string) => void
  onCharacterChange: (characterCode: string) => void
  onCreateProject: (input: { name: string; description: string }) => Promise<void>
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  labels: {
    back: string
    eyebrow: string
    system: string
    title: string
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
  const { locale, projectId, projects, characters, characterCode, onProjectChange, onCharacterChange, onCreateProject, saveStatus, labels } = props
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

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-white/[0.07] bg-[#060607]/95 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-h-[72px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Link href={`/${locale}/v2`} aria-label={labels.back} title={labels.back} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400">
            <AppIcon name="chevronLeft" className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.22em] text-primary-400">
              <span>{labels.eyebrow}</span><span className="hidden h-px w-6 bg-primary-500/40 sm:block" /><span className="hidden text-text-tertiary sm:inline">{labels.system}</span>
            </div>
            <h1 className="mt-1 truncate font-serif-cn text-lg font-semibold text-white">{labels.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {saveStatus !== 'idle' && <span className={`hidden font-mono text-[8px] tracking-[0.12em] xl:inline ${saveStatus === 'error' ? 'text-red-300' : 'text-text-tertiary'}`}>{saveStatus === 'saving' ? labels.saving : saveStatus === 'saved' ? labels.saved : labels.saveError}</span>}
          <select value={projectId} onChange={(event) => onProjectChange(event.target.value)} aria-label={labels.project} className="hidden h-9 max-w-56 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-text-secondary outline-none focus:border-primary-500/50 md:block">
            <option value="">{labels.noProject}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" onClick={() => setDialogOpen(true)} className="flex h-9 items-center gap-2 rounded-xl border border-primary-500/30 bg-primary-500/[0.08] px-3 text-[10px] text-primary-300 hover:bg-primary-500/[0.14]">
            <AppIcon name="plus" className="h-3.5 w-3.5" /><span className="hidden sm:inline">{labels.newProject}</span>
          </button>
          <select value={characterCode} onChange={(event) => onCharacterChange(event.target.value)} aria-label={labels.character} className="hidden h-9 max-w-48 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-text-secondary outline-none focus:border-primary-500/50 lg:block">
            <option value="">{labels.noCharacter}</option>
            {characters.map((character) => <option key={character.code} value={character.code}>{character.name} · {character.code}</option>)}
          </select>
          <span className="hidden rounded-lg border border-primary-500/25 bg-primary-500/[0.08] px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-primary-400 xl:inline">{labels.preview}</span>
          <div className="relative">
            <button type="button" disabled={!projectId} onClick={() => setExportOpen((open) => !open)} className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[10px] text-text-secondary disabled:opacity-35">
              <AppIcon name="download" className="h-3.5 w-3.5" /><span className="hidden sm:inline">{labels.export}</span>
            </button>
            {exportOpen && projectId && (
              <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-white/[0.1] bg-[#111114] p-1.5 shadow-2xl">
                {(['canon', 'approved', 'full'] as const).map((scope) => (
                  <a key={scope} href={`/api/visual-development/${projectId}/export?scope=${scope}`} onClick={() => setExportOpen(false)} className="block rounded-lg px-3 py-2.5 text-[10px] text-text-secondary hover:bg-white/[0.05] hover:text-white">
                    {scope === 'canon' ? labels.exportCanon : scope === 'approved' ? labels.exportApproved : labels.exportFull}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {dialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#111114] p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="font-serif-cn text-base font-semibold text-white">{labels.newProject}</h2><button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg p-2 text-text-tertiary hover:bg-white/[0.05] hover:text-white"><AppIcon name="close" className="h-4 w-4" /></button></div>
            <label className="mt-5 block"><span className="font-mono text-[9px] tracking-[0.12em] text-text-tertiary">{labels.projectName}</span><input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/[0.09] bg-[#09090b] px-3 text-sm text-white outline-none focus:border-primary-500/45" /></label>
            <label className="mt-4 block"><span className="font-mono text-[9px] tracking-[0.12em] text-text-tertiary">{labels.projectDescription}</span><textarea value={description} maxLength={500} rows={4} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full resize-none rounded-xl border border-white/[0.09] bg-[#09090b] px-3 py-2.5 text-xs text-white outline-none focus:border-primary-500/45" /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialogOpen(false)} className="h-10 rounded-xl border border-white/[0.09] px-4 text-[10px] text-text-secondary">{labels.cancel}</button><button type="button" disabled={!name.trim() || isCreating} onClick={() => void createProject()} className="h-10 rounded-xl bg-primary-500 px-4 text-[10px] font-semibold text-white disabled:opacity-35">{isCreating ? labels.creating : labels.create}</button></div>
          </div>
        </div>
      )}
    </header>
  )
}
