CREATE TABLE `ade_thread_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`node_id` text,
	`selection_anchor_json` text,
	`ade_kind` text NOT NULL,
	`external_workspace_id` text,
	`external_thread_id` text NOT NULL,
	`deep_link` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`last_summary` text,
	`unread_result` integer DEFAULT false NOT NULL,
	`last_synced_at` text NOT NULL,
	`created_at` text NOT NULL,
	`running_since` text,
	`parent_binding_id` text,
	`progress_steps_json` text,
	`pending_approval_json` text,
	`steering_queue_json` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `outline_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ade_bindings_doc` ON `ade_thread_bindings` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE INDEX `idx_ade_bindings_status` ON `ade_thread_bindings` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ade_bindings_external` ON `ade_thread_bindings` (`workspace_id`,`ade_kind`,`external_thread_id`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider` text DEFAULT 'openai' NOT NULL,
	`base_url` text DEFAULT 'https://api.openai.com/v1' NOT NULL,
	`model` text DEFAULT 'gpt-4o-mini' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`temperature` real DEFAULT 0.3 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scope_json` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_tokens_workspace` ON `api_tokens` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_workspace_doc` ON `attachments` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`principal_kind` text NOT NULL,
	`token_id` text,
	`token_name` text,
	`transport` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`space_id` text,
	`document_id` text,
	`decision` text NOT NULL,
	`reason` text,
	`summary` text,
	`created_at` text NOT NULL,
	`before_revision_id` text,
	`after_revision_id` text,
	`diff_preview_json` text,
	`reversible` integer DEFAULT false NOT NULL,
	`irreversible_reason` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_workspace_created` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_token` ON `audit_logs` (`workspace_id`,`token_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_document` ON `audit_logs` (`workspace_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `document_embeddings` (
	`document_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_embeddings_workspace` ON `document_embeddings` (`workspace_id`,`model`);--> statement-breakpoint
CREATE TABLE `document_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`quote` text NOT NULL,
	`prefix_context` text DEFAULT '' NOT NULL,
	`suffix_context` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'amber' NOT NULL,
	`note_markdown` text DEFAULT '' NOT NULL,
	`binding_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `ade_thread_bindings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_highlights_doc` ON `document_highlights` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`source_node_id` text,
	`target_document_id` text,
	`target_slug_or_title` text NOT NULL,
	`anchor_text` text,
	`context_snippet` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `outline_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_document_links_target_doc` ON `document_links` (`workspace_id`,`target_document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_links_target_name` ON `document_links` (`workspace_id`,`target_slug_or_title`);--> statement-breakpoint
CREATE INDEX `idx_document_links_source` ON `document_links` (`source_document_id`,`source_node_id`);--> statement-breakpoint
CREATE TABLE `document_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_markdown` text NOT NULL,
	`outline_snapshot_json` text,
	`change_summary` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_revisions_doc_ver` ON `document_revisions` (`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `document_tags` (
	`document_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`document_id`, `tag`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_tags_tag` ON `document_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `document_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content_markdown` text DEFAULT '' NOT NULL,
	`is_default_daily` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_templates_workspace` ON `document_templates` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `document_yjs_states` (
	`document_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`state_base64` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_yjs_states_workspace` ON `document_yjs_states` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`space_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`daily_date` text,
	`content_markdown` text DEFAULT '' NOT NULL,
	`content_json` text,
	`content_text` text DEFAULT '' NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`source_url` text,
	`source_meta_json` text,
	`properties_json` text,
	`version` integer DEFAULT 1 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`unread_agent_update` integer DEFAULT false NOT NULL,
	`last_edited_by_type` text DEFAULT 'human' NOT NULL,
	`trashed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_documents_workspace_space` ON `documents` (`workspace_id`,`space_id`,`trashed_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_workspace_kind` ON `documents` (`workspace_id`,`kind`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_workspace_slug` ON `documents` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_documents_workspace_daily_date` ON `documents` (`workspace_id`,`daily_date`) WHERE daily_date IS NOT NULL AND trashed_at IS NULL;--> statement-breakpoint
CREATE TABLE `outline_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`parent_node_id` text,
	`order_key` text NOT NULL,
	`content_markdown` text DEFAULT '' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`note_markdown` text DEFAULT '' NOT NULL,
	`note_text` text DEFAULT '' NOT NULL,
	`checked` integer,
	`collapsed` integer DEFAULT false NOT NULL,
	`author_type` text DEFAULT 'human' NOT NULL,
	`author_id` text,
	`source_binding_id` text,
	`mirror_of_node_id` text,
	`rolled_over_to_doc_id` text,
	`task_priority` text,
	`task_scheduled_date` text,
	`task_scheduled_slot` text,
	`task_due_date` text,
	`task_duration_min` integer,
	`task_recurrence_rule` text,
	`task_completed_at` text,
	`task_spawned_next_node_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_outline_nodes_doc_order` ON `outline_nodes` (`document_id`,`deleted_at`,`order_key`);--> statement-breakpoint
CREATE INDEX `idx_outline_nodes_parent` ON `outline_nodes` (`document_id`,`parent_node_id`);--> statement-breakpoint
CREATE INDEX `idx_outline_nodes_mirror` ON `outline_nodes` (`mirror_of_node_id`);--> statement-breakpoint
CREATE INDEX `idx_outline_nodes_rollover` ON `outline_nodes` (`rolled_over_to_doc_id`);--> statement-breakpoint
CREATE INDEX `idx_outline_nodes_task_sched` ON `outline_nodes` (`deleted_at`,`checked`,`task_scheduled_date`);--> statement-breakpoint
CREATE TABLE `project_scope_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`match_type` text NOT NULL,
	`pattern` text NOT NULL,
	`writable_space_ids_json` text NOT NULL,
	`readonly_space_ids_json` text NOT NULL,
	`default_inbox_space_id` text,
	`default_research_space_id` text,
	`extra_instructions` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_scope_rules_workspace` ON `project_scope_rules` (`workspace_id`,`priority`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`filter_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_saved_views_workspace` ON `saved_views` (`workspace_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_unique` ON `share_links` (`token`);--> statement-breakpoint
CREATE INDEX `idx_share_links_doc` ON `share_links` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_share_links_token` ON `share_links` (`token`);--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`color` text,
	`default_kind` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_spaces_workspace_slug` ON `spaces` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_spaces_workspace_parent` ON `spaces` (`workspace_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`workspace_id` text NOT NULL,
	`principal_key` text NOT NULL,
	`prefs_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `principal_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
