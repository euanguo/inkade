CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  entity_key UNINDEXED,
  workspace_id UNINDEXED,
  entity_type UNINDEXED,
  document_id UNINDEXED,
  node_id UNINDEXED,
  space_id UNINDEXED,
  kind UNINDEXED,
  title,
  body,
  tokens,
  tokenize='unicode61'
);
