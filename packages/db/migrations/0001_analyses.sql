CREATE TABLE `analyses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`request` json NOT NULL,
	`instance_url` varchar(500) NOT NULL,
	`fixture` varchar(60),
	`status` enum('queued','running','completed','budget_exceeded','max_turns','failed','aborted') NOT NULL DEFAULT 'queued',
	`run_id` varchar(120),
	`branch` varchar(200),
	`commit_sha` varchar(64),
	`report` json,
	`cost_usd` varchar(20),
	`error` text,
	`abort_requested` boolean NOT NULL DEFAULT false,
	`started_by` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`started_at` datetime,
	`finished_at` datetime,
	CONSTRAINT `analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_docs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`analysis_id` bigint unsigned NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`name` varchar(40) NOT NULL,
	`content` mediumtext NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `knowledge_docs_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_docs_analysis_name_idx` UNIQUE(`analysis_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `run_events` MODIFY COLUMN `review_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `run_events` ADD `analysis_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `run_events` ADD CONSTRAINT `run_events_analysis_seq_idx` UNIQUE(`analysis_id`,`seq`);--> statement-breakpoint
CREATE INDEX `analyses_repo_idx` ON `analyses` (`repo_id`);--> statement-breakpoint
CREATE INDEX `analyses_status_idx` ON `analyses` (`status`);--> statement-breakpoint
CREATE INDEX `knowledge_docs_repo_idx` ON `knowledge_docs` (`repo_id`);