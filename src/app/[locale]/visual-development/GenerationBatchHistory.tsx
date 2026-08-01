import { AppIcon } from '@/components/ui/icons'
import type { CastingBatchView } from './visual-development-types'

interface GenerationBatchHistoryProps {
  batches: CastingBatchView[]
  activeBatchId: string
  onSelect: (batchId: string) => void
  title: string
  description: string
  newest: string
}

export function GenerationBatchHistory({
  batches,
  activeBatchId,
  onSelect,
  title,
  description,
  newest,
}: GenerationBatchHistoryProps) {
  if (batches.length < 2) return null

  return (
    <div className="border-b border-white/[0.07] bg-black/[0.16] px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-primary-400">
            <AppIcon name="clock" className="h-3.5 w-3.5" />
            {title}
          </div>
          <p className="mt-1 font-serif-cn text-[10px] text-text-tertiary">{description}</p>
        </div>
        <span className="font-mono text-[8px] text-text-tertiary">{batches.length}</span>
      </div>
      <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
        {batches.map((batch, index) => {
          const selected = batch.id === activeBatchId
          return (
            <button
              key={batch.id}
              type="button"
              onClick={() => onSelect(batch.id)}
              aria-pressed={selected}
              className={`min-w-[190px] snap-start rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 ${selected ? 'border-primary-500/55 bg-primary-500/[0.12]' : 'border-white/[0.08] bg-[#0c0c0f] hover:border-primary-500/25'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`font-mono text-[9px] ${selected ? 'text-primary-300' : 'text-text-secondary'}`}>
                  BATCH {String(batches.length - index).padStart(2, '0')}
                </span>
                {index === 0 && <span className="rounded bg-primary-500 px-1.5 py-0.5 font-mono text-[7px] font-semibold text-black">{newest}</span>}
              </span>
              <span className="mt-1.5 block truncate text-[10px] text-white">{batch.modelId}</span>
              <span className="mt-1 block font-mono text-[8px] text-text-tertiary">
                {batch.candidateCount} · {batch.aspectRatio}{batch.resolution ? ` · ${batch.resolution}` : ''}
              </span>
              {batch.createdAt && <span className="mt-1 block font-mono text-[7px] text-text-tertiary/70">{formatTimestamp(batch.createdAt)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
