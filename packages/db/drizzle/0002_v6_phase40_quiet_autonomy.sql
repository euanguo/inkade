ALTER TABLE `audit_logs` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `execution_mode` text DEFAULT 'autonomous' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `reversed_by_audit_id` text;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_workspace_batch` ON `audit_logs` (`workspace_id`,`batch_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `document_revisions` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `document_revisions` ADD `execution_mode` text DEFAULT 'autonomous' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_revisions` ADD `reversed_by_audit_id` text;--> statement-breakpoint
CREATE INDEX `idx_document_revisions_batch` ON `document_revisions` (`batch_id`);