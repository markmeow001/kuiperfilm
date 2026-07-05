'use client'

/**
 * Mobile Playground — conversational image generation (`/m/playground`).
 *
 * Gemini-mobile-style chat (2026-07-04 redesign per user screenshots +
 * researched spec — see memory project_kuiperfilm_mobile_chat_playground):
 * 64px top bar with the MODEL pill on the left (like "Gemini Pro ˅"),
 * user prompts as large rounded bubbles, AI replies bubble-less at full
 * content width, and a floating pill composer. Type ≥16px everywhere that
 * matters (iOS won't auto-zoom the input), touch targets ≥44px, near-black
 * #131314 background (not pure black, per M3 dark-theme guidance).
 *
 * Rides the same playground run spine as desktop — no new APIs; the run
 * history hydrates the thread.
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

// Gemini-derived dark ramp (spec section D).
const C = {
  bg: '#131314',
  bubble: '#2f3033',
  composer: '#1e1f20',
  text: '#e3e3e3',
  sub: '#9aa0a6',
} as const

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
  // Top-bar pill shows a compact name — full label lives in the sheet.
  const modelShort = modelLabel.replace(/\s*[（(].*$/, '')

  // Oldest → newest so the newest sits by the composer (chat order).
  const thread = useMemo(() => {
    const runs = runsQuery.data?.runs ?? []
    return [...runs]
      .filter((r) => r.outputType === 'image')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [runsQuery.data])

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

  async function submitPrompt(text: string, refKeys: string[]) {
    await submit.mutateAsync({
      prompt: text,
      referenceImages: refKeys,
      referenceVideos: [],
      outputType: 'image',
      modelKey,
      aspectRatio: aspect,
    })
    void runsQuery.refetch()
  }

  async function handleSend() {
    const text = prompt.trim()
    if (!text || !modelKey || submit.isPending) return
    if (text.length > 4000) { setError(`提示詞過長（${text.length}/4000）`); return }
    setError(null)
    try {
      await submitPrompt(text, refs.map((r) => r.key))
      setPrompt('')
      setRefs([])
    } catch (err) {
      setError((err as Error)?.message ?? '生成失敗')
    }
  }

  async function handleRegenerate(run: PlaygroundRunRow) {
    if (submit.isPending) return
    setError(null)
    try {
      await submitPrompt(run.prompt, [])
    } catch (err) {
      setError((err as Error)?.message ?? '生成失敗')
    }
  }

  return (
    <div className="flex h-[100svh] flex-col" style={{ background: C.bg, color: C.text }}>
      {/* Top bar — 64px, model pill on the LEFT (Gemini pattern) */}
      <header className="flex h-16 shrink-0 items-center justify-between pl-2 pr-3">
        <button
          type="button"
          onClick={() => setModelSheet(true)}
          className="flex h-12 max-w-[62%] items-center gap-1.5 rounded-full px-3 active:bg-white/10"
        >
          <span className="truncate text-[17px] font-medium">{modelShort}</span>
          <span className="text-[13px]" style={{ color: C.sub }}>▾</span>
        </button>
        <Link
          href={`/${locale}/m/projects`}
          className="flex h-12 items-center rounded-full px-4 text-[15px]"
          style={{ color: C.sub }}
        >
          劇集項目 ›
        </Link>
      </header>

      {/* Thread */}
      <main className="flex-1 overflow-y-auto px-4 pb-4">
        {runsQuery.isLoading ? (
          <p className="pt-16 text-center text-[15px]" style={{ color: C.sub }}>載入中…</p>
        ) : thread.length === 0 ? (
          <div className="pt-24 text-center">
            <div className="text-4xl">✦</div>
            <p className="mt-4 text-[19px] font-medium">描述你想要的畫面</p>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: C.sub }}>
              例：雨夜霓虹街頭，
              <br />一隻機械貓回頭看鏡頭
            </p>
          </div>
        ) : (
          thread.map((run) => (
            <ChatTurn key={run.id} run={run} aspect={aspect} onView={setViewer} onRegenerate={handleRegenerate} />
          ))
        )}
        <div ref={bottomRef} />
      </main>

      {/* Composer — floating pill, safe-area aware */}
      <footer className="shrink-0 px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-1">
        {error ? <p className="mb-2 px-2 text-[14px] text-red-400">{error}</p> : null}
        {refs.length > 0 ? (
          <div className="mb-2 flex gap-2 px-2">
            {refs.map((r, i) => (
              <div key={r.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.signedUrl} alt={`ref ${i + 1}`} className="h-16 w-16 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setRefs((rs) => rs.filter((x) => x.key !== r.key))}
                  className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full text-[15px]"
                  style={{ background: C.bubble, color: C.text }}
                  aria-label="移除參考圖"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          className="flex min-h-14 items-end gap-1 rounded-[28px] py-1.5 pl-1.5 pr-1.5"
          style={{ background: C.composer }}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[22px] active:bg-white/10 disabled:opacity-40"
            style={{ color: C.sub }}
            aria-label="加參考圖"
          >
            {upload.isPending ? '…' : '＋'}
          </button>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述畫面…"
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[16px] leading-6 outline-none"
            style={{ color: C.text }}
          />
          <button
            type="button"
            onClick={() => setAspect(ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length])}
            className="flex h-11 shrink-0 items-center rounded-full px-2.5 text-[13px] font-medium active:bg-white/10"
            style={{ color: C.sub }}
            aria-label="切換寬高比"
          >
            {aspect}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!prompt.trim() || !modelKey || submit.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[20px] font-bold text-stone-950 transition-opacity disabled:opacity-30"
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
            className="absolute inset-x-0 bottom-0 max-h-[65svh] overflow-y-auto rounded-t-3xl p-4 pb-[max(env(safe-area-inset-bottom),16px)]"
            style={{ background: C.composer }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <p className="mb-3 px-2 text-[13px] uppercase tracking-wider" style={{ color: C.sub }}>生圖模型</p>
            {imageModels.length === 0 ? (
              <p className="px-2 py-4 text-[16px]" style={{ color: C.sub }}>無可用模型 — 請在桌面版 /profile 啟用</p>
            ) : null}
            {imageModels.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => { setModelKey(m.value); setModelSheet(false) }}
                className={`block w-full rounded-2xl px-4 py-3.5 text-left text-[16px] leading-6 ${m.value === modelKey ? 'bg-amber-500/15 text-amber-300' : 'active:bg-white/10'}`}
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
            className="absolute bottom-[max(env(safe-area-inset-bottom),20px)] rounded-full px-6 py-3 text-[16px] font-medium"
            style={{ background: C.bubble, color: C.text }}
          >
            下載原圖
          </a>
        </div>
      ) : null}
    </div>
  )
}

function ChatTurn({
  run,
  aspect,
  onView,
  onRegenerate,
}: {
  run: PlaygroundRunRow
  aspect: string
  onView: (url: string) => void
  onRegenerate: (run: PlaygroundRunRow) => void
}) {
  const url = run.resultUrls?.[0] ?? null
  const busy = run.status === 'pending' || run.status === 'running'
  const [aw, ah] = aspect.split(':').map(Number)
  return (
    <div className="mt-6 space-y-3 first:mt-4">
      {/* user prompt — right-aligned bubble (spec: rounded-3xl, 16px, ≤80%) */}
      <div className="flex justify-end">
        <div
          className="max-w-[80%] break-words rounded-3xl rounded-br-lg px-4 py-3 text-[16px] leading-6"
          style={{ background: C.bubble, color: C.text }}
        >
          {run.prompt}
        </div>
      </div>
      {/* AI reply — bubble-less, full content width */}
      {busy ? (
        <div
          className="relative w-full animate-pulse overflow-hidden rounded-2xl"
          style={{ background: C.composer, aspectRatio: aw && ah ? `${aw} / ${ah}` : '3 / 4', maxHeight: '60vh' }}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-2xl text-amber-400">✦</span>
            <span className="text-[14px]" style={{ color: C.sub }}>
              {run.status === 'pending' ? '排隊中…' : '正在生成圖片…'}
            </span>
          </div>
        </div>
      ) : run.status === 'failed' ? (
        <div className="rounded-2xl px-4 py-4" style={{ background: C.composer }}>
          <p className="text-[15px] leading-6 text-red-300">
            生成失敗{run.errorMessage ? `：${run.errorMessage}` : ''}
          </p>
          <button
            type="button"
            onClick={() => onRegenerate(run)}
            className="mt-3 h-11 rounded-full border border-amber-500/50 px-5 text-[15px] font-medium text-amber-400 active:bg-amber-500/10"
          >
            重試
          </button>
        </div>
      ) : url ? (
        <div>
          <button type="button" onClick={() => onView(url)} className="block w-full overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={run.prompt.slice(0, 40)} className="max-h-[70vh] w-full object-cover" loading="lazy" />
          </button>
          {/* action row (spec E: explicit buttons, 48px touch) */}
          <div className="mt-1 flex items-center gap-1">
            <a
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              className="flex h-11 items-center rounded-full px-3 text-[14px] active:bg-white/10"
              style={{ color: C.sub }}
            >
              ⤓ 下載
            </a>
            <button
              type="button"
              onClick={() => onRegenerate(run)}
              className="flex h-11 items-center rounded-full px-3 text-[14px] active:bg-white/10"
              style={{ color: C.sub }}
            >
              ↻ 重新生成
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[14px]" style={{ color: C.sub }}>（無結果）</p>
      )}
    </div>
  )
}
