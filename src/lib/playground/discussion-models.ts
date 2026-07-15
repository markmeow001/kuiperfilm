export const PLAYGROUND_DISCUSSION_MODELS = [
  {
    modelKey: 'openrouter::cognitivecomputations/dolphin-mistral-24b-venice-edition',
    modelId: 'cognitivecomputations/dolphin-mistral-24b-venice-edition',
    label: 'Venice: Uncensored',
    description: '限制較少，適合探索大膽題材與非典型角色。',
  },
  {
    modelKey: 'openrouter::sao10k/l3.3-euryale-70b',
    modelId: 'sao10k/l3.3-euryale-70b',
    label: 'Sao10K · Euryale 70B',
    description: '長篇創作與角色互動取向，適合劇本發展。',
  },
] as const

export type PlaygroundDiscussionModelKey = (typeof PLAYGROUND_DISCUSSION_MODELS)[number]['modelKey']

export function findPlaygroundDiscussionModel(modelKey: string) {
  return PLAYGROUND_DISCUSSION_MODELS.find((model) => model.modelKey === modelKey) ?? null
}
