/**
 * Client-side auto-compression for over-long VIDEO prompts.
 *
 * Long Seedance-class prompts can dilute instruction priority even when the
 * provider accepts them. Product limits live in video-prompt-limits.ts because
 * AtlasCloud does not currently publish a prompt maxLength.
 * When a video submit exceeds VIDEO_PROMPT_SOFT_LIMIT, callers first run the
 * prompt through the CANVAS_TEXT task (mode 'compress', text worker, normally
 * billed) and submit the compressed result instead.
 *
 * This is a client orchestration on purpose: routes must not call the LLM
 * directly (CLAUDE.md §3), and folding an LLM call into the video worker would
 * bypass the text-task billing/observe path.
 */

export { VIDEO_PROMPT_HARD_LIMIT, VIDEO_PROMPT_SOFT_LIMIT } from './video-prompt-limits'

const POLL_INTERVAL_MS = 1500
const TIMEOUT_MS = 90_000

/**
 * Compress a video prompt via the CANVAS_TEXT task spine. Resolves to the
 * compressed prompt. Rejects on task failure / timeout — callers surface the
 * error instead of silently submitting the over-long original (不隐式回退).
 */
export async function compressVideoPrompt(prompt: string): Promise<string> {
  const res = await fetch('/api/canvas/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, mode: 'compress' }),
  })
  const json = await res.json()
  if (!res.ok || !json?.taskId) {
    throw new Error(json?.error?.message ?? '提示词压缩提交失败')
  }
  const taskId = json.taskId as string

  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('提示词压缩超时，请手动精简后重试')
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const poll = await fetch(`/api/tasks/${taskId}`)
    if (!poll.ok) continue // transient (deploy 502 burst etc.) — keep polling until deadline
    const data = await poll.json()
    const task = data?.task
    if (task?.status === 'completed') {
      const text = typeof task.result?.text === 'string' ? task.result.text.trim() : ''
      if (!text) throw new Error('提示词压缩返回为空，请手动精简后重试')
      return text
    }
    if (task?.status === 'failed') {
      throw new Error(task?.error?.message ?? '提示词压缩失败，请手动精简后重试')
    }
  }
}
