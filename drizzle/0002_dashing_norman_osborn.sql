CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text,
	`pairing_hash` text,
	`pairing_expires` integer NOT NULL,
	`created_at` integer NOT NULL,
	`paired_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_pairing_hash_unique` ON `devices` (`pairing_hash`);--> statement-breakpoint
CREATE TABLE `timer_commands` (
	`user_id` text NOT NULL,
	`actor` text NOT NULL,
	`command_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`user_id`, `actor`, `command_id`)
);
