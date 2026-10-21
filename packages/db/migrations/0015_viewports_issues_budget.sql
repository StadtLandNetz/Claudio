ALTER TABLE `findings` ADD `issue_url` varchar(500);--> statement-breakpoint
ALTER TABLE `repos` ADD `monthly_budget_usd` varchar(20);--> statement-breakpoint
ALTER TABLE `repos` ADD `budget_warned_month` varchar(7);--> statement-breakpoint
ALTER TABLE `test_scripts` ADD `viewports` json;