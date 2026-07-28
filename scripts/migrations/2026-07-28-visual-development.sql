CREATE TABLE `visual_development_workspaces` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `worldBible` JSON NULL,
  `worldVersion` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `visual_development_workspaces_projectId_key` (`projectId`),
  INDEX `visual_development_workspaces_status_idx` (`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `visual_development_workspaces_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `visual_development_characters` (
  `id` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `characterDna` JSON NULL,
  `castingBrief` JSON NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
  `canonCandidateId` VARCHAR(191) NULL,
  `canonLockedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `visual_development_characters_workspaceId_code_key` (`workspaceId`, `code`),
  INDEX `visual_development_characters_workspaceId_idx` (`workspaceId`),
  INDEX `visual_development_characters_canonCandidateId_idx` (`canonCandidateId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `visual_development_characters_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `visual_development_workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `visual_development_batches` (
  `id` VARCHAR(191) NOT NULL,
  `characterId` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL DEFAULT 'casting',
  `status` VARCHAR(191) NOT NULL DEFAULT 'submitting',
  `candidateCount` INTEGER NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `modelKey` VARCHAR(255) NOT NULL,
  `modelId` VARCHAR(255) NOT NULL,
  `modelVersion` VARCHAR(128) NULL,
  `seedSupported` BOOLEAN NOT NULL DEFAULT false,
  `prompt` LONGTEXT NOT NULL,
  `negativePrompt` LONGTEXT NULL,
  `promptStack` JSON NULL,
  `worldBibleSnapshot` JSON NULL,
  `characterDnaSnapshot` JSON NULL,
  `castingBriefSnapshot` JSON NULL,
  `aspectRatio` VARCHAR(191) NOT NULL DEFAULT '4:5',
  `resolution` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `visual_development_batches_characterId_createdAt_idx` (`characterId`, `createdAt`),
  INDEX `visual_development_batches_status_idx` (`status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `visual_development_batches_characterId_fkey`
    FOREIGN KEY (`characterId`) REFERENCES `visual_development_characters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `visual_development_candidates` (
  `id` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `taskId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `requestedSeed` INTEGER NULL,
  `effectiveSeed` INTEGER NULL,
  `seedStatus` VARCHAR(191) NOT NULL DEFAULT 'unsupported',
  `prompt` LONGTEXT NOT NULL,
  `negativePrompt` LONGTEXT NULL,
  `modelKey` VARCHAR(255) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `modelId` VARCHAR(255) NOT NULL,
  `modelVersion` VARCHAR(128) NULL,
  `aspectRatio` VARCHAR(191) NOT NULL,
  `resolution` VARCHAR(191) NULL,
  `shortlisted` BOOLEAN NOT NULL DEFAULT false,
  `isCanon` BOOLEAN NOT NULL DEFAULT false,
  `rejectionNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `visual_development_candidates_taskId_key` (`taskId`),
  UNIQUE INDEX `visual_development_candidates_batchId_code_key` (`batchId`, `code`),
  INDEX `visual_development_candidates_batchId_idx` (`batchId`),
  INDEX `visual_development_candidates_status_idx` (`status`),
  INDEX `visual_development_candidates_isCanon_idx` (`isCanon`),
  PRIMARY KEY (`id`),
  CONSTRAINT `visual_development_candidates_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `visual_development_batches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
