ALTER TABLE `repos` ADD `anthropic_key_enc` text;--> statement-breakpoint
ALTER TABLE `repos` ADD `anthropic_key_hint` varchar(12);--> statement-breakpoint
ALTER TABLE `repos` ADD `anthropic_key_set_by` bigint unsigned;--> statement-breakpoint
ALTER TABLE `repos` ADD `anthropic_key_set_at` datetime;