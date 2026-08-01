'use client'

import { AppIcon } from '@/components/ui/icons'
import type { CastingCandidateView } from './visual-development-types'

const SCORE_FIELDS = [
  'memorability',
  'storyPresence',
  'roleFit',
  'performanceRange',
  'angleStability',
  'ageCredibility',
  'photorealism',
] as const

type ScoreField = (typeof SCORE_FIELDS)[number]
type CandidateScore = Partial<Record<ScoreField, number>> & { rationale?: string }
type CastingScorecardRecord = Record<string, CandidateScore>
const CANDIDATE_RATIONALE_MAX_LENGTH = 400
const CANON_RATIONALE_MAX_LENGTH = 1_200

export interface CastingScorecardTranslations {
  title: string
  description: string
  candidate: string
  average: string
  rationale: string
  rationalePlaceholder: string
  canonRationale: string
  canonRationalePlaceholder: string
  metrics: Record<ScoreField, string>
}

interface CastingScorecardProps {
  candidates: CastingCandidateView[]
  serializedScorecard: string
  canonRationale: string
  disabled: boolean
  translations: CastingScorecardTranslations
  onScorecardChange: (value: string) => void
  onCanonRationaleChange: (value: string) => void
}

function parseScorecard(value: string): CastingScorecardRecord {
  if (!value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, CandidateScore] => (
        Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1])
      )),
    )
  } catch {
    return {}
  }
}

function averageScore(score: CandidateScore | undefined): string {
  if (!score) return '—'
  const values = SCORE_FIELDS
    .map((field) => score[field])
    .filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 5)
  if (values.length === 0) return '—'
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
}

export function CastingScorecard({
  candidates,
  serializedScorecard,
  canonRationale,
  disabled,
  translations,
  onScorecardChange,
  onCanonRationaleChange,
}: CastingScorecardProps) {
  const scores = parseScorecard(serializedScorecard)
  const reviewableCandidates = candidates.filter((candidate) => Boolean(candidate.resultUrl))

  if (reviewableCandidates.length === 0) return null

  const updateCandidate = (candidateId: string, patch: Partial<CandidateScore>) => {
    onScorecardChange(JSON.stringify({
      ...scores,
      [candidateId]: { ...scores[candidateId], ...patch },
    }))
  }

  return (
    <details className="border-b border-white/[0.07] bg-black/[0.16]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
        <span>
          <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-primary-400">
            <AppIcon name="clipboardCheck" className="h-3.5 w-3.5" />
            {translations.title}
          </span>
          <span className="mt-1 block font-serif-cn text-[10px] leading-5 text-text-tertiary">
            {translations.description}
          </span>
        </span>
        <AppIcon name="chevronDown" className="h-4 w-4 shrink-0 text-text-tertiary" />
      </summary>

      <div className="space-y-3 border-t border-white/[0.07] p-4">
        <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead className="bg-white/[0.035] font-mono text-[8px] tracking-[0.08em] text-text-tertiary">
              <tr>
                <th className="px-3 py-2 font-normal">{translations.candidate}</th>
                {SCORE_FIELDS.map((field) => <th key={field} className="px-2 py-2 text-center font-normal">{translations.metrics[field]}</th>)}
                <th className="px-2 py-2 text-center font-normal">{translations.average}</th>
                <th className="min-w-56 px-3 py-2 font-normal">{translations.rationale}</th>
              </tr>
            </thead>
            <tbody>
              {reviewableCandidates.map((candidate) => {
                const score = scores[candidate.id]
                return (
                  <tr key={candidate.id} className="border-t border-white/[0.06] bg-[#0b0b0d]">
                    <td className="whitespace-nowrap px-3 py-2 text-[10px] text-white">
                      {candidate.code}
                      {candidate.shortlisted && <span className="ml-2 rounded bg-primary-500/[0.14] px-1.5 py-0.5 font-mono text-[7px] text-primary-300">TOP</span>}
                    </td>
                    {SCORE_FIELDS.map((field) => (
                      <td key={field} className="px-2 py-2 text-center">
                        <select
                          aria-label={`${candidate.code} ${translations.metrics[field]}`}
                          value={score?.[field] ?? ''}
                          disabled={disabled}
                          onChange={(event) => updateCandidate(candidate.id, { [field]: Number(event.target.value) })}
                          className="h-8 rounded-lg border border-white/[0.08] bg-[#111114] px-2 text-[10px] text-white outline-none disabled:opacity-40"
                        >
                          <option value="">—</option>
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </td>
                    ))}
                    <td className="px-2 py-2 text-center font-mono text-[10px] text-primary-300">{averageScore(score)}</td>
                    <td className="px-3 py-2">
                      <input
                        aria-label={`${candidate.code} ${translations.rationale}`}
                        value={score?.rationale ?? ''}
                        disabled={disabled}
                        maxLength={CANDIDATE_RATIONALE_MAX_LENGTH}
                        onChange={(event) => updateCandidate(candidate.id, { rationale: event.target.value })}
                        placeholder={translations.rationalePlaceholder}
                        className="h-8 w-full rounded-lg border border-white/[0.08] bg-[#111114] px-2 text-[10px] text-white outline-none placeholder:text-text-tertiary disabled:opacity-40"
                      />
                      <span className="mt-1 block text-right font-mono text-[7px] text-text-tertiary">
                        {(score?.rationale ?? '').length}/{CANDIDATE_RATIONALE_MAX_LENGTH}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <label className="block rounded-xl border border-primary-500/20 bg-primary-500/[0.045] p-3">
          <span className="font-mono text-[8px] tracking-[0.12em] text-primary-300">{translations.canonRationale}</span>
          <textarea
            aria-label={translations.canonRationale}
            rows={3}
            value={canonRationale}
            disabled={disabled}
            maxLength={CANON_RATIONALE_MAX_LENGTH}
            onChange={(event) => onCanonRationaleChange(event.target.value)}
            placeholder={translations.canonRationalePlaceholder}
            className="mt-2 w-full resize-y rounded-lg border border-white/[0.08] bg-[#0b0b0d] px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-text-tertiary disabled:opacity-40"
          />
          <span className="mt-1 block text-right font-mono text-[7px] text-text-tertiary">
            {canonRationale.length}/{CANON_RATIONALE_MAX_LENGTH}
          </span>
        </label>
      </div>
    </details>
  )
}

export { CANON_RATIONALE_MAX_LENGTH, CANDIDATE_RATIONALE_MAX_LENGTH, SCORE_FIELDS }
