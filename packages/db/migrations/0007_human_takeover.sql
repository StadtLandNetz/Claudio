CREATE TABLE `human_inputs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`request_id` bigint unsigned NOT NULL,
	`input` json NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `human_inputs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `human_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_kind` enum('review','analysis','test') NOT NULL,
	`run_ref_id` bigint unsigned NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`reason` varchar(500) NOT NULL,
	`status` enum('open','resolved','cancelled','timeout') NOT NULL DEFAULT 'open',
	`resolved_by` bigint unsigned,
	`created_at` datetime NOT NULL,
	`resolved_at` datetime,
	CONSTRAINT `human_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `human_inputs_request_idx` ON `human_inputs` (`request_id`);--> statement-breakpoint
CREATE INDEX `human_requests_run_idx` ON `human_requests` (`run_kind`,`run_ref_id`);--> statement-breakpoint
CREATE INDEX `human_requests_status_idx` ON `human_requests` (`status`);