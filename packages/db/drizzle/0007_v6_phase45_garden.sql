CREATE TABLE `public_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`exposed_fields_json` text DEFAULT '[]' NOT NULL,
	`enable_rss` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_public_sites_slug` ON `public_sites` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_public_sites_workspace_updated` ON `public_sites` (`workspace_id`,`updated_at`);
