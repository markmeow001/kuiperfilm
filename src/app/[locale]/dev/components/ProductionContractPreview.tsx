'use client'

import { useState } from 'react'
import { EntityListPanel } from '@/components/v2/EntityListPanel'
import { GenerationComposer } from '@/components/v2/GenerationComposer'
import { JobCard, type JobStatus } from '@/components/v2/JobCard'
import { PageHeader } from '@/components/v2/PageHeader'
import { ProductionProgress } from '@/components/v2/ProductionProgress'
import { StatusPill } from '@/components/v2/StatusPill'
import { StickyNextStep } from '@/components/v2/StickyNextStep'
import { UiStatePanel, type UiStateKind } from '@/components/v2/UiStatePanel'
import {
  VersionGallery,
  type VersionGalleryVersion,
} from '@/components/v2/VersionGallery'
import { V2_STEPS, type V2StepId } from '@/components/v2/v2-types'

interface DemoEntity {
  id: string
  name: string
  meta: string
  status: 'locked' | 'draft' | 'review'
}

interface DemoVersion extends VersionGalleryVersion {
  frame: string
}

const DEMO_ENTITIES: readonly DemoEntity[] = [
  { id: 'lin', name: '林若晴', meta: '主角 · 角色定裝 v03', status: 'locked' },
  { id: 'chen', name: '陳默', meta: '主角 · 待核准髮型', status: 'review' },
  { id: 'station', name: '北門車站', meta: '場景 · 1934 年雨夜', status: 'draft' },
]

const DEMO_VERSIONS: readonly DemoVersion[] = [
  {
    id: 'v03',
    name: '角色定裝 v03',
    meta: '今天 14:32 · 已鎖定到第 1 集',
    frame: 'FRAME 03',
    locked: true,
    approved: true,
  },
  {
    id: 'v02',
    name: '角色定裝 v02',
    meta: '昨天 20:18 · 上游描述已更新',
    frame: 'FRAME 02',
    stale: true,
  },
  {
    id: 'v01',
    name: '角色定裝 v01',
    meta: '8 月 6 日 · 初稿',
    frame: 'FRAME 01',
  },
]

const UI_STATES: readonly UiStateKind[] = [
  'loading',
  'empty',
  'partial',
  'offline',
  'stale',
  'permission',
  'low-credits',
  'error',
  'conflict',
]

const JOBS: readonly { status: JobStatus; title: string; progress?: number }[] = [
  { status: 'estimated', title: '鏡頭 07 · 成本試算' },
  { status: 'queued', title: '鏡頭 08 · 等待供應商' },
  { status: 'running', title: '鏡頭 09 · 雨夜月台', progress: 62 },
  { status: 'succeeded', title: '鏡頭 06 · 角色近景', progress: 100 },
  { status: 'failed', title: '鏡頭 05 · 車站全景' },
  { status: 'refunded', title: '鏡頭 04 · 測試版本' },
]

/**
 * Dev-only fixtures for reviewing the new production UI contract.
 * This component is intentionally isolated from product APIs and routes.
 */
export function ProductionContractPreview() {
  const [currentStep, setCurrentStep] = useState<V2StepId>('subjects')
  const [selectedEntityId, setSelectedEntityId] = useState('lin')
  const [selectedVersionId, setSelectedVersionId] = useState('v03')

  return (
    <div className="kuiper-dashboard overflow-hidden rounded-[24px]">
      <div className="border-b border-[var(--production-border)] bg-[var(--production-surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="kuiper-dashboard-kicker">Production UI contract</p>
            <p className="mt-1 text-[13px] text-[var(--production-ink-muted)]">
              開發預覽資料，不會呼叫正式 API、建立任務或產生費用。
            </p>
          </div>
          <StatusPill label="Phase 1" detail="UI foundation" tone="active" />
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[284px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--production-border)] bg-[var(--production-muted)] p-5 lg:block">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--production-ink-muted)]">
            製作進度軌
          </p>
          <ProductionProgress currentStep={currentStep} onSelect={setCurrentStep} tone="dark" />
        </aside>

        <div className="min-w-0">
          <div className="border-b border-[var(--production-border)] bg-[var(--production-muted)] p-4 lg:hidden">
            <label className="block">
              <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--production-ink-muted)]">
                目前製作階段
              </span>
              <select
                value={currentStep}
                onChange={(event) => setCurrentStep(event.target.value as V2StepId)}
                className="kuiper-dashboard-input h-11 w-full px-3 text-[14px] font-semibold"
              >
                {V2_STEPS.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.num} · {step.label} / {step.subtitle}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="p-4 sm:p-6 lg:p-8">
          <PageHeader
            eyebrow="Episode 01 · Production desk"
            title="角色與世界觀工作站"
            description="先鎖定可重用的角色、場景與道具版本，再把已核准素材送入分鏡和生成。"
            context={
              <>
                <span>霧港來信</span>
                <span aria-hidden="true">/</span>
                <span>第一集</span>
                <StatusPill label="草稿" tone="neutral" />
              </>
            }
            actions={
              <>
                <button type="button" className="kuiper-dashboard-secondary px-4 text-[14px]">
                  匯入素材
                </button>
                <button type="button" className="kuiper-dashboard-primary px-4 text-[14px]">
                  ＋ 新增角色
                </button>
              </>
            }
          />

          <div className="mt-8 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <EntityListPanel
              title="角色、場景與道具"
              description="搜尋與選取不會改變版本；鎖定後才進入下游。"
              items={DEMO_ENTITIES}
              selectedId={selectedEntityId}
              getItemId={(item) => item.id}
              getSearchText={(item) => `${item.name} ${item.meta}`}
              onSelect={(item) => setSelectedEntityId(item.id)}
              renderItem={({ item }) => (
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{item.name}</p>
                    <p className="mt-1 truncate text-[12px] text-[var(--production-ink-muted)]">
                      {item.meta}
                    </p>
                  </div>
                  <StatusPill
                    label={item.status === 'locked' ? '已鎖定' : item.status === 'review' ? '待核准' : '草稿'}
                    tone={item.status === 'locked' ? 'approval' : item.status === 'review' ? 'warning' : 'neutral'}
                  />
                </div>
              )}
            />

            <section className="kuiper-dashboard-card min-w-0 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--production-border)] pb-4">
                <div>
                  <p className="kuiper-dashboard-kicker">Selected entity</p>
                  <h2 className="kuiper-dashboard-heading mt-1 text-[22px]">林若晴</h2>
                  <p className="mt-1 text-[13px] text-[var(--production-ink-muted)]">
                    角色 ID KPF-CHAR-001 · 被 6 個鏡頭引用
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill label="已核准" tone="approval" />
                  <StatusPill label="版本 v03" tone="info" />
                </div>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)]">
                <div className="flex min-h-64 items-end rounded-[12px] border border-[var(--production-border)] bg-[radial-gradient(circle_at_60%_32%,rgba(85,175,192,0.16),transparent_34%),var(--production-muted)] p-4">
                  <div className="rounded-[10px] border border-[var(--production-border-dark)] bg-[var(--production-surface)] px-3 py-2 text-[12px] text-[var(--production-ink-muted)]">
                    核准預覽 · 3:4 角色定裝圖
                  </div>
                </div>
                <dl className="grid content-start gap-4 text-[14px]">
                  <DemoMeta label="外觀契約" value="短髮、深灰風衣、銀色懷錶" />
                  <DemoMeta label="連戲條件" value="第 1 集鏡頭 01–06 保持此版本" />
                  <DemoMeta label="上游來源" value="劇本拆解 v05 · 人工核准" />
                  <DemoMeta label="下游影響" value="分鏡 3 張、生成任務 2 筆需更新" />
                </dl>
              </div>
            </section>
          </div>

          <section className="mt-10">
            <SectionHeading
              eyebrow="Asset versions"
              title="版本比較、鎖定與核准"
              description="版本狀態同時使用文字與色彩，舊版本不會被靜默覆蓋。"
            />
            <VersionGallery
              className="mt-4"
              versions={DEMO_VERSIONS}
              selectedId={selectedVersionId}
              onSelect={(version) => setSelectedVersionId(version.id)}
              renderPreview={(version) => (
                <div className="grid h-full place-items-center bg-[#202a32] font-mono text-[12px] tracking-[0.18em] text-[#dce4e8]">
                  {version.frame}
                </div>
              )}
              renderActions={() => (
                <button type="button" className="kuiper-dashboard-secondary min-h-11 px-3 text-[13px]">
                  比較
                </button>
              )}
            />
          </section>

          <section className="mt-10">
            <SectionHeading
              eyebrow="Generation"
              title="統一生成順序與送出條件"
              description="所有生成頁使用同一個資訊順序，費用不可取得時不會靜默送出。"
            />
            <GenerationComposer
              className="mt-4"
              prompt={<DemoTextarea value="1934 年雨夜，角色快步走入北門車站；維持既有鏡位與表演節奏。" />}
              references={
                <div className="grid gap-3 sm:grid-cols-3">
                  {['角色 v03', '場景 v02', '鏡頭構圖'].map((label) => (
                    <div key={label} className="flex min-h-20 items-center justify-center rounded-[10px] border border-dashed border-[var(--production-border-dark)] bg-[var(--production-paper)] text-[13px] font-medium text-[var(--production-ink-muted)]">
                      {label}
                    </div>
                  ))}
                </div>
              }
              style={<DemoSelect value="電影寫實" />}
              model={<DemoSelect value="Seedance 2.0 R2V" />}
              ratio={<DemoSelect value="16:9" />}
              count={<DemoSelect value="1 個版本" />}
              advanced={
                <label className="flex min-h-11 items-center gap-3 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-paper)] px-3 text-[14px]">
                  <input type="checkbox" defaultChecked className="h-4 w-4 accent-[var(--production-blue)]" />
                  保留原片鏡位、人物走位與對白節奏
                </label>
              }
              cost={{ status: 'available', value: 'US$1.15', note: '送出前再次向供應商確認；失敗任務會顯示退款狀態。' }}
              ready
              onGenerate={() => undefined}
            />
          </section>

          <section className="mt-10">
            <SectionHeading
              eyebrow="Generation jobs"
              title="任務生命週期"
              description="成本、進度、錯誤與退款都在同一卡片中可追蹤。"
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {JOBS.map((job) => (
                <JobCard
                  key={job.status}
                  title={job.title}
                  status={job.status}
                  model="Seedance 2.0 R2V"
                  cost={job.status === 'estimated' ? 'US$1.15' : 'US$1.12'}
                  progress={job.progress}
                  statusDetail="第 1 集 · Shot 07"
                  error={job.status === 'failed' ? '供應商拒絕輸入格式；原始素材仍安全保留。' : undefined}
                  refund={job.status === 'refunded' ? 'US$1.12 已退回專案額度。' : undefined}
                />
              ))}
            </div>
          </section>

          <section className="mt-10">
            <SectionHeading
              eyebrow="State matrix"
              title="非成功狀態也必須可以繼續工作"
              description="載入、空白、部分完成、離線、版本過期、權限、點數、錯誤與衝突都有明確下一步。"
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {UI_STATES.map((state) => (
                <UiStatePanel key={state} state={state} compact />
              ))}
            </div>
          </section>
          </div>
        </div>
      </div>

      <StickyNextStep
        title="把已核准版本送入分鏡"
        description="下一頁只接收已鎖定的角色與場景版本，避免生成時引用到舊素材。"
        primaryLabel="進入分鏡"
        onPrimaryAction={() => undefined}
        ready
        prerequisites={[
          { id: 'character', label: '角色已核准', met: true },
          { id: 'location', label: '場景已鎖定', met: true },
          { id: 'props', label: '道具已檢查', met: true },
        ]}
      />
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-3xl">
      <p className="kuiper-dashboard-kicker">{eyebrow}</p>
      <h2 className="kuiper-dashboard-heading mt-1 text-[24px] leading-8">{title}</h2>
      <p className="mt-1 text-[14px] leading-6 text-[var(--production-ink-muted)]">{description}</p>
    </div>
  )
}

function DemoMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--production-border)] pb-3 last:border-b-0">
      <dt className="text-[12px] font-semibold text-[var(--production-ink-muted)]">{label}</dt>
      <dd className="mt-1 leading-6 text-[var(--production-ink)]">{value}</dd>
    </div>
  )
}

function DemoSelect({ value }: { value: string }) {
  return (
    <select defaultValue={value} className="kuiper-dashboard-input h-11 w-full px-3 text-[14px]">
      <option>{value}</option>
    </select>
  )
}

function DemoTextarea({ value }: { value: string }) {
  return (
    <textarea
      defaultValue={value}
      rows={4}
      className="kuiper-dashboard-input w-full resize-y px-3 py-2.5 text-[14px] leading-6"
    />
  )
}
