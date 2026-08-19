'use client'

import { useEffect, useState } from 'react'

interface MobileVoiceLine {
  id: string
  lineIndex: number
  speaker: string
  content: string
  matchedPanelId: string | null
}

export interface MobileVoiceDialogueLabels {
  contentLabel: string
  cancel: string
  save: string
  saving: string
}

export function MobileVoiceDialogueEditor({
  line,
  canEdit,
  labels,
  onSave,
}: {
  line: MobileVoiceLine
  canEdit: boolean
  labels: MobileVoiceDialogueLabels
  onSave: (content: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(line.content)
  const [saving, setSaving] = useState(false)
  const dirty = draft !== line.content

  useEffect(() => {
    setDraft(line.content)
  }, [line.content])

  return (
    <li className="rounded-sm border border-stone-800 bg-stone-950/40 px-3 py-3">
      <div className="mb-2 font-mono text-[10px] tracking-wider text-amber-400">
        {line.speaker}
      </div>
      {canEdit ? (
        <textarea
          aria-label={labels.contentLabel}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          className="min-h-11 w-full rounded-sm border border-stone-800 bg-stone-900 px-3 py-2 font-serif-cn text-sm text-stone-100 focus:border-amber-500/60 focus:outline-none"
        />
      ) : (
        <p className="font-serif-cn text-sm text-stone-100">{line.content}</p>
      )}
      {canEdit && dirty ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDraft(line.content)}
            className="min-h-11 rounded-sm border border-stone-800 font-mono text-[10px] tracking-wider text-stone-400 active:text-stone-200"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(draft)
              } finally {
                setSaving(false)
              }
            }}
            disabled={saving}
            className="min-h-11 rounded-sm bg-amber-500 font-mono text-[10px] tracking-wider text-stone-950 active:bg-amber-400 disabled:opacity-50"
          >
            {saving ? labels.saving : labels.save}
          </button>
        </div>
      ) : null}
    </li>
  )
}
