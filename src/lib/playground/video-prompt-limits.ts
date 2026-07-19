/**
 * Product limits for Playground video prompts.
 *
 * AtlasCloud documents `prompt` as a string without a provider maxLength.
 * These limits keep normal prompts focused while leaving room for detailed
 * R2V blocking and preventing script-sized paid submissions.
 */
export const VIDEO_PROMPT_SOFT_LIMIT = 3500
export const VIDEO_PROMPT_COMPRESSION_TARGET = 3000
export const VIDEO_PROMPT_HARD_LIMIT = 6000

