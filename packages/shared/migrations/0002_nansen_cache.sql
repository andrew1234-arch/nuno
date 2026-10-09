CREATE TABLE `nansen_cache` (
	`address` integer NOT NULL,
	`endpoint` text NOT NULL,
	`result` text NOT NULL,
	`credits_used` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`address`, `endpoint`)
);
--> statement-breakpoint
ALTER TABLE `storage_stats` ADD `nansen_credits_spent` integer DEFAULT 0 NOT NULL;