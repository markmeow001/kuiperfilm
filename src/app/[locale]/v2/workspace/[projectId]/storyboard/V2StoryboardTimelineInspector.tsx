'use client'

/**
 * Phase 1 step 4 (2026-06-22) — Timeline Inspector column (right visual).
 *
 * Extracted from V2StoryboardClient's Timeline branch (was inline at
 * lines 2221-2363). Owns:
 *   - MultiShotBindingsRail (when selectedGroupTaskId set)
 *   - Cast roster with per-character appearance resolution (matches
 *     worker collectPanelReferenceImages priority)
 *   - Notes section (videoPrompt readout)
 *
 * Sibling of TimelineStrip / TimelineText / TimelineShot.
 */

import { useTranslations } from 'next-intl'
import { MultiShotBindingsRail } from './MultiShotBindingsRail'
import type {
  PanelLike,
  PanelCharacterRef,
  EpisodeBinding,
  EpisodeWithNumber,
} from './storyboard-client-helpers'
import type { CharacterRosterEntry } from './V2GroupsLayout'

export interface V2StoryboardTimelineInspectorProps {
  projectId: string
  selected: PanelLike | null
  selectedGroupTaskId: string | null
  selectedGroupLabel: string | null
  currentEpisode: EpisodeWithNumber | null
  characterRoster: CharacterRosterEntry[]
  episodeBindings: EpisodeBinding[]
}

export function V2StoryboardTimelineInspector(props: V2StoryboardTimelineInspectorProps) {
  const t = useTranslations('v2Storyboard')
  const {
    projectId,
    selected,
    selectedGroupTaskId,
    selectedGroupLabel,
    currentEpisode,
    characterRoster,
    episodeBindings,
  } = props

  return (
    <div className="col-span-4 space-y-5 order-3">
      {selectedGroupTaskId ? (
        <MultiShotBindingsRail
          taskId={selectedGroupTaskId}
          groupLabel={selectedGroupLabel}
          projectId={projectId}
        />
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[14px] tracking-wider text-amber-600">{t('cast.title')}</div>
          {currentEpisode?.episodeNumber ? (
            <div className="font-mono text-[11px] tracking-wider text-stone-500">
              {t('cast.epBinding', { episode: currentEpisode.episodeNumber })}
            </div>
          ) : null}
        </div>
        {/*
          Each panel character is rendered with the appearance the
          worker WOULD use right now — looks up
          EpisodeCharacter(currentEpisodeId, characterId) and falls
          back to characterRoster[0].appearances[0] when no
          binding exists. Match exactly the resolution priority in
          multi-shot-video-b-path.ts:820-855 so the chip reflects
          the actual generation outcome (no surprises).
        */}
        {Array.isArray(selected?.characters) && selected.characters.length > 0 ? (
          <div className="space-y-1.5">
            {selected.characters.map((ref, i) => {
              // Post-2026-05-04 panels store characters as
              // {name, appearance?}[]. The storyboards API decodes
              // legacy bare-string entries into the same shape, but
              // TS strict-types `characters: PanelCharacterRef[]` so
              // the `typeof ref === 'string'` runtime check needs a
              // cast in the else branch. (PR #18 M-2 union expansion
              // was reverted to avoid GroupCard/V2GroupsLayout fan-out.)
              const name = typeof ref === 'string'
                ? ref
                : (ref as PanelCharacterRef)?.name ?? ''
              const appearanceHint = typeof ref === 'string'
                ? null
                : (ref as PanelCharacterRef)?.appearance ?? null
              const character = characterRoster.find(
                (c) => (c.name ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
              )
              const appearances = character?.appearances ?? []
              const binding = episodeBindings.find(
                (b) => b.characterId === character?.id,
              )
              // Resolution priority (mirrors worker
              // collectPanelReferenceImages) — 2026-05-13 reordered:
              //   1. panel.characters[i].appearance hint matched against
              //      changeReason (per-shot LLM intent wins)
              //   2. EpisodeCharacter binding (this episode, fallback
              //      when LLM did not pick)
              //   3. appearances[0]
              let resolved = null as
                | { id: string | null; label: string; imageUrl: string | null; isDefault: boolean }
                | null
              if (appearanceHint) {
                const ap = appearances.find(
                  (a) => (a.changeReason ?? '').toLowerCase() === appearanceHint.toLowerCase(),
                )
                if (ap) {
                  resolved = {
                    id: ap.id ?? null,
                    label: ap.changeReason || appearanceHint,
                    imageUrl: ap.imageUrl ?? null,
                    isDefault: false,
                  }
                }
              }
              if (!resolved && binding?.appearanceId) {
                const ap = appearances.find((a) => a.id === binding.appearanceId)
                if (ap) {
                  resolved = {
                    id: ap.id ?? null,
                    label: ap.changeReason || t('cast.appearanceLabel', { n: (ap.appearanceIndex ?? 0) + 1 }),
                    imageUrl: ap.imageUrl ?? null,
                    isDefault: false,
                  }
                }
              }
              if (!resolved && appearances.length > 0) {
                const ap = appearances[0]
                resolved = {
                  id: ap.id ?? null,
                  label: ap.changeReason || t('cast.initialAppearance'),
                  imageUrl: ap.imageUrl ?? null,
                  isDefault: true,
                }
              }
              return (
                <div
                  key={`${name}-${i}`}
                  className="flex items-center gap-2.5 rounded-sm border border-stone-800/60 bg-stone-900/40 px-2.5 py-1.5"
                  title={
                    resolved?.isDefault
                      ? t('cast.titleDefault', { label: resolved.label })
                      : t('cast.titleBound', { label: resolved?.label ?? t('cast.titleBoundNone') })
                  }
                >
                  <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-gradient-to-br from-amber-500 to-rose-700">
                    {resolved?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolved.imageUrl}
                        alt={name}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif-cn text-xs text-stone-200">{name}</div>
                    <div className="truncate font-mono text-[11px] tracking-wider text-amber-500/70">
                      {resolved
                        ? resolved.isDefault
                          ? t('cast.appearancePresetSuffix', { label: resolved.label })
                          : resolved.label
                        : t('cast.noAppearance')}
                    </div>
                  </div>
                  {resolved?.isDefault && appearances.length > 1 ? (
                    <span
                      className="flex-shrink-0 rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-300"
                      title={t('cast.unboundChipTitle')}
                    >
                      {t('cast.unboundChipLabel')}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="font-serif-cn text-xs text-stone-500">{t('cast.noCharacters')}</p>
        )}
      </div>

      <div>
        <div className="mb-2 font-mono text-[14px] tracking-wider text-amber-600">{t('notes.title')}</div>
        <div className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-2 font-serif-cn text-xs leading-relaxed text-stone-400">
          {selected?.videoPrompt ?? t('notes.empty')}
        </div>
      </div>
    </div>
  )
}
