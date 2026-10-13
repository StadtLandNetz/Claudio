CREATE TABLE `run_artifacts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`run_id` varchar(120) NOT NULL,
	`path` varchar(300) NOT NULL,
	`content_type` varchar(80) NOT NULL,
	`size` int NOT NULL,
	`data` mediumblob NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `run_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `run_artifacts_run_path_idx` UNIQUE(`run_id`,`path`)
);
--> statement-breakpoint
CREATE INDEX `run_artifacts_created_idx` ON `run_artifacts` (`created_at`);