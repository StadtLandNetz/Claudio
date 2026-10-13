CREATE TABLE `findings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`review_id` bigint unsigned NOT NULL,
	`finding_id` varchar(20) NOT NULL,
	`data` json NOT NULL,
	`status` enum('proposed','confirmed','dismissed') NOT NULL DEFAULT 'proposed',
	`comment` text,
	`rated_by` bigint unsigned,
	`rated_at` datetime,
	CONSTRAINT `findings_id` PRIMARY KEY(`id`),
	CONSTRAINT `findings_review_finding_idx` UNIQUE(`review_id`,`finding_id`)
);
--> statement-breakpoint
CREATE TABLE `repo_roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`name` varchar(60) NOT NULL,
	`description` varchar(300),
	`username_enc` text NOT NULL,
	`password_enc` text NOT NULL,
	`login_path` varchar(300) NOT NULL DEFAULT '/login',
	`success_url_contains` varchar(300),
	`recipe` json,
	`created_at` datetime NOT NULL,
	CONSTRAINT `repo_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `repo_roles_repo_name_idx` UNIQUE(`repo_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`full_name` varchar(200) NOT NULL,
	`is_private` boolean NOT NULL DEFAULT false,
	`default_branch` varchar(200),
	`notes` text,
	`extra_allowed_hosts` json NOT NULL,
	`data_confirmed` boolean NOT NULL DEFAULT false,
	`default_instance_url` varchar(500),
	`created_by` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `repos_id` PRIMARY KEY(`id`),
	CONSTRAINT `repos_full_name_unique` UNIQUE(`full_name`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`pr_number` int NOT NULL,
	`pr_title` varchar(500),
	`instance_url` varchar(500) NOT NULL,
	`request` json NOT NULL,
	`fixture` varchar(60),
	`status` enum('queued','running','completed','budget_exceeded','max_turns','failed','aborted') NOT NULL DEFAULT 'queued',
	`run_id` varchar(120),
	`report` json,
	`verdict` varchar(30),
	`cost_usd` varchar(20),
	`error` text,
	`abort_requested` boolean NOT NULL DEFAULT false,
	`started_by` bigint unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`started_at` datetime,
	`finished_at` datetime,
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`review_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`line` mediumtext NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `run_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `run_events_review_seq_idx` UNIQUE(`review_id`,`seq`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`github_id` bigint unsigned NOT NULL,
	`login` varchar(100) NOT NULL,
	`name` varchar(200),
	`avatar_url` varchar(500),
	`access_token_enc` text NOT NULL,
	`created_at` datetime NOT NULL,
	`last_login_at` datetime NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_github_id_unique` UNIQUE(`github_id`)
);
--> statement-breakpoint
CREATE INDEX `reviews_repo_idx` ON `reviews` (`repo_id`);--> statement-breakpoint
CREATE INDEX `reviews_status_idx` ON `reviews` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);