CREATE TABLE `test_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`script_id` bigint unsigned NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`review_id` bigint unsigned,
	`batch_id` varchar(40),
	`request` json NOT NULL,
	`instance_url` varchar(500) NOT NULL,
	`status` enum('queued','running','completed','budget_exceeded','max_turns','failed','aborted') NOT NULL DEFAULT 'queued',
	`run_id` varchar(120),
	`mode` varchar(20),
	`outcome` enum('passed','failed','inconclusive'),
	`healed` boolean NOT NULL DEFAULT false,
	`steps_version` int,
	`report` json,
	`cost_usd` varchar(20),
	`error` text,
	`abort_requested` boolean NOT NULL DEFAULT false,
	`started_by` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`started_at` datetime,
	`finished_at` datetime,
	CONSTRAINT `test_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `test_scripts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`expectation` text NOT NULL,
	`roles` json NOT NULL,
	`determinism` enum('deterministic','semi','explorative'),
	`steps` json,
	`steps_version` int NOT NULL DEFAULT 0,
	`steps_updated_at` datetime,
	`run_in_reviews` boolean NOT NULL DEFAULT false,
	`created_by` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `test_scripts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `run_events` ADD `test_run_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `run_events` ADD CONSTRAINT `run_events_test_seq_idx` UNIQUE(`test_run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `test_runs_script_idx` ON `test_runs` (`script_id`);--> statement-breakpoint
CREATE INDEX `test_runs_review_idx` ON `test_runs` (`review_id`);--> statement-breakpoint
CREATE INDEX `test_runs_status_idx` ON `test_runs` (`status`);--> statement-breakpoint
CREATE INDEX `test_runs_batch_idx` ON `test_runs` (`batch_id`);--> statement-breakpoint
CREATE INDEX `test_scripts_repo_idx` ON `test_scripts` (`repo_id`);