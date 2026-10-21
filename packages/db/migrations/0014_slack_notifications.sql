ALTER TABLE `repos` ADD `slack_webhook_enc` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `slack_webhook_hint` varchar(40);--> statement-breakpoint
ALTER TABLE `repos` ADD `notifications` json;--> statement-breakpoint
ALTER TABLE `reviews` ADD `notified_at` datetime;--> statement-breakpoint
ALTER TABLE `test_runs` ADD `notified_at` datetime;