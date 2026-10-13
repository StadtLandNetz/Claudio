ALTER TABLE `test_scripts` ADD `allowed_hosts` json;--> statement-breakpoint
ALTER TABLE `test_scripts` ADD `allow_any_host` boolean DEFAULT false NOT NULL;