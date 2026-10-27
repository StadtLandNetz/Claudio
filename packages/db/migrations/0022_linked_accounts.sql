CREATE TABLE `user_identities` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`provider` enum('github','gitlab') NOT NULL DEFAULT 'github',
	`external_id` bigint unsigned NOT NULL,
	`login` varchar(100) NOT NULL,
	`avatar_url` varchar(500),
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`token_expires_at` datetime,
	`created_at` datetime NOT NULL,
	CONSTRAINT `user_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_identities_provider_external_idx` UNIQUE(`provider`,`external_id`),
	CONSTRAINT `user_identities_user_provider_idx` UNIQUE(`user_id`,`provider`)
);
--> statement-breakpoint
INSERT INTO `user_identities` (`user_id`, `provider`, `external_id`, `login`, `avatar_url`, `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `created_at`)
SELECT `id`, `provider`, `github_id`, `login`, `avatar_url`, `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `created_at` FROM `users`;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `github_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `access_token_enc` text;