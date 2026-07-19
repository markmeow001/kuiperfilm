'use client'

import type {
  ReconstructionAudioMode,
  ReconstructionCreativeBrief,
  ReconstructionDialogueLine,
} from '@/lib/playground/reconstruction-contract'

function Field(props: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
}) {
  const className = 'w-full rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-text-tertiary/70 focus:border-cyan-400/60'
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-text-secondary">{props.label}</span>
      {props.multiline ? (
        <textarea className={`${className} min-h-20 resize-y`} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input className={className} placeholder={props.placeholder} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      )}
    </label>
  )
}

interface ReconstructionBriefFormProps {
  brief: ReconstructionCreativeBrief
  onBriefChange: (brief: ReconstructionCreativeBrief) => void
  dialogue: ReconstructionDialogueLine[]
  onAddDialogue: () => void
  onUpdateDialogue: (id: string, patch: Partial<ReconstructionDialogueLine>) => void
  onRemoveDialogue: (id: string) => void
  audioMode: ReconstructionAudioMode
  onAudioModeChange: (mode: ReconstructionAudioMode) => void
  hasAudio: boolean
}

export function ReconstructionBriefForm(props: ReconstructionBriefFormProps) {
  const patchBrief = (patch: Partial<ReconstructionCreativeBrief>) => props.onBriefChange({ ...props.brief, ...patch })
  return (
    <>
      <div className="space-y-3">
        <div className="text-sm font-medium text-white">重建設定</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="年代" placeholder="例如：1930 年代民國" value={props.brief.era} onChange={(era) => patchBrief({ era })} />
          <Field label="時間／天氣" placeholder="例如：陰天午後，空氣略帶霧氣" value={props.brief.weatherAndTime} onChange={(weatherAndTime) => patchBrief({ weatherAndTime })} />
        </div>
        <Field label="新場景" placeholder="例如：上海法租界街道與老式商行" value={props.brief.location} onChange={(location) => patchBrief({ location })} />
        <Field label="故事情境" placeholder="例如：人物在動盪年代執行一場帶有危機感的秘密行動" value={props.brief.story} multiline onChange={(story) => patchBrief({ story })} />
        <Field label="新人物設計" placeholder="例如：電影寫實的民國女情報員，真實皮膚、自然五官與符合年代的髮型" value={props.brief.characterDesign} multiline onChange={(characterDesign) => patchBrief({ characterDesign })} />
        <Field label="服裝／髮妝／特效妝" placeholder="例如：深色旗袍、低髮髻、自然底妝與舊傷疤特效妝，布料隨動作自然擺動" value={props.brief.wardrobe} multiline onChange={(wardrobe) => patchBrief({ wardrobe })} />
        <Field label="影像氣氛" placeholder="例如：寫實電影質感，克制、緊張、有敘事性的光影" value={props.brief.mood} onChange={(mood) => patchBrief({ mood })} />
        <Field label="背景如何持續運動" placeholder="例如：路人、旗幟、車輛、煙霧與光影持續自然運動，不要像靜態照片" value={props.brief.backgroundMotion} multiline onChange={(backgroundMotion) => patchBrief({ backgroundMotion })} />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={props.brief.replacePeople} onChange={(event) => patchBrief({ replacePeople: event.target.checked })} className="accent-cyan-400" />
          完整替換原演員外觀，只保留表情、情緒與動作
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-white">對白契約</div>
          <button type="button" onClick={props.onAddDialogue} className="text-xs text-cyan-300 hover:text-cyan-200">＋ 新增對白</button>
        </div>
        <p className="text-xs leading-5 text-text-tertiary">AI 不會從抽幀猜台詞。可輸入逐句對白供模型理解；選擇保留原音時，輸出會重新封裝原片音軌，確保台詞不被改寫。</p>
        {props.dialogue.map((line) => (
          <div key={line.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="grid grid-cols-[1fr_72px_72px_auto] gap-2">
              <input aria-label="說話者" value={line.speaker} onChange={(event) => props.onUpdateDialogue(line.id, { speaker: event.target.value })} className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <input aria-label="開始秒數" type="number" min="0" step="0.1" value={line.startSec} onChange={(event) => props.onUpdateDialogue(line.id, { startSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <input aria-label="結束秒數" type="number" min="0" step="0.1" value={line.endSec} onChange={(event) => props.onUpdateDialogue(line.id, { endSec: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
              <button type="button" aria-label="刪除對白" onClick={() => props.onRemoveDialogue(line.id)} className="text-text-tertiary hover:text-red-300">×</button>
            </div>
            <textarea aria-label="對白內容" placeholder="逐字輸入原本對白" value={line.text} onChange={(event) => props.onUpdateDialogue(line.id, { text: event.target.value })} className="min-h-16 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-sm" />
            <input aria-label="說話情緒" placeholder="情緒與語氣，例如：壓低聲音、焦急但克制" value={line.emotion} onChange={(event) => props.onUpdateDialogue(line.id, { emotion: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs" />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!props.hasAudio} onClick={() => props.onAudioModeChange('preserve-original')} className={`rounded-xl border px-3 py-2.5 text-xs ${props.audioMode === 'preserve-original' ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-text-tertiary'} disabled:opacity-40`}>保留原始對白音軌</button>
          <button type="button" onClick={() => props.onAudioModeChange('generate')} className={`rounded-xl border px-3 py-2.5 text-xs ${props.audioMode === 'generate' ? 'border-violet-400/50 bg-violet-400/10 text-violet-200' : 'border-white/10 text-text-tertiary'}`}>讓模型生成聲音</button>
        </div>
      </div>
    </>
  )
}
