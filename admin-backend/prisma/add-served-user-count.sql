ALTER TABLE `wecom_entities`
  ADD COLUMN `served_user_count` INTEGER NULL,
  ADD COLUMN `served_user_count_updated_at` DATETIME(3) NULL;
