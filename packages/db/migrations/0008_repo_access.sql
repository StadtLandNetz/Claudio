CREATE TABLE `repo_access` (
	`user_id` bigint unsigned NOT NULL,
	`repo_id` bigint unsigned NOT NULL,
	`level` enum('none','read','write','admin') NOT NULL,
	`checked_at` datetime NOT NULL,
	CONSTRAINT `repo_access_user_repo_idx` UNIQUE(`user_id`,`repo_id`)
);
