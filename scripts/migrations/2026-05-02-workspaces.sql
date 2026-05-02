-- 2026-05-02: Multi-tenant org → workspace → member hierarchy
--
-- 新增 3 張表（additive only,沒改既有 schema）:
--   organization      org-level container
--   workspace         editor 管的工作區
--   workspace_member  M:N user ↔ workspace
--
-- 套用方式（先 prod DB,再 push 代碼）：
--   ssh root@137.184.64.179
--   cd /opt/kuiperAI/deploy
--   docker compose -f docker-compose.prod.yml --env-file .env.prod \
--     exec -T mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" kuiperai \
--     < /opt/kuiperAI/scripts/migrations/2026-05-02-workspaces.sql
--
-- 驗證：
--   show tables like 'organization'; -- 應有
--   show tables like 'workspace';     -- 應有
--   show tables like 'workspace_member'; -- 應有
--
-- Rollback（如果要退回）：
--   DROP TABLE IF EXISTS workspace_member;
--   DROP TABLE IF EXISTS workspace;
--   DROP TABLE IF EXISTS organization;

CREATE TABLE `organization` (
    `id`          VARCHAR(191) NOT NULL,
    `name`        VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `ownerUserId` VARCHAR(191) NOT NULL,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organization_ownerUserId_idx` (`ownerUserId`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace` (
    `id`             VARCHAR(191) NOT NULL,
    `name`           VARCHAR(191) NOT NULL,
    `description`    TEXT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `ownerEditorId`  VARCHAR(191) NOT NULL,
    `createdAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_organizationId_idx` (`organizationId`),
    INDEX `workspace_ownerEditorId_idx`  (`ownerEditorId`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace_member` (
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId`      VARCHAR(191) NOT NULL,
    `addedBy`     VARCHAR(191) NOT NULL,
    `joinedAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_member_userId_idx`  (`userId`),
    INDEX `workspace_member_addedBy_idx` (`addedBy`),

    PRIMARY KEY (`workspaceId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys (CASCADE on parent delete keeps the hierarchy clean)

ALTER TABLE `organization`
    ADD CONSTRAINT `organization_ownerUserId_fkey`
    FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `workspace`
    ADD CONSTRAINT `workspace_organizationId_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace`
    ADD CONSTRAINT `workspace_ownerEditorId_fkey`
    FOREIGN KEY (`ownerEditorId`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `workspace_member`
    ADD CONSTRAINT `workspace_member_workspaceId_fkey`
    FOREIGN KEY (`workspaceId`) REFERENCES `workspace`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_member`
    ADD CONSTRAINT `workspace_member_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_member`
    ADD CONSTRAINT `workspace_member_addedBy_fkey`
    FOREIGN KEY (`addedBy`) REFERENCES `user`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
