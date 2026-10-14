CREATE TABLE `agent_learnings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`text` varchar(500) NOT NULL,
	`run_kind` enum('review','analysis','test') NOT NULL,
	`run_ref_id` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `agent_learnings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `agent_learnings_repo_idx` ON `agent_learnings` (`repo_id`);