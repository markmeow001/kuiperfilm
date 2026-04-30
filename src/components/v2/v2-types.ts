/**
 * Phase 12 (New UI Pivot) — shared types for the v2 workspace shell.
 *
 * The 6 step ids match the 6 routes under /v2/workspace/[projectId]:
 *   home / script / subjects / storyboard / voice / final
 */

export type V2StepId = 'home' | 'script' | 'subjects' | 'storyboard' | 'voice' | 'final'

export interface V2Step {
  id: V2StepId
  /** Two-digit string label rendered in the sidebar (00 / 01 / 02 …) */
  num: string
  /** Chinese label */
  label: string
  /** English subtitle (small italic caption next to the label) */
  subtitle: string
  /** lucide-react icon name registered in src/components/ui/icons/registry */
  icon:
    | 'film'
    | 'edit'
    | 'userCircle'
    | 'image'
    | 'mic'
    | 'play'
}

export const V2_STEPS: readonly V2Step[] = [
  { id: 'home', num: '00', label: '首頁', subtitle: 'Mode', icon: 'film' },
  { id: 'script', num: '01', label: '劇本', subtitle: 'Script', icon: 'edit' },
  { id: 'subjects', num: '02', label: '主體', subtitle: 'Subjects', icon: 'userCircle' },
  { id: 'storyboard', num: '03', label: '分鏡', subtitle: 'Storyboard', icon: 'image' },
  { id: 'voice', num: '04', label: '配音', subtitle: 'Voice', icon: 'mic' },
  { id: 'final', num: '05', label: '成片', subtitle: 'Final Cut', icon: 'play' },
] as const

export function findV2Step(id: V2StepId): V2Step {
  const found = V2_STEPS.find((step) => step.id === id)
  if (!found) {
    throw new Error(`unknown v2 step: ${id}`)
  }
  return found
}

export function v2StepIndex(id: V2StepId): number {
  return V2_STEPS.findIndex((step) => step.id === id)
}
