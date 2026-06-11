'use client'

/**
 * Phase 2.5 (2026-06-10) — Skill detail client.
 *
 * Sections:
 *   - Hero: name + attribution + 精選 ribbon + install count
 *   - Description: full multi-paragraph spec
 *   - Pipeline: ordered list of stages with model + settings
 *   - Defaults: aspect / duration / resolution / audio mode preview
 *   - Constraints: forbidden subjects / portrait force / audio refs
 *   - Actions: install + 「用此 Skill 建立專案」 CTA
 *
 * Pipeline + defaults + constraints are decoded from the SkillConfig
 * JSON shape declared in src/lib/skills/types.ts. Type-safe parsing
 * via a small validator below — never blows up on bad config.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSkill, useInstallSkill } from '@/lib/query/hooks/useSkills'
import type {
  SkillConfig,
  SkillPipelineStage,
  SkillDefaults,
  SkillConstraints,
} from '@/lib/skills/types'

interface SkillDetailClientProps {
  locale: string
  slug: string
}

// Human-readable labels for SkillStageId values.
const STAGE_LABELS: Record<string, string> = {
  analyze_script: '劇本分析',
  generate_keyframe: '生成關鍵幀',
  generate_storyboard_grid: '生成分鏡網格',
  generate_panel_image: '生成分鏡圖',
  generate_panel_video: '生成分鏡視頻',
  composite_multi_shot: '多鏡頭合成',
  tts_voice_line: '語音合成',
  lip_sync: '對口型',
  stitch_final: '剪輯成片',
}

const AUDIO_MODE_LABELS: Record<string, string> = {
  silent: '靜音',
  ambient: '環境音',
  bgm: '背景音樂',
  voiced: '對白配音',
}

export function SkillDetailClient({ locale, slug }: SkillDetailClientProps) {
  const router = useRouter()
  const skillQuery = useSkill(slug)
  const installMutation = useInstallSkill()
  const [installing, setInstalling] = useState(false)

  const skill = skillQuery.data?.skill ?? null
  const config = parseSkillConfig(skill?.config)

  function handleInstall() {
    if (!skill) return
    setInstalling(true)
    installMutation.mutate(skill.id, {
      onSettled: () => setInstalling(false),
    })
  }

  function handleUseSkill() {
    if (!skill) return
    router.push(`/${locale}/v2/new?skill=${skill.id}`)
  }

  return (
    <div className="font-body min-h-screen bg-stone-950 text-stone-200">
      {/* Header */}
      <header className="border-b border-amber-900/15 px-8 py-5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-6">
          <Link
            href={`/${locale}/skills`}
            className="font-mono text-[11px] uppercase tracking-wider text-stone-500 transition-colors hover:text-amber-400"
          >
            ← 返回 Skill 庫
          </Link>
          <Link href={`/${locale}/v2`} className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold italic tracking-tight text-amber-400">
              Kuiper
            </span>
            <span className="font-serif-cn text-base font-medium text-stone-100">影界</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-8 py-12">
        {skillQuery.isLoading ? (
          <div className="rounded-sm border border-stone-800 bg-stone-900/40 p-10 text-center font-fraunces italic text-stone-500">
            載入 Skill 詳情…
          </div>
        ) : skillQuery.isError || !skill ? (
          <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 p-6">
            <div className="font-mono text-[14px] text-rose-300">找不到此 Skill</div>
            <div className="mt-1 font-fraunces text-[12px] italic text-stone-400">
              可能已下架、被歸檔，或你沒有存取權。
            </div>
            <Link
              href={`/${locale}/skills`}
              className="mt-3 inline-block rounded-sm border border-stone-700 px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-stone-400 hover:border-amber-500/60 hover:text-amber-300"
            >
              ← 回到 Skill 庫
            </Link>
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="mb-10">
              <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/80">
                CHAPTER · SKILL DETAIL
              </div>
              <h1 className="mt-3 font-serif-cn text-4xl font-medium tracking-wide text-stone-100">
                {skill.name}
              </h1>
              {skill.nameEn ? (
                <p className="mt-1 font-fraunces text-lg italic text-stone-500">
                  {skill.nameEn}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3 font-mono text-[12px] tracking-wider text-stone-500">
                <span className="text-stone-300">{skill.authorDisplay}</span>
                {skill.isFeatured ? (
                  <span className="rounded-sm bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">
                    精選
                  </span>
                ) : null}
                {skill.installCount > 0 ? (
                  <span>· {skill.installCount.toLocaleString()} 次啟用</span>
                ) : null}
                <span className="rounded-sm border border-stone-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-stone-500">
                  {skill.authorType === 'official' ? '官方' : '社區'}
                </span>
              </div>
            </div>

            {/* Description */}
            <section className="mb-10">
              <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80">
                Skill 介紹
              </h2>
              <p className="whitespace-pre-line font-fraunces text-base leading-[1.85] text-stone-300">
                {skill.description}
              </p>
            </section>

            {/* Pipeline */}
            {config && config.pipeline.length > 0 ? (
              <section className="mb-10">
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80">
                  工作流階段
                </h2>
                <p className="mb-4 font-fraunces text-[13px] italic text-stone-500">
                  Skill 啟動時 worker 依此順序執行；每階段使用指定模型。
                </p>
                <ol className="space-y-2">
                  {config.pipeline.map((stage, i) => (
                    <PipelineStageRow
                      key={`${stage.stage}-${i}`}
                      index={i + 1}
                      stage={stage}
                    />
                  ))}
                </ol>
              </section>
            ) : null}

            {/* Defaults */}
            {config?.defaults ? (
              <section className="mb-10">
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80">
                  預設設定
                </h2>
                <DefaultsList defaults={config.defaults} />
              </section>
            ) : null}

            {/* Constraints */}
            {config?.constraints ? (
              <section className="mb-10">
                <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80">
                  約束 / 保證
                </h2>
                <ConstraintsList constraints={config.constraints} />
              </section>
            ) : null}

            {/* Actions */}
            <div className="sticky bottom-6 z-10 mt-12 flex items-center gap-3 rounded-sm border border-amber-900/30 bg-stone-900/80 px-5 py-4 backdrop-blur-sm">
              {skill.installed ? (
                <>
                  <div className="flex-1">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-emerald-400">
                      ✓ 已加入「我的 Skill」
                    </div>
                    <div className="mt-0.5 font-fraunces text-[12px] italic text-stone-500">
                      建立新專案時即可選用此 Skill。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleUseSkill}
                    className="rounded-sm bg-amber-500 px-5 py-2.5 font-mono text-[13px] uppercase tracking-wider text-stone-950 transition-colors hover:bg-amber-400"
                  >
                    用此 Skill 建立專案
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-stone-400">
                      尚未啟用
                    </div>
                    <div className="mt-0.5 font-fraunces text-[12px] italic text-stone-500">
                      加入「我的 Skill」後可在建立新專案時選用。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstall}
                    disabled={installing}
                    className="rounded-sm bg-amber-500 px-5 py-2.5 font-mono text-[13px] uppercase tracking-wider text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {installing ? '加入中…' : '+ 加入我的 Skill'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── Sub-components ───

function PipelineStageRow({ index, stage }: { index: number; stage: SkillPipelineStage }) {
  const label = STAGE_LABELS[stage.stage] ?? stage.stage
  const settingsEntries = stage.settings
    ? Object.entries(stage.settings).filter(([, v]) => v !== undefined && v !== null)
    : []

  return (
    <li className="flex items-start gap-4 rounded-sm border border-stone-800 bg-stone-900/40 p-4">
      <div className="font-mono text-[11px] tracking-[0.2em] text-amber-500/70">
        {String(index).padStart(2, '0')}
      </div>
      <div className="flex-1">
        <div className="font-serif-cn text-base font-medium text-stone-100">{label}</div>
        {stage.model ? (
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-violet-400">
            model · {stage.model}
          </div>
        ) : null}
        {settingsEntries.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-stone-400">
            {settingsEntries.map(([k, v]) => (
              <span key={k}>
                <span className="text-stone-600">{k}</span>:{' '}
                <span>{String(v)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function DefaultsList({ defaults }: { defaults: SkillDefaults }) {
  const rows: Array<{ label: string; value: string }> = []
  if (defaults.aspectRatio) rows.push({ label: '畫面比例', value: defaults.aspectRatio })
  if (typeof defaults.durationPerShotSec === 'number')
    rows.push({ label: '每鏡時長', value: `${defaults.durationPerShotSec}s` })
  if (typeof defaults.shotCount === 'number')
    rows.push({ label: '鏡頭數', value: `${defaults.shotCount}` })
  if (defaults.storyboardGrid) rows.push({ label: '分鏡網格', value: defaults.storyboardGrid })
  if (defaults.resolution) rows.push({ label: '解析度', value: defaults.resolution })
  if (defaults.audioMode)
    rows.push({ label: '音訊模式', value: AUDIO_MODE_LABELS[defaults.audioMode] ?? defaults.audioMode })
  if (defaults.voNarration)
    rows.push({
      label: '旁白',
      value:
        defaults.voNarration === 'never'
          ? '不使用'
          : defaults.voNarration === 'always'
            ? '始終使用'
            : '依要求加入',
    })
  if (defaults.visualStyleId)
    rows.push({ label: '視覺風格 (ID)', value: defaults.visualStyleId })

  if (rows.length === 0) {
    return (
      <p className="font-fraunces text-[12px] italic text-stone-500">
        此 Skill 未指定預設設定 — 沿用使用者偏好。
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center justify-between gap-3 rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-2.5"
        >
          <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
            {r.label}
          </span>
          <span className="font-serif-cn text-[14px] text-stone-200">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function ConstraintsList({ constraints }: { constraints: SkillConstraints }) {
  const items: string[] = []
  if (constraints.enforceAudioRefPerCharacter)
    items.push('每個角色必須在「劇集設定」綁定參考音頻才能啟動')
  if (constraints.forcePortrait) items.push('強制直式輸出')
  if (constraints.forceLandscape) items.push('強制橫式輸出')
  if (constraints.forbiddenSubjects && constraints.forbiddenSubjects.length > 0)
    items.push(`不允許主體：${constraints.forbiddenSubjects.join(' / ')}`)

  if (items.length === 0) {
    return (
      <p className="font-fraunces text-[12px] italic text-stone-500">
        無特殊約束。
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-sm border border-amber-900/30 bg-amber-500/5 px-4 py-2.5"
        >
          <span className="font-mono text-[12px] text-amber-400">!</span>
          <span className="font-fraunces text-[13px] text-amber-100/90">{it}</span>
        </li>
      ))}
    </ul>
  )
}

// ─── Config parser ───
//
// API returns `config` as `unknown` (Prisma JSON column). Validate
// the version + pipeline shape minimally so the UI doesn't crash on
// older drafts. Type-narrowed result is the source of truth for the
// section renderers above.

function parseSkillConfig(raw: unknown): SkillConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) return null

  // pipeline: array of { stage: string, model?: string, settings?: object }
  const rawPipeline = Array.isArray(obj.pipeline) ? obj.pipeline : []
  const pipeline: SkillPipelineStage[] = []
  for (const stage of rawPipeline) {
    if (!stage || typeof stage !== 'object') continue
    const s = stage as Record<string, unknown>
    if (typeof s.stage !== 'string') continue
    pipeline.push({
      stage: s.stage as SkillPipelineStage['stage'],
      ...(typeof s.model === 'string' ? { model: s.model } : {}),
      ...(s.settings && typeof s.settings === 'object'
        ? { settings: s.settings as Record<string, unknown> }
        : {}),
    })
  }

  return {
    version: 1,
    input: (obj.input as SkillConfig['input']) ?? {},
    pipeline,
    defaults: (obj.defaults as SkillDefaults) ?? {},
    ...(obj.prompts && typeof obj.prompts === 'object'
      ? { prompts: obj.prompts as SkillConfig['prompts'] }
      : {}),
    ...(obj.constraints && typeof obj.constraints === 'object'
      ? { constraints: obj.constraints as SkillConstraints }
      : {}),
  }
}
