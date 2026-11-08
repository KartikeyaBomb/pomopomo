CREATE TABLE `activity_sessions` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`mode` text NOT NULL,
	`task_id` text,
	`task_name` text,
	`completed_at` integer NOT NULL,
	`duration_seconds` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `activity_user_date_idx` ON `activity_sessions` (`user_id`,`completed_at`);