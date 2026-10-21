ALTER TABLE `human_requests` ADD `kind` enum('takeover','question') DEFAULT 'takeover' NOT NULL;--> statement-breakpoint
ALTER TABLE `human_requests` ADD `context` text;--> statement-breakpoint
ALTER TABLE `human_requests` ADD `options` json;--> statement-breakpoint
ALTER TABLE `human_requests` ADD `answer` text;