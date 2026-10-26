ALTER TABLE `wecom_entities`
  ADD COLUMN `external_contact_valid_from` DATETIME(3) NULL,
  ADD COLUMN `external_contact_valid_until` DATETIME(3) NULL;
