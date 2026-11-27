CREATE TABLE `document_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`companion_document_id` text,
	`asset_kind` text NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	`extracted_pages_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_assets_workspace_doc` ON `document_assets` (`workspace_id`,`companion_document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_assets_workspace_att` ON `document_assets` (`workspace_id`,`attachment_id`);--> statement-breakpoint
CREATE TABLE `ingest_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`target_space_id` text NOT NULL,
	`default_kind` text DEFAULT 'clip' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_webhooks_token_hash_unique` ON `ingest_webhooks` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_ingest_webhooks_workspace` ON `ingest_webhooks` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `rss_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`target_space_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_fetched_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rss_feeds_workspace_enabled` ON `rss_feeds` (`workspace_id`,`enabled`);