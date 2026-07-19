'use client'

import { AppIcon } from '@/components/ui/icons'
import { ALLOWED_TRACK_B_MODELS } from './lib/atlascloud-r2v-contract'

export type LiveCompositeWorkflowStep = 1 | 2 | 3 | 4 | 5 | 6

interface WorkflowStepDefinition {
  id: LiveCompositeWorkflowStep
  label: string
  shortLabel: string
  optional?: boolean
}

const WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  { id: 1, label: '上傳實拍影片', shortLabel: '影片' },
  { id: 2, label: 'AI 辨識人物', shortLabel: '辨識' },
  { id: 3, label: '檢查人物邊緣', shortLabel: '修邊' },
  { id: 4, label: '更換或生成背景', shortLabel: '背景' },
  { id: 5, label: '加入虛擬角色', shortLabel: '角色', optional: true },
  { id: 6, label: '預覽與輸出', shortLabel: '輸出' },
]

/**
 * Track B「表演驅動角色重製」七步主流程（v2.1 §7）。
 * 已具備的能力映射到現有工作區步驟；生成側步驟在 B0 benchmark
 * 放行前一律顯示為「規劃中」，不得偽裝成可點擊的功能。
 */
interface TrackBStepDefinition {
  id: number
  label: string
  /** 已存在的能力 → 對應現有工作區步驟；undefined = 規劃中（待 B0 放行）。 */
  mappedStep?: LiveCompositeWorkflowStep
}

const TRACK_B_STEPS: TrackBStepDefinition[] = [
  { id: 1, label: '表演素材', mappedStep: 1 },
  { id: 2, label: '表演分析', mappedStep: 2 },
  { id: 3, label: 'AI 角色' },
  { id: 4, label: 'AI 場景' },
  { id: 5, label: '快速預覽' },
  { id: 6, label: '品質檢查' },
  { id: 7, label: '正式輸出' },
]

interface LiveCompositeWorkflowGuideProps {
  activeStep: LiveCompositeWorkflowStep
  completedSteps: ReadonlySet<LiveCompositeWorkflowStep>
  onStepChange: (step: LiveCompositeWorkflowStep) => void
}

function TrackBPrimaryFlow({ activeStep, onStepChange }: { activeStep: LiveCompositeWorkflowStep; onStepChange: (step: LiveCompositeWorkflowStep) => void }) {
  return (
    <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300">主流程 · 表演驅動角色重製</div>
        <span className="rounded-full border border-cyan-400/30 px-2 py-0.5 text-[10px] text-cyan-200">Track B</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-stone-500">真人只提供表演（表情、眼神、口型、動作與節奏）；最終人物與場景會被 AI 重新生成。</p>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {TRACK_B_STEPS.map((step) => {
          const available = step.mappedStep !== undefined
          const active = available && step.mappedStep === activeStep
          return (
            <button
              key={step.id}
              type="button"
              disabled={!available}
              aria-disabled={!available}
              aria-label={available ? `Track B ${step.id}. ${step.label}` : `Track B ${step.id}. ${step.label}（規劃中，待 B0 放行）`}
              aria-current={active ? 'step' : undefined}
              title={available ? step.label : `${step.label}：規劃中，待 B0 benchmark 放行`}
              onClick={() => {
                if (step.mappedStep !== undefined) onStepChange(step.mappedStep)
              }}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-0.5 py-2 transition-colors ${active ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : available ? 'border-white/10 bg-black/20 text-stone-400 hover:border-white/20 hover:text-stone-200' : 'cursor-not-allowed border-white/5 bg-black/10 text-stone-700'}`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full border border-current/30 text-[10px] font-mono">{step.id}</span>
              <span className="truncate text-[10px]">{step.label}</span>
              {available ? null : <span className="text-[8px] leading-3 text-amber-500/80">規劃中</span>}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-[10px] leading-4 text-stone-600">
        <span className="text-stone-500">生成引擎（僅此二，其餘不提供）：</span>
        {ALLOWED_TRACK_B_MODELS.map((modelKey) => (
          <span key={modelKey} className="mr-2 font-mono text-stone-500">{modelKey}</span>
        ))}
      </div>
      <div className="mt-1 text-[10px] leading-4 text-amber-500/70">AI 角色／AI 場景／預覽／正式輸出為規劃中功能，待 B0 benchmark 放行後開放。</div>
    </div>
  )
}

export function LiveCompositeWorkflowGuide({ activeStep, completedSteps, onStepChange }: LiveCompositeWorkflowGuideProps) {
  const activeDefinition = WORKFLOW_STEPS.find((step) => step.id === activeStep) ?? WORKFLOW_STEPS[0]

  return (
    <section className="border-b border-white/10 bg-[#0d1115] px-4 py-4" aria-label="AI 實拍重製流程">
      <TrackBPrimaryFlow activeStep={activeStep} onStepChange={onStepChange} />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-stone-500">次要流程 · 傳統合成（Track A）· Step {String(activeStep).padStart(2, '0')} / 06</div>
          <div className="mt-1 text-base font-semibold text-stone-100">{activeDefinition.label}</div>
        </div>
        {activeDefinition.optional ? <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-stone-500">選用</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-6 gap-1.5">
        {WORKFLOW_STEPS.map((step) => {
          const active = step.id === activeStep
          const completed = completedSteps.has(step.id)
          return (
            <button key={step.id} type="button" aria-label={`${step.id}. ${step.label}${step.optional ? '（選用）' : ''}`} aria-current={active ? 'step' : undefined} title={step.label} onClick={() => onStepChange(step.id)} className={`group flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors ${active ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-100' : completed ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300' : 'border-white/10 bg-black/20 text-stone-600 hover:border-white/20 hover:text-stone-300'}`}>
              <span className="grid h-5 w-5 place-items-center rounded-full border border-current/30 text-[10px] font-mono">{completed && !active ? <AppIcon name="circleCheck" className="h-3 w-3" /> : step.id}</span>
              <span className="truncate text-[10px]">{step.shortLabel}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
