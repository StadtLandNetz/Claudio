CREATE TABLE `finding_activity` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`review_id` bigint unsigned NOT NULL,
	`finding_id` varchar(20) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`kind` enum('comment','confirmed','dismissed','reset') NOT NULL,
	`body` text,
	`created_at` datetime NOT NULL,
	CONSTRAINT `finding_activity_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `finding_activity_review_idx` ON `finding_activity` (`review_id`,`finding_id`);--> statement-breakpoint
-- Existing ratings (with their reason) and comments for the developers become the first entries of each thread.
INSERT INTO `finding_activity` (`review_id`, `finding_id`, `user_id`, `kind`, `body`, `created_at`)
SELECT `review_id`, `finding_id`, `rated_by`, `status`, `comment`, COALESCE(`rated_at`, NOW())
FROM `findings` WHERE `status` IN ('confirmed', 'dismissed') AND `rated_by` IS NOT NULL;--> statement-breakpoint
INSERT INTO `finding_activity` (`review_id`, `finding_id`, `user_id`, `kind`, `body`, `created_at`)
SELECT `review_id`, `finding_id`, `note_by`, 'comment', `note`, COALESCE(`note_at`, NOW())
FROM `findings` WHERE `note` IS NOT NULL AND `note_by` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `findings` DROP COLUMN `note`;--> statement-breakpoint
ALTER TABLE `findings` DROP COLUMN `note_by`;--> statement-breakpoint
ALTER TABLE `findings` DROP COLUMN `note_at`;