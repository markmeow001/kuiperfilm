import { AppIcon } from '@/components/ui/icons'
import type { CharacterOption } from './visual-development-types'

interface CharacterRosterProps {
  characters: CharacterOption[]
  characterCode: string
  isLoading: boolean
  onCharacterChange: (characterCode: string) => void
  labels: {
    title: string
    loaded: string
    current: string
  }
}

export function CharacterRoster({
  characters,
  characterCode,
  isLoading,
  onCharacterChange,
  labels,
}: CharacterRosterProps) {
  if (characters.length === 0) return null

  return (
    <section aria-label={labels.title} className="mb-4 rounded-2xl border border-white/[0.08] bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
          <AppIcon name="user" className="h-3.5 w-3.5" />
          {labels.title}
        </div>
        <span className="font-serif-cn text-[11px] text-text-tertiary">
          {labels.loaded.replace('{count}', String(characters.length))}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {characters.map((character) => {
          const selected = character.code === characterCode
          return (
            <button
              key={character.code}
              type="button"
              aria-pressed={selected}
              disabled={isLoading || selected}
              onClick={() => onCharacterChange(character.code)}
              className={`group min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                selected
                  ? 'border-primary-500/45 bg-primary-500/[0.12]'
                  : 'border-white/[0.07] bg-[#0d0d10] hover:border-primary-500/25 hover:bg-white/[0.04] disabled:opacity-50'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate font-serif-cn text-xs ${selected ? 'text-white' : 'text-text-secondary group-hover:text-white'}`}>
                  {character.name}
                </span>
                {selected && (
                  <span className="shrink-0 rounded-md bg-primary-500 px-1.5 py-0.5 font-mono text-[7px] font-semibold tracking-[0.08em] text-black">
                    {labels.current}
                  </span>
                )}
              </span>
              <span className="mt-1 flex items-center gap-1.5 font-mono text-[8px] tracking-[0.1em] text-text-tertiary">
                <span className={`h-1.5 w-1.5 rounded-full ${character.status === 'draft' ? 'bg-white/20' : 'bg-primary-400'}`} />
                {character.code}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
