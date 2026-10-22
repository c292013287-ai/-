ALTER TABLE `wecom_entities`
  ADD COLUMN `external_contact_capacity` INTEGER NULL;

CREATE TABLE IF NOT EXISTS `served_user_daily_stats` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `entity_id` INTEGER NOT NULL,
  `date` DATE NOT NULL,
  `count` INTEGER NOT NULL,
  `measured_at` DATETIME(3) NOT NULL,
  `fingerprint` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `served_user_daily_stats_entity_id_date_key` (`entity_id`, `date`),
  CONSTRAINT `served_user_daily_stats_entity_id_fkey` FOREIGN KEY (`entity_id`) REFERENCES `wecom_entities` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
