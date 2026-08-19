type LandingProductionRailProps = {
  title: string
  description: string
  labels: [string, string, string, string, string, string]
}

const nodeMeta = [
  { code: 'PRJ', value: '霧港來信' },
  { code: 'EP', value: '01' },
  { code: 'SC', value: '12' },
  { code: 'SH', value: '04B' },
  { code: 'TK', value: 'V04' },
  { code: 'DLV', value: 'LOCKED' },
] as const

export function LandingProductionRail({
  title,
  description,
  labels,
}: LandingProductionRailProps) {
  return (
    <section
      aria-label={title}
      className="relative overflow-hidden rounded-2xl border border-[#263642] bg-[#0D141B]/96 shadow-[0_34px_110px_rgba(0,0,0,0.46)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[#263642] px-5 py-4 sm:px-6">
        <div>
          <div className="font-mono text-[10px] tracking-[0.26em] text-[#79C7D4]">
            {title.toUpperCase()}
          </div>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#A7B3BC]">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#31505D] bg-[#13262F] px-3 py-1.5 font-mono text-[10px] text-[#79C7D4]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#55AFC0] motion-safe:animate-pulse" />
          LIVE GRAPH
        </div>
      </div>

      <div className="relative px-5 py-7 sm:px-6 sm:py-8">
        <div className="pointer-events-none absolute left-10 right-10 top-[68px] hidden h-px bg-gradient-to-r from-transparent via-[#55AFC0]/55 to-transparent sm:block" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {nodeMeta.map((node, index) => {
            const isShot = index === 3
            const isDelivery = index === 5
            return (
              <div
                key={node.code}
                className={`relative min-h-28 rounded-xl border p-4 transition-colors ${
                  isDelivery
                    ? 'border-[#7A602C] bg-[#251F13]'
                    : isShot
                      ? 'border-[#55AFC0] bg-[#122932] shadow-[0_0_0_1px_rgba(85,175,192,0.18)]'
                      : 'border-[#263642] bg-[#111B24]'
                }`}
              >
                <div className={`font-mono text-[9px] tracking-[0.22em] ${
                  isDelivery ? 'text-[#D9B562]' : 'text-[#79C7D4]'
                }`}>
                  {node.code} · {String(index + 1).padStart(2, '0')}
                </div>
                <div className="mt-3 text-xs text-[#7F909C]">{labels[index]}</div>
                <div className={`mt-1 truncate font-mono text-sm font-semibold ${
                  isDelivery ? 'text-[#E7C87D]' : 'text-[#F2F6F7]'
                }`}>
                  {node.value}
                </div>
                {isShot ? (
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#0A1117]">
                    <div className="h-full w-4/5 rounded-full bg-[#55AFC0]" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#263642] pt-4 font-mono text-[10px] text-[#7F909C]">
          <span><span className="text-[#79C7D4]">32</span> shots</span>
          <span><span className="text-[#79C7D4]">04</span> active jobs</span>
          <span><span className="text-[#79C7D4]">09</span> media versions</span>
          <span className="ml-auto text-[#D9B562]">delivery approval required</span>
        </div>
      </div>
    </section>
  )
}
