'use client'

import type {
  CameraDirection,
  FramingCrop,
  SubjectMotionDirection,
} from './lib/depth-rebuild-motion-contract'

export interface MotionContractCharacterOption {
  id: string
  label: string
}

export interface DepthRebuildMotionContractPanelProps {
  cameraDirection: CameraDirection
  framingCrop: FramingCrop
  subjectDirection: SubjectMotionDirection
  singleTake: boolean
  lockFraming: boolean
  noDirectionReversal: boolean
  characters: readonly MotionContractCharacterOption[]
  gazeSourceCharacterId: string | null
  gazeTargetCharacterId: string | null
  interactionDescription: string
  disabled?: boolean
  onCameraDirectionChange: (value: CameraDirection) => void
  onFramingCropChange: (value: FramingCrop) => void
  onSubjectDirectionChange: (value: SubjectMotionDirection) => void
  onSingleTakeChange: (value: boolean) => void
  onLockFramingChange: (value: boolean) => void
  onNoDirectionReversalChange: (value: boolean) => void
  onGazeSourceCharacterIdChange: (value: string | null) => void
  onGazeTargetCharacterIdChange: (value: string | null) => void
  onInteractionDescriptionChange: (value: string) => void
}

interface ChoiceOption<Value extends string> {
  value: Value
  label: string
  detail: string
  recommended?: boolean
}

const CAMERA_OPTIONS: readonly ChoiceOption<CameraDirection>[] = [
  {
    value: 'source-matched',
    label: '跟隨原片',
    detail: '逐格沿用 RGB 原片的方向、速度、停頓與反轉',
    recommended: true,
  },
  { value: 'backward', label: '鏡頭後退', detail: '人物前進時，攝影機持續往後退' },
  { value: 'forward', label: '鏡頭前進', detail: '攝影機持續靠近人物' },
  { value: 'static', label: '固定鏡位', detail: '攝影機位置保持不動' },
  { value: 'lateral', label: '橫向跟拍', detail: '攝影機沿人物側面平行移動' },
]

const FRAMING_OPTIONS: readonly ChoiceOption<FramingCrop>[] = [
  {
    value: 'source-matched',
    label: '跟隨原片',
    detail: '逐格沿用 RGB 原片的景別、人物大小、裁切與構圖',
    recommended: true,
  },
  { value: 'close-up', label: '特寫', detail: '臉部與肩膀' },
  { value: 'chest-up', label: '胸上', detail: '胸口以上' },
  { value: 'waist-up', label: '腰上', detail: '腰部以上' },
  { value: 'thigh-up', label: '大腿上', detail: '大腿以上' },
  { value: 'full-body', label: '全身', detail: '頭到腳完整入鏡' },
]

const SUBJECT_OPTIONS: readonly ChoiceOption<SubjectMotionDirection>[] = [
  {
    value: 'source-matched',
    label: '跟隨原片',
    detail: '逐格沿用 RGB 原片的走位、速度、停頓與移動方向',
    recommended: true,
  },
  { value: 'forward', label: '人物前進', detail: '朝鏡頭方向前進' },
  { value: 'backward', label: '人物後退', detail: '背向鏡頭方向移動' },
  { value: 'static', label: '人物固定', detail: '留在原位表演' },
  { value: 'lateral', label: '人物橫移', detail: '橫向穿越畫面' },
]

function ChoiceGrid<Value extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled = false,
}: {
  legend: string
  name: string
  value: Value
  options: readonly ChoiceOption<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-stone-300">{legend}</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((option) => {
          const checked = option.value === value
          return (
            <label
              key={option.value}
              className={`${option.recommended ? 'col-span-2' : ''} rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-cyan-200 ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
              } ${
                checked
                  ? 'border-cyan-300/55 bg-cyan-300/[0.09]'
                  : 'border-white/10 bg-black/20 hover:border-cyan-300/30'
              }`}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-300"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-stone-100">
                    {option.label}
                    {option.recommended ? (
                      <span className="rounded-full border border-cyan-300/25 bg-cyan-300/[0.07] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-cyan-200">
                        建議
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-stone-500">
                    {option.detail}
                  </span>
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function ContractToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-cyan-300/25'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-300"
      />
      <span>
        <span className="block text-sm font-medium text-stone-200">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-stone-500">{description}</span>
      </span>
    </label>
  )
}

export function DepthRebuildMotionContractPanel({
  cameraDirection,
  framingCrop,
  subjectDirection,
  singleTake,
  lockFraming,
  noDirectionReversal,
  characters,
  gazeSourceCharacterId,
  gazeTargetCharacterId,
  interactionDescription,
  disabled = false,
  onCameraDirectionChange,
  onFramingCropChange,
  onSubjectDirectionChange,
  onSingleTakeChange,
  onLockFramingChange,
  onNoDirectionReversalChange,
  onGazeSourceCharacterIdChange,
  onGazeTargetCharacterIdChange,
  onInteractionDescriptionChange,
}: DepthRebuildMotionContractPanelProps) {
  const invalidGazePair = gazeSourceCharacterId !== null && gazeSourceCharacterId === gazeTargetCharacterId
  const hasEnoughCharacters = characters.length >= 2

  return (
    <section aria-labelledby="depth-motion-contract-heading" className="space-y-5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">Motion contract</p>
        <h3 id="depth-motion-contract-heading" className="mt-1 text-base font-semibold text-stone-100">
          運鏡與互動鎖定
        </h3>
        <p className="mt-1 text-xs leading-5 text-stone-500">
          把原片裡不能跑掉的鏡頭與表演寫成清楚指令，送出前仍可逐項修改。
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-cyan-300/20 bg-cyan-300/[0.035]">
        <div className="grid divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-3">
            <p className="text-xs font-semibold text-cyan-100">RGB 原片</p>
            <p className="mt-1 text-[11px] leading-4 text-stone-400">控制運鏡、人物表演、視線與時間節奏。</p>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-cyan-100">Depth 深度</p>
            <p className="mt-1 text-[11px] leading-4 text-stone-400">控制空間、遮擋、人物大小與前後關係。</p>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-cyan-100">角色／場景圖</p>
            <p className="mt-1 text-[11px] leading-4 text-stone-400">只負責外觀與美術，不改寫原片動作。</p>
          </div>
        </div>
        <p className="border-t border-cyan-300/15 px-3 py-2 text-[11px] leading-4 text-amber-100/75">
          預設全部跟隨 RGB 原片。只有確定要修正原片時，才改選固定方向或景別；這些仍是提示詞約束，不是模型 API 的硬鎖。
        </p>
      </div>

      <ChoiceGrid
        legend="攝影機怎麼移動"
        name="depth-rebuild-camera-direction"
        value={cameraDirection}
        options={CAMERA_OPTIONS}
        onChange={onCameraDirectionChange}
        disabled={disabled}
      />
      <ChoiceGrid
        legend="人物怎麼移動"
        name="depth-rebuild-subject-direction"
        value={subjectDirection}
        options={SUBJECT_OPTIONS}
        onChange={onSubjectDirectionChange}
        disabled={disabled}
      />
      <ChoiceGrid
        legend="畫面要保留到哪裡"
        name="depth-rebuild-framing-crop"
        value={framingCrop}
        options={FRAMING_OPTIONS}
        onChange={onFramingCropChange}
        disabled={disabled}
      />

      <div className="grid gap-2">
        <ContractToggle
          label="強制一鏡到底"
          description="開啟後禁止切鏡與跳時間；關閉時依照原片的剪接與鏡頭邊界。"
          checked={singleTake}
          onChange={onSingleTakeChange}
          disabled={disabled}
        />
        <ContractToggle
          label="鎖住人物大小與構圖"
          description="逐格鎖回原片的人物大小與裁切，避免腰上鏡頭突然變成全身或遠景。"
          checked={lockFraming}
          onChange={onLockFramingChange}
          disabled={disabled}
        />
        <ContractToggle
          label="運鏡方向不可反轉"
          description="只在原片確實沒有反轉時開啟；關閉時保留原片既有的方向變化。"
          checked={noDirectionReversal}
          onChange={onNoDirectionReversalChange}
          disabled={disabled}
        />
      </div>

      <fieldset className="rounded-xl border border-white/10 bg-black/20 p-3">
        <legend className="px-1 text-xs font-medium text-stone-300">人物看向與互動</legend>
        <p className="text-[11px] leading-4 text-stone-500">
          保持空白就逐格跟隨原片的頭部與視線；只有需要修正時才指定誰看向誰。
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-stone-400">
            誰要看向對方
            <select
              aria-label="視線來源人物"
              value={gazeSourceCharacterId ?? ''}
              disabled={disabled}
              onChange={(event) => onGazeSourceCharacterIdChange(event.target.value || null)}
              className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-stone-950 px-3 text-sm text-stone-200 outline-none focus:border-cyan-300/50"
            >
              <option value="">跟隨原片（不指定）</option>
              {characters
                .filter((character) => character.id !== gazeTargetCharacterId)
                .map((character) => (
                  <option key={character.id} value={character.id}>{character.label}</option>
                ))}
            </select>
          </label>
          <label className="text-xs text-stone-400">
            要看向誰
            <select
              aria-label="視線目標人物"
              value={gazeTargetCharacterId ?? ''}
              disabled={disabled || !hasEnoughCharacters || gazeSourceCharacterId === null}
              onChange={(event) => onGazeTargetCharacterIdChange(event.target.value || null)}
              className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-stone-950 px-3 text-sm text-stone-200 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <option value="">跟隨原片（不指定）</option>
              {characters
                .filter((character) => character.id !== gazeSourceCharacterId)
                .map((character) => (
                  <option key={character.id} value={character.id}>{character.label}</option>
                ))}
            </select>
          </label>
        </div>
        {invalidGazePair ? (
          <p role="alert" className="mt-2 text-xs text-rose-300">視線來源與目標不能是同一位，請先清除其中一項。</p>
        ) : !hasEnoughCharacters ? (
          <p className="mt-2 text-xs text-stone-600">加入至少兩位角色後，才能設定彼此視線。</p>
        ) : null}
        <label className="mt-3 block text-xs text-stone-400">
          互動細節
          <textarea
            value={interactionDescription}
            disabled={disabled}
            onChange={(event) => onInteractionDescriptionChange(event.target.value)}
            placeholder="例如：男方一路轉頭看向女方，女方說話時兩人保持挽手並同步前進"
            className="mt-1 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-stone-950 px-3 py-2 text-sm leading-5 text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/50"
          />
        </label>
      </fieldset>
    </section>
  )
}
