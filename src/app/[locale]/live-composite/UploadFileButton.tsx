'use client'

import { AppIcon } from '@/components/ui/icons'

interface UploadFileButtonProps {
  label: string
  accept: string
  kind: 'video' | 'image'
  disabled?: boolean
  onSelect: (file: File) => void
}

export function UploadFileButton({ label, accept, kind, disabled = false, onSelect }: UploadFileButtonProps) {
  return (
    <label className={`flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm transition-colors ${disabled ? 'cursor-not-allowed text-stone-600 opacity-50' : 'cursor-pointer text-stone-300 hover:bg-white/[0.08] hover:text-white'}`}>
      {kind === 'video' ? <AppIcon name="upload" className="h-4 w-4" /> : <AppIcon name="imageEdit" className="h-4 w-4" />}
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onSelect(file)
        }}
      />
    </label>
  )
}
