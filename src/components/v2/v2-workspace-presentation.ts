import type { V2Step } from './v2-types'

interface V2WorkspacePresentation {
  steps: readonly V2Step[]
  stagePrefix: string
  progressLabel: string
  currentStage: string
  currentStep: string
  completed: string
  flowTitle: string
  flowDescription: string
  allProjectsTitle: string
  backToProjects: string
  mobileFlowLabel: string
  previousStage: (label: string) => string
  firstStage: string
  switchStage: string
  complete: string
  signIn: string
  utility: {
    canvas: string
    playground: string
    visualDevelopment: string
    liveComposite: string
  }
}

const ZH: V2WorkspacePresentation = {
  steps: [
    { id: 'home', num: '00', label: '首頁', subtitle: '製作總覽', icon: 'film' },
    { id: 'script', num: '01', label: '劇本', subtitle: '故事與分集', icon: 'edit' },
    {
      id: 'subjects',
      num: '02',
      label: '劇本拆解',
      subtitle: '角色、場景與道具',
      icon: 'userCircle',
    },
    { id: 'storyboard', num: '03', label: '分鏡', subtitle: '鏡頭規劃', icon: 'image' },
    { id: 'voice', num: '04', label: '配音', subtitle: '聲音製作', icon: 'mic' },
    { id: 'final', num: '05', label: '素材交付', subtitle: '交付 ZIP', icon: 'play' },
  ],
  stagePrefix: '階段',
  progressLabel: '製作進度',
  currentStage: '目前階段',
  currentStep: '目前步驟',
  completed: '已完成',
  flowTitle: '製作流程',
  flowDescription: '每一步都保留版本、成本與生成狀態。',
  allProjectsTitle: '所有專案・切換專案',
  backToProjects: '回到所有專案',
  mobileFlowLabel: '行動版製作流程',
  previousStage: (label) => `上一階段：${label}`,
  firstStage: '已是第一階段',
  switchStage: '切換製作階段',
  complete: '完成',
  signIn: '登入帳號',
  utility: {
    canvas: '無限畫布',
    playground: 'Playground',
    visualDevelopment: '角色視覺開發',
    liveComposite: 'AI 實拍重製',
  },
}

const EN: V2WorkspacePresentation = {
  steps: [
    { id: 'home', num: '00', label: 'Home', subtitle: 'Production overview', icon: 'film' },
    { id: 'script', num: '01', label: 'Screenplay', subtitle: 'Story and episodes', icon: 'edit' },
    {
      id: 'subjects',
      num: '02',
      label: 'Breakdown',
      subtitle: 'Characters, locations and props',
      icon: 'userCircle',
    },
    { id: 'storyboard', num: '03', label: 'Storyboard', subtitle: 'Shot planning', icon: 'image' },
    { id: 'voice', num: '04', label: 'Voice', subtitle: 'Audio production', icon: 'mic' },
    { id: 'final', num: '05', label: 'Asset Delivery', subtitle: 'Handoff ZIP', icon: 'play' },
  ],
  stagePrefix: 'Stage',
  progressLabel: 'Production progress',
  currentStage: 'Current stage',
  currentStep: 'Current step',
  completed: 'Completed',
  flowTitle: 'Production flow',
  flowDescription: 'Every step retains version, cost, and generation status.',
  allProjectsTitle: 'All projects · Switch project',
  backToProjects: 'Back to all projects',
  mobileFlowLabel: 'Mobile production flow',
  previousStage: (label) => `Previous stage: ${label}`,
  firstStage: 'Already at the first stage',
  switchStage: 'Switch production stage',
  complete: 'Complete',
  signIn: 'Sign in',
  utility: {
    canvas: 'Infinite canvas',
    playground: 'Playground',
    visualDevelopment: 'Character visual development',
    liveComposite: 'AI live-action reconstruction',
  },
}

export function getV2WorkspacePresentation(
  locale: string,
): V2WorkspacePresentation {
  return locale.toLowerCase().startsWith('en') ? EN : ZH
}
