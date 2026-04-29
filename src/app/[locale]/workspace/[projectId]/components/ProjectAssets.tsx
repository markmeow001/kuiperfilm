'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ProjectAssetsCharactersTab from './ProjectAssetsCharactersTab'
import ProjectAssetsLocationsTab from './ProjectAssetsLocationsTab'
import ImportFromGlobalDialog from './ImportFromGlobalDialog'

type Tab = 'characters' | 'locations'

export interface ProjectAssetsProps {
  projectId: string
}

/**
 * Phase 11.2 — project-level asset (characters/locations) tab inside the workspace.
 *
 * Both tabs render with cross-episode appearance summary derived from the
 * EpisodeCharacter / EpisodeLocation junction (single source of truth).
 *
 * Includes "Import from Asset Hub" entry that opens ImportFromGlobalDialog
 * and POSTs to /api/projects/[projectId]/import-character (or import-location).
 *
 * A future "props" tab placeholder is reserved for Phase 11.3.
 */
export default function ProjectAssets({ projectId }: ProjectAssetsProps) {
  const t = useTranslations('workspaceDetail.projectAssets')
  const [activeTab, setActiveTab] = useState<Tab>('characters')
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-1">
          {t('title')}
        </h1>
        <p className="text-sm text-[var(--glass-text-secondary)]">
          {t('subtitle')}
        </p>
      </div>

      <div className="flex gap-2 border-b border-[var(--glass-border-muted)]">
        <button
          type="button"
          onClick={() => setActiveTab('characters')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'characters'
              ? 'text-[var(--glass-text-primary)] border-b-2 border-[var(--glass-tone-primary-fg)]'
              : 'text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'
          }`}
        >
          {t('tabCharacters')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('locations')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'locations'
              ? 'text-[var(--glass-text-primary)] border-b-2 border-[var(--glass-tone-primary-fg)]'
              : 'text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'
          }`}
        >
          {t('tabLocations')}
        </button>
        {/* Phase 11.3 placeholder: props tab. Kept disabled to telegraph intent. */}
        <button
          type="button"
          disabled
          className="px-4 py-2 text-sm font-medium text-[var(--glass-text-tertiary)] opacity-50 cursor-not-allowed"
          title={t('tabPropsComingSoon')}
        >
          {t('tabProps')}
        </button>
      </div>

      <div>
        {activeTab === 'characters' ? (
          <ProjectAssetsCharactersTab
            projectId={projectId}
            onImportClick={() => setImportDialogOpen(true)}
          />
        ) : (
          <ProjectAssetsLocationsTab
            projectId={projectId}
            onImportClick={() => setImportDialogOpen(true)}
          />
        )}
      </div>

      {importDialogOpen ? (
        <ImportFromGlobalDialog
          projectId={projectId}
          kind={activeTab === 'characters' ? 'character' : 'location'}
          onClose={() => setImportDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}
