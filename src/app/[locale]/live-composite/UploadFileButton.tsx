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
    <label
      data-live-composite-touch-target
      className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] px-3 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--process-cyan)] ${disabled ? 'cursor-not-allowed text-[var(--darkroom-subtle)] opacity-50' : 'cursor-pointer text-[var(--darkroom-muted)] hover:border-[var(--process-cyan)] hover:text-[var(--darkroom-text)]'}`}
    >
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
