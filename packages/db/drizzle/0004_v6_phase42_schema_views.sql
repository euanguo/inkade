CREATE TABLE `space_property_schemas` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`space_id` text,
	`template_id` text,
	`fields_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `document_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_space_property_schemas_space` ON `space_property_schemas` (`workspace_id`,`space_id`) WHERE space_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_space_property_schemas_template` ON `space_property_schemas` (`workspace_id`,`template_id`) WHERE template_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE `saved_views` ADD `display_mode` text DEFAULT 'grid' NOT NULL;--> statement-breakpoint
ALTER TABLE `saved_views` ADD `group_by_field` text;--> statement-breakpoint
ALTER TABLE `saved_views` ADD `visible_columns_json` text;--> statement-breakpoint
ALTER TABLE `saved_views` ADD `column_widths_json` text;--> statement-breakpoint
ALTER TABLE `saved_views` ADD `sort_rules_json` text;