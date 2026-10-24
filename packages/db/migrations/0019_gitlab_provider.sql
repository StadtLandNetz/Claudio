ALTER TABLE `repos` MODIFY COLUMN `full_name` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `repos` ADD `provider` enum('github','gitlab') DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE `repos` ADD `external_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `users` ADD `provider` enum('github','gitlab') DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE `repos` ADD CONSTRAINT `repos_provider_full_name_idx` UNIQUE(`provider`,`full_name`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_provider_external_idx` UNIQUE(`provider`,`github_id`);--> statement-breakpoint
CREATE INDEX `repos_provider_external_idx` ON `repos` (`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `repos` DROP INDEX `repos_full_name_unique`;--> statement-breakpoint
ALTER TABLE `users` DROP INDEX `users_github_id_unique`;
