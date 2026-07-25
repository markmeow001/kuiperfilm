export interface DepthRebuildImageReference {
  url: string
  name: string
}

export interface DepthRebuildCharacterView {
  id: string
  label: string
  sourceBinding: string
  brief: string
  description: string
  reference: DepthRebuildImageReference | null
}

export interface DepthRebuildSceneView {
  id: string
  note: string
  reference: DepthRebuildImageReference
}

export interface DepthRebuildReferenceMappingView {
  id: string
  token: string
  label: string
  kind: 'character' | 'scene'
  ready: boolean
}
