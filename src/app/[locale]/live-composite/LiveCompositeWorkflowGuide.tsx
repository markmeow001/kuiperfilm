'use client'

import { AppIcon } from '@/components/ui/icons'
import styles from './LiveCompositeShell.module.css'

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

interface LiveCompositeWorkflowGuideProps {
  activeStep: LiveCompositeWorkflowStep
  completedSteps: ReadonlySet<LiveCompositeWorkflowStep>
  onStepChange: (step: LiveCompositeWorkflowStep) => void
}

export function LiveCompositeWorkflowGuide({ activeStep, completedSteps, onStepChange }: LiveCompositeWorkflowGuideProps) {
  const activeDefinition = WORKFLOW_STEPS.find((step) => step.id === activeStep) ?? WORKFLOW_STEPS[0]

  return (
    <section
      className={styles.workflowGuide}
      aria-label="精修遮罩合成流程"
      data-live-composite-workflow
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`${styles.workflowEyebrow} text-xs font-medium tracking-[0.16em]`}>進階流程 · 精修遮罩合成 · 步驟 {String(activeStep).padStart(2, '0')} / 06</div>
          <div className={`${styles.workflowTitle} mt-1 text-base font-semibold`}>{activeDefinition.label}</div>
        </div>
        {activeDefinition.optional ? <span className={`${styles.workflowOptional} rounded-full px-2 py-1 text-xs`}>選用</span> : null}
      </div>

      <div className={styles.workflowSteps}>
        {WORKFLOW_STEPS.map((step) => {
          const active = step.id === activeStep
          const completed = completedSteps.has(step.id)
          return (
            <button
              key={step.id}
              type="button"
              aria-label={`${step.id}. ${step.label}${step.optional ? '（選用）' : ''}`}
              aria-current={active ? 'step' : undefined}
              title={step.label}
              onClick={() => onStepChange(step.id)}
              className={`${styles.workflowStep} ${
                active
                  ? styles.workflowStepActive
                  : completed
                    ? styles.workflowStepComplete
                    : ''
              }`.trim()}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full border border-current/30 font-mono text-xs">{completed && !active ? <AppIcon name="circleCheck" className="h-3 w-3" /> : step.id}</span>
              <span className="truncate text-xs">{step.shortLabel}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
