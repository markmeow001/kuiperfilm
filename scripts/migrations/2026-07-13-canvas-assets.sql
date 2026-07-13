-- S5 canvas durable asset registry. Apply through the normal migration runbook;
-- this file is intentionally not executed by the implementation task.
-- Keep canvas_assets_type_check synchronized with CANVAS_ASSET_TYPES in
-- src/lib/canvas/canvas-assets-contract.ts whenever asset types change.
CREATE TABLE `canvas_assets` (
  `id` VARCHAR(191) NOT NULL,
  `scopeKey` VARCHAR(80) NOT NULL,
  `ownerUserId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NULL,
  `sourceCanvasId` VARCHAR(191) NULL,
  `storageKey` VARCHAR(512) NOT NULL,
  `primaryMediaId` VARCHAR(191) NOT NULL,
  `firstFrameMediaId` VARCHAR(191) NULL,
  `lastFrameMediaId` VARCHAR(191) NULL,
  `type` VARCHAR(20) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `folder` VARCHAR(120) NULL,
  `description` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `canvas_assets_scopeKey_storageKey_key` (`scopeKey`, `storageKey`),
  KEY `canvas_assets_scopeKey_type_createdAt_idx` (`scopeKey`, `type`, `createdAt` DESC),
  KEY `canvas_assets_ownerUserId_idx` (`ownerUserId`),
  KEY `canvas_assets_workspaceId_idx` (`workspaceId`),
  KEY `canvas_assets_sourceCanvasId_idx` (`sourceCanvasId`),
  KEY `canvas_assets_primaryMediaId_idx` (`primaryMediaId`),
  CONSTRAINT `canvas_assets_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_workspaceId_fkey` FOREIGN KEY (`workspaceId`) REFERENCES `workspace` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_sourceCanvasId_fkey` FOREIGN KEY (`sourceCanvasId`) REFERENCES `canvas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_primaryMediaId_fkey` FOREIGN KEY (`primaryMediaId`) REFERENCES `media_objects` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_firstFrameMediaId_fkey` FOREIGN KEY (`firstFrameMediaId`) REFERENCES `media_objects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_lastFrameMediaId_fkey` FOREIGN KEY (`lastFrameMediaId`) REFERENCES `media_objects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `canvas_assets_type_check` CHECK (`type` IN ('character', 'scene', 'image', 'video'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
