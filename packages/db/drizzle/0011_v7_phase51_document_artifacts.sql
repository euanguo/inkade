CREATE TABLE `document_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`title` text NOT NULL,
	`html_source` text NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`fallback_markdown` text NOT NULL,
	`height_px` integer DEFAULT 420 NOT NULL,
	`sha256` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_artifacts_ws_doc` ON `document_artifacts` (`workspace_id`,`document_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_document_artifacts_ws_updated` ON `document_artifacts` (`workspace_id`,`updated_at`);