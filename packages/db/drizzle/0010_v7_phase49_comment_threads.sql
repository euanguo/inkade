ALTER TABLE `document_highlights` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_highlights` ADD `resolved_at` text;--> statement-breakpoint
ALTER TABLE `document_highlights` ADD `resolved_by_type` text;--> statement-breakpoint
CREATE INDEX `idx_document_highlights_doc_status` ON `document_highlights` (`workspace_id`,`document_id`,`status`);--> statement-breakpoint
CREATE TABLE `highlight_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`highlight_id` text NOT NULL,
	`document_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`body_markdown` text NOT NULL,
	`sent_to_agent_at` text,
	`wake_event_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`highlight_id`) REFERENCES `document_highlights`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wake_event_id`) REFERENCES `thread_wake_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_highlight_comments_highlight` ON `highlight_comments` (`workspace_id`,`highlight_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_highlight_comments_doc` ON `highlight_comments` (`workspace_id`,`document_id`,`created_at`);