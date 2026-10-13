ALTER TABLE `users` ADD `refresh_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `token_expires_at` datetime;