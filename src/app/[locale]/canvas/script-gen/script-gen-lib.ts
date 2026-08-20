/**
 * 脚本生成器（三步骤流程）的纯逻辑：步骤门禁、实体高亮切分、资产工具。
 * 全部纯函数——UI 组件只做渲染与事件，进度/门禁语义在这里被行为测试钉住。
 */
import type { CanvasScriptAsset, CanvasStoryboardShot } from '../lib/canvas-types'

export const ASSET_KIND_LABEL: Record<CanvasScriptAsset['kind'], string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
}

export interface ScriptGenProgress {
  shotsTotal: number
  /** 有画面描述的镜头数（步骤一的「已就绪」）。 */
  shotsReady: number
  assetsTotal: number
  /** 已有设定图（durable key）的资产数。 */
  assetsDone: number
  promptsDone: number
  /** 完成的步骤数（0–3），头部「x/3 完成后可批量生视频」。 */
  completeSteps: 0 | 1 | 2 | 3
  /** 三步全过才允许批量生图/生视频。 */
  batchReady: boolean
}

export function scriptGenProgress(
  shots: readonly CanvasStoryboardShot[],
  assets: readonly CanvasScriptAsset[],
): ScriptGenProgress {
  const shotsReady = shots.filter((shot) => Boolean(shot.description?.trim())).length
  const assetsDone = assets.filter((asset) => Boolean(asset.imageKey)).length
  const promptsDone = shots.filter((shot) => Boolean(shot.finalPrompt?.trim())).length
  const step1 = shots.length > 0 && shotsReady === shots.length
  // 资产步骤：清单可以为空（极简剧本），但列出的每一项都要有图才算完成。
  const step2 = step1 && assetsDone === assets.length
  const step3 = shots.length > 0 && promptsDone === shots.length
  const completeSteps = ((step1 ? 1 : 0) + (step2 ? 1 : 0) + (step3 ? 1 : 0)) as 0 | 1 | 2 | 3
  return {
    shotsTotal: shots.length,
    shotsReady,
    assetsTotal: assets.length,
    assetsDone,
    promptsDone,
    completeSteps,
    batchReady: step1 && step2 && step3,
  }
}

export interface EntityTextSegment {
  text: string
  /** true = 命中资产名（UI 高亮）。 */
  entity: boolean
}

/**
 * 把描述文字按资产名切段供高亮。最长名称优先，避免「沈昭昭」抢走
 * 「现代沈昭昭」的命中；命中不重叠、从左到右。
 */
export function splitByEntityNames(
  text: string,
  names: readonly string[],
): EntityTextSegment[] {
  const cleaned = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  if (!text || cleaned.length === 0) return text ? [{ text, entity: false }] : []
  const segments: EntityTextSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    let hitName: string | null = null
    let hitIndex = text.length
    for (const name of cleaned) {
      const index = text.indexOf(name, cursor)
      if (index !== -1 && (index < hitIndex || (index === hitIndex && name.length > (hitName?.length ?? 0)))) {
        hitIndex = index
        hitName = name
      }
    }
    if (!hitName) {
      segments.push({ text: text.slice(cursor), entity: false })
      break
    }
    if (hitIndex > cursor) segments.push({ text: text.slice(cursor, hitIndex), entity: false })
    segments.push({ text: hitName, entity: true })
    cursor = hitIndex + hitName.length
  }
  return segments
}

/** 该镜头应带的参考图（合成时判定的出场资产 → durable key，跳过没图的）。 */
export function shotReferenceKeys(
  shot: CanvasStoryboardShot,
  assets: readonly CanvasScriptAsset[],
): string[] {
  const byName = new Map(assets.map((asset) => [asset.name, asset]))
  const keys: string[] = []
  for (const name of shot.entities ?? []) {
    const key = byName.get(name)?.imageKey
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/** 资产设定图的生成 prompt：外观设定 ＋ 全局风格统一质感。 */
export function assetImagePrompt(
  asset: Pick<CanvasScriptAsset, 'kind' | 'name' | 'description'>,
  globalStyle: string | null | undefined,
): string {
  const kindLine = asset.kind === 'character'
    ? '单人全身设定图，纯色背景，五官与服装清晰'
    : asset.kind === 'scene'
      ? '场景设定图，无人物，空间与陈设完整'
      : '道具设定图，单一物件居中，纯色背景'
  const lines = [
    `${ASSET_KIND_LABEL[asset.kind]}设定图：${asset.name}`,
    asset.description.trim(),
    kindLine,
  ]
  if (globalStyle?.trim()) lines.push(`整体风格：${globalStyle.trim()}`)
  return lines.filter(Boolean).join('\n')
}

/** 编辑镜头会改变提示词的输入 → 该镜的合成结果作废（fail-closed，不留脏提示词）。 */
export function shotEditInvalidatesPrompt(patch: Partial<CanvasStoryboardShot>): boolean {
  const promptInputs: ReadonlyArray<keyof CanvasStoryboardShot> = [
    'description', 'shotSize', 'cameraMove', 'cameraAngle', 'lens',
    'performance', 'blocking', 'lighting', 'sfx', 'dialogue',
  ]
  return promptInputs.some((key) => key in patch)
}

/**
 * 入口二「角色生成分镜脚本」的卡司：连进脚本节点、已命名的角色节点标题。
 * 名称去重保序；空标题（还没命名）不算——没名字的角色写不进剧本。
 */
export function upstreamCharacterCast(
  upstream: ReadonlyArray<{ type?: string | null; data?: unknown } | null | undefined>,
): Array<{ name: string }> {
  const seen = new Set<string>()
  const cast: Array<{ name: string }> = []
  for (const node of upstream) {
    if (!node || node.type !== 'character') continue
    const title = (node.data as { title?: unknown } | null | undefined)?.title
    const name = typeof title === 'string' ? title.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    cast.push({ name })
  }
  return cast
}

/**
 * 资产改名时同步每个镜头的 entities：旧名换新名（去重）。不同步的话，
 * shotReferenceKeys 会静默查不到旧名 → 该镜批量生成时无声丢参考图。
 */
export function renameAssetInShots(
  shots: readonly CanvasStoryboardShot[],
  oldName: string,
  newName: string,
): CanvasStoryboardShot[] {
  const from = oldName.trim()
  const to = newName.trim()
  if (!from || from === to) return [...shots]
  return shots.map((shot) => {
    if (!shot.entities?.includes(from)) return shot
    const next = shot.entities.map((name) => (name === from ? to : name))
    return { ...shot, entities: [...new Set(next.filter(Boolean))] }
  })
}

export function newScriptAssetId(): string {
  return `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
