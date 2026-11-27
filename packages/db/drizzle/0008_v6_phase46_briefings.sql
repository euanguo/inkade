CREATE TABLE `agent_briefing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cron_expr` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`execution_path` text DEFAULT 'builtin_rag' NOT NULL,
	`binding_id` text,
	`token_rule_id` text,
	`target_space_id` text,
	`prompt_template` text NOT NULL,
	`sources_json` text DEFAULT '{}' NOT NULL,
	`target_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`last_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `ade_thread_bindings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`token_rule_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_briefing_jobs_workspace_enabled` ON `agent_briefing_jobs` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `agent_briefing_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`trigger_kind` text DEFAULT 'schedule' NOT NULL,
	`status` text NOT NULL,
	`batch_id` text,
	`document_id` text,
	`summary` text,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`error_message` text,
	`dismissed_at` text,
	`duration_ms` integer,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `agent_briefing_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_briefing_runs_workspace_started` ON `agent_briefing_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_briefing_runs_job_started` ON `agent_briefing_runs` (`job_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_briefing_runs_workspace_status` ON `agent_briefing_runs` (`workspace_id`,`status`,`dismissed_at`);
