CREATE TABLE `calendar_events_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`uid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`timezone` text,
	`rrule` text,
	`exdates_json` text DEFAULT '[]' NOT NULL,
	`raw_summary_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `calendar_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_cache_sub_uid` ON `calendar_events_cache` (`subscription_id`,`uid`);--> statement-breakpoint
CREATE INDEX `idx_calendar_events_cache_workspace_range` ON `calendar_events_cache` (`workspace_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE TABLE `calendar_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`color` text DEFAULT '#3b82f6' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_synced_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_subscriptions_workspace` ON `calendar_subscriptions` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `document_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_engine` text NOT NULL,
	`doc_id` text NOT NULL,
	`block_key` text NOT NULL,
	`line_index` integer,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`priority` text,
	`scheduled_date` text,
	`scheduled_start_min` integer,
	`duration_min` integer,
	`due_date` text,
	`recurrence_rule` text,
	`space_id` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_tasks_workspace_scheduled` ON `document_tasks` (`workspace_id`,`scheduled_date`,`scheduled_start_min`);--> statement-breakpoint
CREATE INDEX `idx_document_tasks_workspace_due` ON `document_tasks` (`workspace_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_document_tasks_workspace_completed` ON `document_tasks` (`workspace_id`,`completed`);--> statement-breakpoint
CREATE INDEX `idx_document_tasks_doc_block` ON `document_tasks` (`doc_id`,`block_key`);--> statement-breakpoint
CREATE INDEX `idx_document_tasks_workspace_space` ON `document_tasks` (`workspace_id`,`space_id`);--> statement-breakpoint
ALTER TABLE `outline_nodes` ADD `task_scheduled_start_min` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `document_tasks` (`id`, `workspace_id`, `source_engine`, `doc_id`, `block_key`, `line_index`, `title`, `completed`, `priority`, `scheduled_date`, `scheduled_start_min`, `duration_min`, `due_date`, `recurrence_rule`, `space_id`, `tags_json`, `updated_at`)
SELECT
  onode.`id`,
  d.`workspace_id`,
  'outline',
  onode.`document_id`,
  onode.`id`,
  0,
  COALESCE(NULLIF(onode.`content_text`, ''), onode.`content_markdown`),
  CASE WHEN onode.`checked` = 1 THEN 1 ELSE 0 END,
  onode.`task_priority`,
  onode.`task_scheduled_date`,
  onode.`task_scheduled_start_min`,
  onode.`task_duration_min`,
  onode.`task_due_date`,
  onode.`task_recurrence_rule`,
  d.`space_id`,
  '[]',
  onode.`updated_at`
FROM `outline_nodes` onode
INNER JOIN `documents` d ON d.`id` = onode.`document_id`
WHERE onode.`deleted_at` IS NULL AND onode.`checked` IS NOT NULL AND d.`trashed_at` IS NULL;