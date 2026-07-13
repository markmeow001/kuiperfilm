-- Multi-canvas + reusable canvas workflow templates.
-- Existing rows remain normal canvases.
ALTER TABLE `canvas`
  ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'canvas' AFTER `title`,
  DROP INDEX `canvas_userId_updatedAt_idx`,
  ADD INDEX `canvas_userId_kind_updatedAt_idx` (`userId`, `kind`, `updatedAt` DESC);
