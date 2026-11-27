CREATE TABLE `chunk_embeddings` (
	`chunk_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`model_key` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_blob` blob NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`chunk_id`, `model_key`),
	FOREIGN KEY (`chunk_id`) REFERENCES `document_chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chunk_embeddings_workspace_model` ON `chunk_embeddings` (`workspace_id`,`model_key`);--> statement-breakpoint
CREATE TABLE `context_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rules_json` text DEFAULT '{}' NOT NULL,
	`max_tokens` integer DEFAULT 12000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_context_packs_workspace_slug` ON `context_packs` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_context_packs_workspace_updated` ON `context_packs` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`doc_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`heading_path` text,
	`node_id` text,
	`token_count` integer NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`content_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`doc_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_chunks_workspace_doc` ON `document_chunks` (`workspace_id`,`doc_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_chunks_doc_idx` ON `document_chunks` (`doc_id`,`chunk_index`);--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `embedding_provider` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `embedding_base_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `embedding_model` text DEFAULT 'local-ngram-128' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `embedding_api_key` text DEFAULT '' NOT NULL;