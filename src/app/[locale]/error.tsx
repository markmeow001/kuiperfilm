'use client'

import { SystemStateScreen } from '@/components/system/SystemStateScreen'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <SystemStateScreen
      state="error"
      errorDigest={error.digest}
      onRetry={reset}
    />
  )
}
