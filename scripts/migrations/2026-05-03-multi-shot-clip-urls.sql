-- 2026-05-03 — Multi-Kling chunked dispatch.
--
-- When a panel group's dialogue exceeds Kling Omni's 15s per-call cap,
-- the worker now splits the group into N chunks and dispatches N
-- parallel Kling calls. Each chunk produces its own MP4. Users
-- download all clips and stitch them in their own NLE (CapCut /
-- 剪映 / Premiere) — we explicitly do NOT stitch server-side because
-- the editor is the user's tool of choice.
--
-- This adds a column to store the array of clip URLs. The legacy
-- `multi_shot_video_url` column is kept for backward compatibility
-- with existing single-clip storyboards (workers fall back to the old
-- column when the new one is null).
--
-- Apply order:
--   1. Run this SQL on prod DB FIRST.
--   2. Then push schema.prisma + worker code that reads/writes the
--      new column.
-- Reverse order causes prisma client / DB drift → boot crash.

-- Note: Prisma uses camelCase column names (no @map → no snake_case
-- conversion), so the column is `multiShotVideoUrl`, NOT
-- `multi_shot_video_url`. Same for the new column.
ALTER TABLE `novel_promotion_storyboards`
  ADD COLUMN `multiShotClipUrls` TEXT NULL
  AFTER `multiShotVideoUrl`;

-- No backfill needed: existing storyboards with single multi-shot
-- video keep using `multi_shot_video_url`. The reader (`getMultiShotClipUrls`
-- helper, see src/lib/storyboard/multi-shot-clips.ts) prefers the new
-- column when set, falls back to wrapping the old column in a
-- single-element array otherwise.
