'use client'

import { useState } from 'react'
import { PLAYGROUND_DISCUSSION_MODELS } from '@/lib/playground/discussion-models'

type DiscussionMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

function nextMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function DiscussionStudio() {
  const [modelKey, setModelKey] = useState(PLAYGROUND_DISCUSSION_MODELS[0].modelKey)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const selectedModel = PLAYGROUND_DISCUSSION_MODELS.find((model) => model.modelKey === modelKey)

  async function sendMessage() {
    const content = draft.trim()
    if (!content || isSending) return
    const userMessage: DiscussionMessage = { id: nextMessageId(), role: 'user', content }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft('')
    setError('')
    setIsSending(true)
    try {
      const response = await fetch('/api/playground/discussion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelKey,
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      })
      const payload = await response.json() as {
        message?: { role?: unknown; content?: unknown }
        error?: { message?: string }
        messageText?: string
      }
      const assistantContent = typeof payload.message?.content === 'string'
        ? payload.message.content.trim()
        : ''
      if (!response.ok || !assistantContent) {
        throw new Error(payload.error?.message || payload.messageText || '模型沒有回傳內容')
      }
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: 'assistant', content: assistantContent },
      ])
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '送出失敗，請稍後再試')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="grid min-h-0 flex-1 grid-cols-1 bg-canvas lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden border-r border-white/[0.07] bg-raised/70 p-6 lg:block">
        <p className="font-mono text-[9px] tracking-[0.24em] text-primary-400">SCRIPT ROOM</p>
        <h1 className="mt-2 font-serif-cn text-2xl font-semibold text-white">劇本討論</h1>
        <p className="mt-3 text-sm leading-6 text-text-secondary">和模型一起拆解人物、節奏、衝突與場次。</p>

        <label className="mt-8 block font-mono text-[10px] uppercase tracking-wider text-stone-500" htmlFor="discussion-model">
          討論模型
        </label>
        <select
          id="discussion-model"
          value={modelKey}
          onChange={(event) => setModelKey(event.target.value as typeof modelKey)}
          disabled={isSending}
          className="mt-2 w-full rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2.5 text-sm text-text-secondary outline-none focus:border-primary-500"
        >
          {PLAYGROUND_DISCUSSION_MODELS.map((model) => (
            <option key={model.modelKey} value={model.modelKey}>{model.label}</option>
          ))}
        </select>
        <p className="mt-3 text-xs leading-5 text-stone-600">{selectedModel?.description}</p>

        <button
          type="button"
          onClick={() => { setMessages([]); setError('') }}
          disabled={messages.length === 0 || isSending}
          className="mt-8 w-full rounded-xl border border-white/[0.09] px-3 py-2 font-mono text-[10px] tracking-wider text-text-tertiary transition-colors hover:border-white/[0.16] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          清除對話
        </button>
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto flex max-w-4xl flex-col gap-5">
            {messages.length === 0 ? (
              <div className="mt-[12vh] rounded-2xl border border-dashed border-white/[0.09] bg-raised/70 px-8 py-12 text-center">
                <p className="font-serif-cn text-xl font-semibold text-white">把故事帶進房間</p>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-text-secondary">
                  貼上劇情大綱、人物小傳或一場戲，請模型分析問題、提出修改方向，或直接和你一起發展下一稿。
                </p>
              </div>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[82%] rounded-sm border px-5 py-4 ${
                  message.role === 'user'
                    ? 'ml-auto border-primary-500/25 bg-primary-500/10 text-text-primary'
                    : 'border-white/[0.08] bg-raised text-text-secondary'
                }`}
              >
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-stone-600">
                  {message.role === 'user' ? '你的劇本' : selectedModel?.label}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
              </article>
            ))}
            {isSending ? (
              <div className="max-w-[82%] rounded-2xl border border-white/[0.08] bg-raised px-5 py-4 font-mono text-xs text-primary-400">
                正在閱讀與分析…
              </div>
            ) : null}
            {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
          </div>
        </div>

        <div className="border-t border-white/[0.07] bg-[#050506]/92 px-4 py-4 backdrop-blur-xl sm:px-8">
          <div className="mx-auto max-w-4xl">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              rows={4}
              maxLength={12_000}
              placeholder="貼上劇本片段，或問一個關於人物、結構、節奏的問題…"
              className="w-full resize-none rounded-2xl border border-white/[0.1] bg-raised px-4 py-3 text-sm leading-6 text-text-primary outline-none placeholder:text-text-tertiary focus:border-primary-500"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[10px] text-stone-700">Enter 送出 · Shift + Enter 換行</span>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!draft.trim() || isSending}
                className="kuiper-primary-button rounded-xl px-5 py-2 font-mono text-[11px] font-semibold tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
              >
                送出討論
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
