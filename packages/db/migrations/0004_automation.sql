ALTER TABLE `repos` ADD `automation` json;--> statement-breakpoint
ALTER TABLE `repos` ADD `auto_review` json;--> statement-breakpoint
ALTER TABLE `repos` ADD `webhook_id` bigint;--> statement-breakpoint
ALTER TABLE `repos` ADD `webhook_secret_enc` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `automation_user_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `repos` ADD `lessons` json NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `trigger` varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `head_sha` varchar(64);