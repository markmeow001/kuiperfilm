'use client'

/**
 * Mobile Playground — conversational image generation (`/m/playground`).
 *
 * The phone-first way to generate: a chat thread where each run is a
 * user bubble (prompt) followed by an assistant bubble (image / progress /
 * error), with a fixed composer at the bottom. Rides the exact same
 * playground run spine as desktop (submit + poll hooks) — no new APIs.
 * History IS the conversation: usePlaygroundRuns hydrates the thread.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  usePlaygroundRuns,
  useSubmitPlaygroundRun,
  useUploadPlaygroundReference,
  type PlaygroundRunRow,
} from '@/lib/query/mutations/playground-mutations'
import { useUserModels } from '@/lib/query/hooks/useUserModels'

const ASPECTS = ['9:16', '1:1', '16:9'] as const
const MAX_REFS = 3

interface MobilePlaygroundChatProps {
  locale: string
}

export function MobilePlaygroundChat({ locale }: MobilePlaygroundChatProps) {
  const runsQuery = usePlaygroundRuns(null, 50)
  const submit = useSubmitPlaygroundRun()
  const upload = useUploadPlaygroundReference()
  const userModels = useUserModels()

  const [prompt, setPrompt] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>('9:16')
  const [refs, setRefs] = useState<Array<{ key: string; signedUrl: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [modelSheet, setModelSheet] = useState(false)
  const [viewer, setViewer] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const imageModels = userModels.data?.image ?? []
  useEffect(() => {
    if (!modelKey && imageModels.length > 0) setModelKey(imageModels[0].value)
  }, [modelKey, imageModels])
  const modelLabel = imageModels.find((m) => m.value === modelKey)?.label ?? '選擇模型'

  // Oldest → newest so the newest sits by the composer (chat order).
  const thread = useMemo(() => {
    const runs = runsQuery.data?.runs ?? []
    return [...runs]
      .filter((r) => r.outputType === 'image')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [runsQuery.data])

  // Keep the newest message in view when the thread grows / completes.
  const threadSig = `${thread.length}:${thread[thread.length - 1]?.status ?? ''}`
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [threadSig])

  async function handlePickRef(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('僅支援 jpg/png/webp'); return }
    if (refs.length >= MAX_REFS) { setError(`參考圖最多 ${MAX_REFS} 張`); return }
    try {
      setError(null)
      const res = await upload.mutateAsync({ file, type: 'image' })
      setRefs((rs) => [...rs, { key: res.key, signedUrl: res.signedUrl }])
    } catch (err) {
      setError((err as Error)?.message ?? '上傳失敗')
    }
  }

  async function handleSend() {
    const text = prompt.trim()
    if (!text || !modelKey || submit.isPending) return
    if (text.length > 4000) { setError(`提示詞過長（${text.length}/4000）`); return }
    setError(null)
    try {
      await submit.mutateAsync({
        prompt: text,
        referenceImages: refs.map((r) => r.key),
        referenceVideos: [],
        outputType: 'image',
        modelKey,
        aspectRatio: aspect,
      })
      setPrompt('')
      setRefs([])
      void runsQuery.refetch()
    } catch (err) {
      setError((err as Error)?.message ?? '生成失敗')
    }
  }

  return (
    <div className="flex h-[100svh] flex-col">
      {/* Header — surface tabs */}
      <header className="flex items-center justify-between border-b border-stone-800 px-4 py-3">
        <div className="font-mono text-[14px] font-semibold tracking-wide text-stone-100">
          ✦ 生圖對話
        </div>
        <Link
          href={`/${locale}/m/projects`}
          className="rounded-full border border-stone-700 px-3 py-1 font-mono text-[12px] text-stone-400"
        >
          劇集項目 ›
        </Link>
      </header>

      {/* Thread */}
      <main className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {runsQuery.isLoading ? (
          <p className="pt-10 text-center font-mono text-[12px] text-stone-500">載入中…</p>
        ) : thread.length === 0 ? (
          <div className="pt-16 text-center">
            <div className="text-3xl">✦</div>
            <p className="mt-2 text-[14px] text-stone-400">描述你想要的畫面，直接生成</p>
            <p className="mt-1 font-mono text-[11px] text-stone-600">例：雨夜霓虹街頭，一隻機械貓回頭看鏡頭</p>
          </div>
        ) : (
          thread.map((run) => <ChatTurn key={run.id} run={run} onView={setViewer} />)
        )}
        <div ref={bottomRef} />
      </main>

      {/* Composer */}
      <footer className="border-t border-stone-800 bg-stone-950 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        {error ? <p className="mb-1 px-1 text-[12px] text-red-400">{error}</p> : null}
        {refs.length > 0 ? (
          <div className="mb-2 flex gap-2 px-1">
            {refs.map((r, i) => (
              <div key={r.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.signedUrl} alt={`ref ${i + 1}`} className="h-12 w-12 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setRefs((rs) => rs.filter((x) => x.key !== r.key))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-stone-700 text-[11px] text-stone-200"
                  aria-label="移除參考圖"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {/* settings row */}
        <div className="mb-2 flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => setModelSheet(true)}
            className="max-w-[55%] truncate rounded-full border border-stone-700 px-3 py-1 font-mono text-[11px] text-stone-300"
          >
            {modelLabel}
          </button>
          <button
            type="button"
            onClick={() => setAspect(ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length])}
            className="rounded-full border border-stone-700 px-3 py-1 font-mono text-[11px] text-stone-300"
          >
            {aspect}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-700 text-lg text-stone-400 disabled:opacity-40"
            aria-label="加參考圖"
          >
            {upload.isPending ? '…' : '＋'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePickRef} />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述畫面…"
            rows={1}
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-2xl border border-stone-700 bg-stone-900 px-3 py-2 text-[15px] text-stone-100 outline-none placeholder:text-stone-600"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!prompt.trim() || !modelKey || submit.isPending}
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-lg font-bold text-stone-950 disabled:opacity-40"
            aria-label="生成"
          >
            ↑
          </button>
        </div>
      </footer>

      {/* Model bottom sheet */}
      {modelSheet ? (
        <div className="fixed inset-0 z-40" onClick={() => setModelSheet(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[60svh] overflow-y-auto rounded-t-2xl border-t border-stone-700 bg-stone-900 p-3 pb-[max(env(safe-area-inset-bottom),12px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 px-1 font-mono text-[11px] uppercase tracking-wider text-stone-500">選擇生圖模型</p>
            {imageModels.length === 0 ? (
              <p className="px-1 py-3 text-[13px] text-stone-400">無可用模型 — 請在桌面版 /profile 啟用</p>
            ) : null}
            {imageModels.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => { setModelKey(m.value); setModelSheet(false) }}
                className={`block w-full rounded-lg px-3 py-2.5 text-left text-[14px] ${m.value === modelKey ? 'bg-amber-500/15 text-amber-300' : 'text-stone-200'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Full-screen image viewer */}
      {viewer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95" onClick={() => setViewer(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewer} alt="生成結果" className="max-h-full max-w-full object-contain" />
          <a
            href={viewer}
            download
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-[max(env(safe-area-inset-bottom),16px)] rounded-full bg-stone-800 px-5 py-2 font-mono text-[13px] text-stone-200"
          >
            下載原圖
          </a>
        </div>
      ) : null}
    </div>
  )
}

function ChatTurn({ run, onView }: { run: PlaygroundRunRow; onView: (url: string) => void }) {
  const url = run.resultUrls?.[0] ?? null
  const busy = run.status === 'pending' || run.status === 'running'
  return (
    <div className="space-y-2">
      {/* user prompt bubble */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-amber-500/15 px-3 py-2 text-[14px] leading-relaxed text-amber-100">
          {run.prompt}
        </div>
      </div>
      {/* assistant bubble */}
      <div className="flex justify-start">
        {busy ? (
          <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-stone-900 px-3 py-2.5">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-600 border-t-amber-400" />
            <span className="font-mono text-[12px] text-stone-400">
              {run.status === 'pending' ? '排隊中…' : '生成中…'}
            </span>
          </div>
        ) : run.status === 'failed' ? (
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-red-950/40 px-3 py-2 text-[13px] text-red-300">
            生成失敗{run.errorMessage ? `：${run.errorMessage}` : ''}
          </div>
        ) : url ? (
          <button type="button" onClick={() => onView(url)} className="max-w-[75%] overflow-hidden rounded-2xl rounded-bl-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={run.prompt.slice(0, 40)} className="w-full" loading="lazy" />
          </button>
        ) : (
          <div className="rounded-2xl rounded-bl-md bg-stone-900 px-3 py-2 font-mono text-[12px] text-stone-500">
            （無結果）
          </div>
        )}
      </div>
    </div>
  )
}
