'use client'

import { Noto_Sans_TC } from 'next/font/google'

const globalErrorFont = Noto_Sans_TC({
  weight: 'variable',
  preload: false,
})

export function GlobalErrorContent({ reset }: { reset: () => void }) {
  return (
    <main
      data-testid="global-error-screen"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <section
        role="alert"
        aria-live="assertive"
        style={{
          width: 'min(100%, 620px)',
          border: '1px solid #263642',
          borderRadius: '16px',
          background: '#111B24',
          padding: 'clamp(24px, 5vw, 40px)',
          textAlign: 'center',
        }}
      >
        <div style={{ color: '#79C7D4', fontSize: '12px', letterSpacing: '0.12em' }}>
          SYSTEM RECOVERY
        </div>
        <h1 style={{ margin: '12px 0 0', fontSize: 'clamp(24px, 5vw, 34px)' }}>
          Kuiper 暫時無法啟動
        </h1>
        <p style={{ margin: '14px auto 0', maxWidth: '480px', color: '#A7B3BC', lineHeight: 1.7 }}>
          已保存的專案不會受到影響。請重新啟動介面；若問題持續發生，請稍後再試。
          <br />
          Saved projects are safe. Retry the interface or return later.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: '48px',
            marginTop: '24px',
            border: 0,
            borderRadius: '8px',
            background: '#3E73B9',
            color: '#FFFFFF',
            padding: '0 22px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          重新啟動 / Retry
        </button>
      </section>
    </main>
  )
}

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh">
      <body
        className={globalErrorFont.className}
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#070B0F',
          color: '#F2F6F7',
        }}
      >
        <GlobalErrorContent reset={reset} />
      </body>
    </html>
  )
}
