import type { Project } from '@/types/project'
import { V2_STEPS, type V2StepId } from '@/components/v2/v2-types'

export interface ProjectHomeOriginSkill {
  id: string
  slug: string
  name: string
  nameEn?: string | null
  authorDisplay: string
  authorType: 'official' | 'community'
  isFeatured: boolean
}

export type ProjectHomeProject = Project & {
  workspaceId?: string | null
  workspace?: { id: string; name: string | null } | null
  originSkillId?: string | null
  originSkill?: ProjectHomeOriginSkill | null
}

export interface ProjectHomeEpisodeProgress {
  scriptDone: number
  scriptTotal: number
  storyboardDone: number
  storyboardTotal: number
  videoDone: number
  videoTotal: number
}

export interface ProjectHomeEpisode {
  id: string
  episodeNumber: number
  name: string
  description: string | null
  novelText: string | null
  createdAt: string
  updatedAt: string
  progress: ProjectHomeEpisodeProgress
  thumbnailUrl: string | null
}

export type ProjectStageStatus = 'done' | 'in-progress' | 'todo' | 'unavailable'
export type StorySourceOrigin = 'project' | 'episodes' | 'none' | 'unavailable'

export interface ProjectHomeModel {
  stageStatus: Record<V2StepId, ProjectStageStatus>
  nextStep: V2StepId | null
  counts: {
    episodes: number | null
    characters: number | null
    locations: number | null
    props: number | null
    storyboardDone: number | null
    storyboardTotal: number | null
    videoDone: number | null
    videoTotal: number | null
  }
  storySource: {
    origin: StorySourceOrigin
    text: string | null
    characterCount: number | null
  }
}

function nonEmptyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function sumProgress(
  episodes: readonly ProjectHomeEpisode[],
  field: keyof ProjectHomeEpisodeProgress,
): number {
  return episodes.reduce((total, episode) => total + episode.progress[field], 0)
}

function countVisibleCharacters(text: string): number {
  return Array.from(text).filter((character) => !/\s/u.test(character)).length
}

function resolveStorySource(
  project: ProjectHomeProject,
  episodes: readonly ProjectHomeEpisode[] | null,
): ProjectHomeModel['storySource'] {
  const projectText = nonEmptyText(project.novelPromotionData?.novelText)
  if (projectText) {
    return {
      origin: 'project',
      text: projectText,
      characterCount: countVisibleCharacters(projectText),
    }
  }

  if (episodes === null) {
    return { origin: 'unavailable', text: null, characterCount: null }
  }

  const episodeTexts = episodes
    .map((episode) => nonEmptyText(episode.novelText))
    .filter((text): text is string => text !== null)
  if (episodeTexts.length === 0) {
    return { origin: 'none', text: null, characterCount: 0 }
  }

  const combined = episodeTexts.join('\n\n')
  return {
    origin: 'episodes',
    text: combined,
    characterCount: countVisibleCharacters(combined),
  }
}

export function buildProjectHomeModel(
  project: ProjectHomeProject,
  episodes: readonly ProjectHomeEpisode[] | null,
  propCount: number | null,
): ProjectHomeModel {
  const characters = project.novelPromotionData?.characters
  const locations = project.novelPromotionData?.locations
  const characterCount = Array.isArray(characters) ? characters.length : null
  const locationCount = Array.isArray(locations) ? locations.length : null
  const episodeCount = episodes?.length ?? null
  const storyboardDone = episodes
    ? sumProgress(episodes, 'storyboardDone')
    : null
  const storyboardTotal = episodes
    ? sumProgress(episodes, 'storyboardTotal')
    : null
  const videoDone = episodes ? sumProgress(episodes, 'videoDone') : null
  const videoTotal = episodes ? sumProgress(episodes, 'videoTotal') : null
  const storySource = resolveStorySource(project, episodes)

  let scriptStatus: ProjectStageStatus = 'unavailable'
  if (episodes) {
    const episodesWithText = episodes.filter((episode) =>
      nonEmptyText(episode.novelText),
    ).length
    scriptStatus =
      episodes.length > 0 && episodesWithText === episodes.length
        ? 'done'
        : episodesWithText > 0 || storySource.text
          ? 'in-progress'
          : 'todo'
  }

  let subjectsStatus: ProjectStageStatus = 'unavailable'
  if (characterCount !== null && locationCount !== null) {
    subjectsStatus =
      characterCount > 0 && locationCount > 0
        ? 'done'
        : characterCount + locationCount + (propCount ?? 0) > 0
          ? 'in-progress'
          : 'todo'
  }

  let storyboardStatus: ProjectStageStatus = 'unavailable'
  if (storyboardDone !== null && storyboardTotal !== null) {
    storyboardStatus =
      storyboardTotal > 0 && storyboardDone >= storyboardTotal
        ? 'done'
        : storyboardDone > 0 || storyboardTotal > 0
          ? 'in-progress'
          : 'todo'
  }

  let finalStatus: ProjectStageStatus = 'unavailable'
  if (videoDone !== null && videoTotal !== null) {
    finalStatus =
      videoTotal > 0 && videoDone >= videoTotal
        ? 'done'
        : videoDone > 0 || videoTotal > 0
          ? 'in-progress'
          : 'todo'
  }

  const stageStatus: Record<V2StepId, ProjectStageStatus> = {
    home: 'done',
    script: scriptStatus,
    subjects: subjectsStatus,
    storyboard: storyboardStatus,
    // The current project-home endpoints do not expose a reliable voice
    // completion aggregate. Showing "todo" would fabricate a conclusion.
    voice: 'unavailable',
    final: finalStatus,
  }
  const firstUnresolvedStep = V2_STEPS.find(
    (step) => step.id !== 'home' && stageStatus[step.id] !== 'done',
  )
  const nextStep =
    firstUnresolvedStep && stageStatus[firstUnresolvedStep.id] !== 'unavailable'
      ? firstUnresolvedStep.id
      : null

  return {
    stageStatus,
    nextStep,
    counts: {
      episodes: episodeCount,
      characters: characterCount,
      locations: locationCount,
      props: propCount,
      storyboardDone,
      storyboardTotal,
      videoDone,
      videoTotal,
    },
    storySource,
  }
}

export function storyExcerpt(text: string, maximumCharacters = 680): string {
  if (maximumCharacters < 1) return ''
  const characters = Array.from(text)
  if (characters.length <= maximumCharacters) return text
  return `${characters.slice(0, maximumCharacters).join('').trimEnd()}…`
}

export function formatProjectDate(
  value: Date | string | null | undefined,
  locale = 'zh-TW',
): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(
    locale.toLowerCase().startsWith('en') ? 'en' : 'zh-TW',
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
  ).format(date)
}
