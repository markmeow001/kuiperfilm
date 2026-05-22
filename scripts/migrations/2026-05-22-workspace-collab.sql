-- 2026-05-22: Phase 12.5 Figma-style workspace collaboration
--
-- 加 3 個新表 + 3 個 Project 欄位 + 1 個 WorkspaceMember 欄位（additive only）：
--   project_collaborator   per-project explicit role override
--   edit_request           viewer asks owner for edit access (request flow)
--   audit_log              destructive / privileged action trail
--   projects.workspaceId   NULL = personal / legacy
--   projects.deletedAt     soft delete marker
--   projects.deletedBy     soft delete actor
--   workspace_member.role  workspace-scoped role (editor / viewer)
--
-- See docs/plans/workspace-collaboration-spec.md for full design.
--
-- ⚠️ 部署順序（per reference_kuiperfilm.md memory）:
--   1. SQL apply 先（這份檔案）
--   2. backfill script 跑（scripts/backfill-workspace-collab.ts）
--   3. 才是 code deploy
--   如果反過來 prisma client 會 boot crash。
--
-- 套用方式（在 droplet 上）:
--   ssh root@137.184.64.179
--   cd /opt/kuiperAI/deploy
--   docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
--     exec -T mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" kuiper \
--     < /opt/kuiperAI/scripts/migrations/2026-05-22-workspace-collab.sql
--
-- 驗證:
--   SHOW TABLES LIKE 'project_collaborator';   -- 應有
--   SHOW TABLES LIKE 'edit_request';           -- 應有
--   SHOW TABLES LIKE 'audit_log';              -- 應有
--   SHOW COLUMNS FROM projects LIKE 'workspaceId';   -- 應有
--   SHOW COLUMNS FROM projects LIKE 'deletedAt';     -- 應有
--   SHOW COLUMNS FROM workspace_member LIKE 'role';  -- 應有
--
-- Rollback（如果要退回，按相反順序）:
--   ALTER TABLE workspace_member DROP COLUMN role;
--   ALTER TABLE projects DROP FOREIGN KEY projects_workspaceId_fk;
--   ALTER TABLE projects DROP FOREIGN KEY projects_deletedBy_fk;
--   ALTER TABLE projects DROP COLUMN workspaceId, DROP COLUMN deletedAt, DROP COLUMN deletedBy;
--   DROP TABLE IF EXISTS audit_log;
--   DROP TABLE IF EXISTS edit_request;
--   DROP TABLE IF EXISTS project_collaborator;

-- ─── 1. New columns on projects ──────────────────────────────────

ALTER TABLE `projects`
  ADD COLUMN `workspaceId` VARCHAR(191) NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedBy` VARCHAR(191) NULL,
  ADD INDEX `projects_workspaceId_idx` (`workspaceId`),
  ADD INDEX `projects_deletedAt_idx` (`deletedAt`),
  ADD CONSTRAINT `projects_workspaceId_fk` FOREIGN KEY (`workspaceId`)
    REFERENCES `workspace`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `projects_deletedBy_fk` FOREIGN KEY (`deletedBy`)
    REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2. New column on workspace_member ──────────────────────────

ALTER TABLE `workspace_member`
  ADD COLUMN `role` ENUM('editor', 'viewer') NOT NULL DEFAULT 'viewer';

-- Note: backfill existing rows to 'editor' is done by
-- scripts/backfill-workspace-collab.ts AFTER this DDL applies.
-- New rows default to 'viewer' per spec Decision 1B.

-- ─── 3. project_collaborator (NEW) ───────────────────────────────

CREATE TABLE `project_collaborator` (
    `projectId` VARCHAR(191) NOT NULL,
    `userId`    VARCHAR(191) NOT NULL,
    `role`      ENUM('editor', 'viewer') NOT NULL,
    `grantedBy` VARCHAR(191) NOT NULL,
    `grantedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_collaborator_userId_idx` (`userId`),
    INDEX `project_collaborator_grantedBy_idx` (`grantedBy`),

    PRIMARY KEY (`projectId`, `userId`),

    CONSTRAINT `project_collaborator_projectId_fk` FOREIGN KEY (`projectId`)
      REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `project_collaborator_userId_fk` FOREIGN KEY (`userId`)
      REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `project_collaborator_grantedBy_fk` FOREIGN KEY (`grantedBy`)
      REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 4. edit_request (NEW) ───────────────────────────────────────

CREATE TABLE `edit_request` (
    `id`          VARCHAR(191) NOT NULL,
    `projectId`   VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `status`      ENUM('pending', 'approved', 'denied', 'expired') NOT NULL DEFAULT 'pending',
    `message`     TEXT NULL,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt`  DATETIME(3) NULL,
    `resolvedBy`  VARCHAR(191) NULL,

    INDEX `edit_request_projectId_status_idx` (`projectId`, `status`),
    INDEX `edit_request_requesterId_idx` (`requesterId`),
    INDEX `edit_request_status_createdAt_idx` (`status`, `createdAt`),

    PRIMARY KEY (`id`),

    CONSTRAINT `edit_request_projectId_fk` FOREIGN KEY (`projectId`)
      REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `edit_request_requesterId_fk` FOREIGN KEY (`requesterId`)
      REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `edit_request_resolvedBy_fk` FOREIGN KEY (`resolvedBy`)
      REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 5. audit_log (NEW) ──────────────────────────────────────────

CREATE TABLE `audit_log` (
    `id`         VARCHAR(191) NOT NULL,
    `userId`     VARCHAR(191) NOT NULL,
    `projectId`  VARCHAR(191) NULL,
    `action`     VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId`   VARCHAR(191) NOT NULL,
    `snapshot`   JSON NULL,
    `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_projectId_createdAt_idx` (`projectId`, `createdAt`),
    INDEX `audit_log_userId_idx` (`userId`),

    PRIMARY KEY (`id`),

    CONSTRAINT `audit_log_userId_fk` FOREIGN KEY (`userId`)
      REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Done. Now run backfill: ─────────────────────────────────────
--   npx tsx scripts/backfill-workspace-collab.ts
