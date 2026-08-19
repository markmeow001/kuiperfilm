'use client'

import { useState } from 'react'

const STAGES = ['劇本', '角色世界', '分鏡', '鏡頭', '聲音', '剪輯', '交付'] as const

/**
 * Dev-only unified-dark specimen. It is deliberately data-free and exists
 * only to review the visual contract shared by production routes.
 */
export function ThemeContractPreview() {
  const [stage, setStage] = useState<(typeof STAGES)[number]>('分鏡')

  return (
    <section className="mb-16 overflow-hidden rounded-[20px] border border-[var(--darkroom-border)] bg-[var(--studio-chrome)] shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-7">
        <div>
          <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--process-cyan-strong)]">
            Unified studio contract
          </p>
          <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-white">
            統一深色製片工作區
          </h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--darkroom-muted)]">
            所有流程共用夜藍灰工作室色調，以畫布、工作面與抬升控制三層明度維持閱讀層級。此區只供設計檢查，不連接正式資料。
          </p>
        </div>
        <div className="rounded-full border border-[#c28a24]/45 bg-[#c28a24]/10 px-3 py-1.5 font-mono text-[12px] font-semibold text-[#e1b866]">
          GOLD = APPROVE / DELIVER
        </div>
      </div>

      <div className="border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex gap-1 overflow-x-auto" aria-label="製片進度預覽">
          {STAGES.map((item, index) => {
            const active = item === stage
            return (
              <button
                key={item}
                type="button"
                onClick={() => setStage(item)}
                className={`min-h-11 shrink-0 rounded-[9px] px-3 text-left transition-colors motion-reduce:transition-none ${
                  active
                    ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)] shadow-[inset_3px_0_0_var(--process-cyan)]'
                    : 'text-[var(--darkroom-muted)] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <span className="mr-2 font-mono text-[11px] opacity-70">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-[13px] font-semibold">{item}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <article className="bg-[var(--studio-chrome)] p-5 text-[var(--darkroom-text)] sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--process-cyan)]">
                Planning workspace
              </p>
              <h3 className="mt-1 text-[22px] font-semibold tracking-[-0.025em]">角色與世界觀</h3>
            </div>
            <span className="rounded-full border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)] px-3 py-1 text-[12px] font-semibold text-[var(--darkroom-muted)]">
              草稿已保存
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[128px_minmax(0,1fr)]">
            <nav className="rounded-[12px] border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)] p-2" aria-label="規劃項目預覽">
              {['林若晴', '陳默', '北門車站'].map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={`min-h-11 w-full rounded-[8px] px-3 text-left text-[13px] font-semibold ${
                    index === 0
                      ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                      : 'text-[var(--darkroom-muted)] hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>
            <div className="rounded-[12px] border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
              <p className="text-[13px] font-semibold text-[var(--process-cyan-strong)]">角色契約 v03</p>
              <p className="mt-2 text-[17px] font-semibold">短髮、深灰風衣、銀色懷錶</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--darkroom-muted)]">
                第 1 集鏡頭 01–06 使用此核准版本。修改前先顯示受影響的分鏡與生成任務。
              </p>
              <button type="button" className="mt-4 min-h-11 rounded-[9px] bg-[var(--production-blue)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--production-blue-hover)]">
                儲存角色設定
              </button>
            </div>
          </div>
        </article>

        <article className="border-t border-[var(--darkroom-border)] bg-[var(--darkroom-canvas)] p-5 text-[var(--darkroom-text)] lg:border-l lg:border-t-0 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--process-cyan)]">
                Darkroom surface
              </p>
              <h3 className="mt-1 text-[22px] font-semibold tracking-[-0.025em]">鏡頭 07 · 雨夜月台</h3>
            </div>
            <span className="rounded-full border border-[var(--process-cyan)]/30 bg-[var(--process-cyan-soft)] px-3 py-1 text-[12px] font-semibold text-[var(--process-cyan-strong)]">
              生成中 62%
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_144px]">
            <div className="relative min-h-48 overflow-hidden rounded-[12px] border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_32%,rgba(85,175,192,0.22),transparent_34%),linear-gradient(145deg,#17232d,#070b0f)]" />
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-[62%] rounded-full bg-[var(--process-cyan)]" />
                </div>
                <span className="font-mono text-[11px] text-[var(--darkroom-muted)]">00:07:18</span>
              </div>
            </div>
            <aside className="rounded-[12px] border border-[var(--darkroom-border)] bg-[var(--darkroom-surface)] p-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--darkroom-muted)]">Inspector</p>
              <dl className="mt-3 space-y-3 text-[12px]">
                <div><dt className="text-[var(--darkroom-muted)]">模型</dt><dd className="mt-1 font-semibold">Seedance 2.0</dd></div>
                <div><dt className="text-[var(--darkroom-muted)]">比例</dt><dd className="mt-1 font-semibold">16:9</dd></div>
                <div><dt className="text-[var(--darkroom-muted)]">成本</dt><dd className="mt-1 font-semibold">US$1.15</dd></div>
              </dl>
            </aside>
          </div>
        </article>
      </div>
    </section>
  )
}
