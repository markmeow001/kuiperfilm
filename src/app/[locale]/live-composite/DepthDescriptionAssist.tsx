'use client'

import { AppIcon } from '@/components/ui/icons'

interface DepthDescriptionAssistProps {
  id: string
  subjectLabel: string
  value: string
  placeholder: string
  busy: boolean
  disabled: boolean
  onChange: (value: string) => void
  onAssist: () => void
}

export function DepthDescriptionAssist({
  id,
  subjectLabel,
  value,
  placeholder,
  busy,
  disabled,
  onChange,
  onAssist,
}: DepthDescriptionAssistProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium text-stone-400">
        用幾句話告訴 AI：{subjectLabel}
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id={id}
          type="text"
          value={value}
          maxLength={500}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-stone-200 outline-none placeholder:text-stone-600 focus:border-cyan-300/45 disabled:opacity-50"
        />
        <button
          type="button"
          aria-label={`AI 補全${subjectLabel}`}
          onClick={onAssist}
          disabled={disabled || busy || !value.trim()}
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-300/[0.07] px-3 text-xs font-medium text-cyan-100 hover:bg-cyan-300/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-stone-600"
        >
          <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
          {busy ? '補全中…' : 'AI 補全'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-stone-600">
        這裡只填簡短構想；按「AI 補全」後才會寫入下方正式描述。主動按下可能產生少量文字分析費用。
      </p>
    </div>
  )
}
