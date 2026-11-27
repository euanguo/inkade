CREATE TABLE `thread_wake_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`binding_id` text,
	`document_id` text NOT NULL,
	`target_ade_kind` text,
	`target_external_thread_id` text,
	`target_workspace_path` text,
	`sender_kind` text NOT NULL,
	`sender_name` text NOT NULL,
	`reason` text NOT NULL,
	`summary` text NOT NULL,
	`formatted_prompt_text` text NOT NULL,
	`source_payload_json` text NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`dedupe_key` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`delivered_at` text,
	`acked_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `ade_thread_bindings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_thread_wake_events_ws_status` ON `thread_wake_events` (`workspace_id`,`delivery_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_thread_wake_events_binding` ON `thread_wake_events` (`workspace_id`,`binding_id`,`delivery_status`);--> statement-breakpoint
CREATE INDEX `idx_thread_wake_events_target` ON `thread_wake_events` (`workspace_id`,`target_external_thread_id`,`delivery_status`);--> statement-breakpoint
CREATE INDEX `idx_thread_wake_events_doc` ON `thread_wake_events` (`workspace_id`,`document_id`,`delivery_status`);--> statement-breakpoint
CREATE INDEX `idx_thread_wake_events_dedupe` ON `thread_wake_events` (`workspace_id`,`dedupe_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `bridge_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`harness_name` text NOT NULL,
	`ade_kind` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`workspace_path` text,
	`pid` integer,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'online' NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bridge_sessions_unique` ON `bridge_sessions` (`workspace_id`,`harness_name`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `idx_bridge_sessions_ws_status` ON `bridge_sessions` (`workspace_id`,`status`,`last_seen_at`);
