CREATE TABLE IF NOT EXISTS `episode_props` (
  `id` VARCHAR(191) NOT NULL,
  `episodeId` VARCHAR(191) NOT NULL,
  `propId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `episode_props_episodeId_propId_key` (`episodeId`, `propId`),
  KEY `episode_props_episodeId_idx` (`episodeId`),
  KEY `episode_props_propId_idx` (`propId`),
  CONSTRAINT `episode_props_episodeId_fkey`
    FOREIGN KEY (`episodeId`) REFERENCES `novel_promotion_episodes` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `episode_props_propId_fkey`
    FOREIGN KEY (`propId`) REFERENCES `novel_promotion_props` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill legacy projects before the UI starts filtering props by episode.
-- Exact substring matching is intentionally conservative: it links only an
-- existing project prop whose complete name appears in that episode's script.
INSERT IGNORE INTO `episode_props` (`id`, `episodeId`, `propId`, `role`, `createdAt`)
SELECT
  UUID(),
  e.`id`,
  p.`id`,
  'legacy-script-backfill',
  CURRENT_TIMESTAMP(3)
FROM `novel_promotion_props` p
JOIN `novel_promotion_episodes` e
  ON e.`novelPromotionProjectId` = p.`novelPromotionProjectId`
WHERE p.`name` <> ''
  AND e.`novelText` IS NOT NULL
  AND LOCATE(p.`name`, e.`novelText`) > 0;

-- Panels may explicitly store prop-name arrays even when the name is absent
-- from the episode source text. JSON_VALID protects older malformed rows.
INSERT IGNORE INTO `episode_props` (`id`, `episodeId`, `propId`, `role`, `createdAt`)
SELECT
  UUID(),
  e.`id`,
  p.`id`,
  'legacy-panel-backfill',
  CURRENT_TIMESTAMP(3)
FROM `novel_promotion_panels` panel
JOIN `novel_promotion_storyboards` storyboard
  ON storyboard.`id` = panel.`storyboardId`
JOIN `novel_promotion_episodes` e
  ON e.`id` = storyboard.`episodeId`
JOIN JSON_TABLE(
  IF(JSON_VALID(panel.`props`), panel.`props`, JSON_ARRAY()),
  '$[*]' COLUMNS (`name` VARCHAR(191) PATH '$')
) AS panel_prop
JOIN `novel_promotion_props` p
  ON p.`novelPromotionProjectId` = e.`novelPromotionProjectId`
  AND p.`name` = panel_prop.`name`;
