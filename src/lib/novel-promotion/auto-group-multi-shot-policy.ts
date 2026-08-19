/** Shared submission/worker budget for the durable auto-group text task. */
export const AUTO_GROUP_MIN_PANEL_COUNT = 2
export const AUTO_GROUP_MAX_PANEL_COUNT = 80
export const AUTO_GROUP_MAX_INPUT_TOKENS = 3_000
export const AUTO_GROUP_MAX_OUTPUT_TOKENS = 1_200
export const AUTO_GROUP_PROVIDER_MAX_RETRIES = 0

// UTF-8 bytes are deterministic across providers and remain conservative for
// CJK-heavy prompts, where a character can consume roughly one model token.
export const AUTO_GROUP_MAX_PROMPT_UTF8_BYTES = AUTO_GROUP_MAX_INPUT_TOKENS * 3

export function autoGroupPromptByteLength(prompt: string): number {
  return new TextEncoder().encode(prompt).byteLength
}
