'use client'

/**
 * Phase 2.5 (2026-06-10) — Skill library client.
 *
 * Two sections mirroring flova's pattern:
 *   - 「我的 Skill」 (installed) — toggle enabled, see attribution, install count
 *   - 「精選 Skill」 (uninstalled featured/published) — install + preview description
 *
 * Empty state for installed: cold-start affordance pointing to the
 * browse section below.
 *
 * Style matches Session A's stone/amber Cinematic Immersive theme so
 * it lives consistently next to /v2/* pages.
 */

import { useState } from 'react'
import Link from 'next/link'
import {
  useSkills,
  useInstallSkill,
  useUpdateSkillInstallation,
  useUninstallSkill,
  type SkillRow,
} from '@/lib/query/hooks/useSkills'

interface SkillsLibraryClientProps {
  locale: string
}

export function SkillsLibraryClient({ locale }: SkillsLibraryClientProps) {
  const skillsQuery = useSkills()
  const installMutation = useInstallSkill()
  const updateMutation = useUpdateSkillInstallation()
  const uninstallMutation = useUninstallSkill()

  const [activeTab, setActiveTab] = useState<'mine' | 'browse'>('mine')
  const [busyId, setBusyId] = useState<string | null>(null)

  const all = skillsQuery.data?.skills ?? []
  const installed = all.filter((s) => s.installed)
  const browsable = all.filter((s) => !s.installed)

  function handleToggle(s: SkillRow) {
    if (!s.installationId) return
    setBusyId(s.id)
    updateMutation.mutate(
      { installationId: s.installationId, enabled: !s.enabled },
      { onSettled: () => setBusyId(null) },
    )
  }

  function handleInstall(s: SkillRow) {
    setBusyId(s.id)
    installMutation.mutate(s.id, {
      onSettled: () => setBusyId(null),
      onSuccess: () => setActiveTab('mine'),
    })
  }

  function handleUninstall(s: SkillRow) {
    if (!s.installationId) return
    setBusyId(s.id)
    uninstallMutation.mutate(s.installationId, {
      onSettled: () => setBusyId(null),
    })
  }

  return (
    <div className="font-body min-h-screen bg-stone-950 text-stone-200">
      {/* Header */}
      <header className="border-b border-amber-900/15 px-8 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6">
          <Link href={`/${locale}/v2`} className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold italic tracking-tight text-amber-400">
              Kuiper
            </span>
            <span className="font-serif-cn text-base font-medium text-stone-100">影界</span>
            <span className="ml-3 font-mono text-[10px] tracking-[0.3em] text-stone-500">
              SKILL · LIBRARY
            </span>
          </Link>
          <Link
            href={`/${locale}/v2/new`}
            className="rounded-sm bg-amber-500 px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-950 transition-colors hover:bg-amber-400"
          >
            + 建立新專案
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-10">
        <div className="mb-8">
          <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
            Skill 庫
          </h1>
          <p className="mt-2 font-fraunces text-sm italic text-stone-500">
            把工作流 + 模型鏈 + 提示模板封裝成可複用的 Skill。建立新專案時挑一個來啟動完整 pipeline。
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-b border-stone-800">
          <button
            type="button"
            onClick={() => setActiveTab('mine')}
            className={`relative -mb-px border-b-2 px-4 py-2 font-mono text-[13px] tracking-wider transition-colors ${
              activeTab === 'mine'
                ? 'border-amber-500 text-amber-300'
                : 'border-transparent text-stone-500 hover:text-stone-300'
            }`}
          >
            我的 Skill
            <span className="ml-2 text-[11px] text-stone-600">
              · {installed.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('browse')}
            className={`relative -mb-px border-b-2 px-4 py-2 font-mono text-[13px] tracking-wider transition-colors ${
              activeTab === 'browse'
                ? 'border-amber-500 text-amber-300'
                : 'border-transparent text-stone-500 hover:text-stone-300'
            }`}
          >
            精選 Skill
            <span className="ml-2 text-[11px] text-stone-600">
              · {browsable.length}
            </span>
          </button>
        </div>

        {/* Loading */}
        {skillsQuery.isLoading ? (
          <div className="rounded-sm border border-stone-800 bg-stone-900/40 p-8 text-center font-fraunces italic text-stone-500">
            載入 Skill 庫…
          </div>
        ) : null}

        {/* Error */}
        {skillsQuery.isError ? (
          <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 p-6">
            <div className="font-mono text-[14px] text-rose-300">無法載入 Skill 庫</div>
            <div className="mt-1 font-fraunces text-[12px] italic text-stone-400">
              確認 DB schema 已更新 (<code>npx prisma db push</code>) + seed 已執行。
            </div>
          </div>
        ) : null}

        {/* My Skills */}
        {!skillsQuery.isLoading && activeTab === 'mine' ? (
          installed.length === 0 ? (
            <EmptyMineState onBrowse={() => setActiveTab('browse')} />
          ) : (
            <div className="space-y-3">
              {installed.map((s) => (
                <SkillRowCard
                  key={s.id}
                  skill={s}
                  busy={busyId === s.id}
                  onToggle={() => handleToggle(s)}
                  onUninstall={() => handleUninstall(s)}
                  variant="installed"
                />
              ))}
            </div>
          )
        ) : null}

        {/* Browse */}
        {!skillsQuery.isLoading && activeTab === 'browse' ? (
          browsable.length === 0 ? (
            <div className="rounded-sm border border-stone-800 bg-stone-900/40 p-8 text-center">
              <p className="font-serif-cn text-sm text-stone-300">
                已啟用全部官方 Skill
              </p>
              <p className="mt-1 font-fraunces text-[11px] italic text-stone-500">
                社區創作者 Skill 將於 Phase 3.5 開放。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {browsable.map((s) => (
                <SkillRowCard
                  key={s.id}
                  skill={s}
                  busy={busyId === s.id}
                  onInstall={() => handleInstall(s)}
                  variant="browse"
                />
              ))}
            </div>
          )
        ) : null}
      </main>
    </div>
  )
}

// ─── Sub-components ───

function EmptyMineState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="rounded-sm border border-stone-800 bg-stone-900/40 p-12 text-center">
      <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/80">
        CHAPTER · YOUR LIBRARY
      </div>
      <h2 className="mt-2 font-serif-cn text-2xl font-medium text-stone-100">
        尚未啟用任何 Skill
      </h2>
      <p className="mx-auto mt-2 max-w-md font-fraunces text-sm italic text-stone-500">
        從精選列表挑一個開始 — 每個 Skill 包裝了一套完整工作流（劇本拆解 + 模型鏈 + 風格約束），建立新專案時直接啟動。
      </p>
      <button
        type="button"
        onClick={onBrowse}
        className="mt-6 rounded-sm bg-amber-500 px-5 py-2.5 font-mono text-[13px] uppercase tracking-wider text-stone-950 transition-colors hover:bg-amber-400"
      >
        瀏覽精選 Skill
      </button>
    </div>
  )
}

interface SkillRowCardProps {
  skill: SkillRow
  busy: boolean
  variant: 'installed' | 'browse'
  onToggle?: () => void
  onInstall?: () => void
  onUninstall?: () => void
}

function SkillRowCard({
  skill,
  busy,
  variant,
  onToggle,
  onInstall,
  onUninstall,
}: SkillRowCardProps) {
  return (
    <div className="rounded-sm border border-stone-800 bg-stone-900/40 p-5 transition-colors hover:border-stone-700">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-serif-cn text-base font-medium text-stone-100">
              {skill.name}
            </h3>
            {skill.isFeatured ? (
              <span className="rounded-sm bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                精選
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-stone-500">
              {skill.authorDisplay}
            </span>
            {skill.installCount > 0 ? (
              <span className="font-mono text-[11px] text-stone-600">
                · {skill.installCount.toLocaleString()} 次啟用
              </span>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-line font-fraunces text-[13px] leading-[1.65] text-stone-400">
            {skill.description}
          </p>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          {variant === 'installed' ? (
            <>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={onToggle}
                  disabled={busy}
                  className="h-4 w-4 cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
                />
                <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
                  {skill.enabled ? '啟用' : '停用'}
                </span>
              </label>
              <button
                type="button"
                onClick={onUninstall}
                disabled={busy}
                className="font-mono text-[11px] tracking-wider text-stone-600 transition-colors hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                移除
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onInstall}
              disabled={busy}
              className="rounded-sm bg-amber-500 px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '安裝中…' : '+ 新增'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
