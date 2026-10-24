CREATE TABLE `test_proposals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`analysis_id` bigint unsigned NOT NULL,
	`proposal_id` varchar(20) NOT NULL,
	`name` varchar(200) NOT NULL,
	`start_path` varchar(500) NOT NULL,
	`description` text NOT NULL,
	`expectation` text NOT NULL,
	`roles` json NOT NULL,
	`priority` int NOT NULL,
	`rationale` text NOT NULL,
	`status` enum('proposed','accepted','dismissed') NOT NULL DEFAULT 'proposed',
	`test_script_id` bigint unsigned,
	`decided_by` bigint unsigned,
	`decided_at` datetime,
	`created_at` datetime NOT NULL,
	CONSTRAINT `test_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `test_proposals_analysis_idx` UNIQUE(`analysis_id`,`proposal_id`)
);
--> statement-breakpoint
CREATE INDEX `test_proposals_repo_idx` ON `test_proposals` (`repo_id`,`status`);