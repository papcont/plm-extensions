-- Transfer history table
CREATE TABLE IF NOT EXISTS transfer_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fusion_workspace_id TEXT NOT NULL,
  fusion_item_dms_id TEXT NOT NULL,
  fusion_item_title TEXT,
  dolibarr_bom_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'pending')),
  error_message TEXT,
  transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  bom_snapshot TEXT,
  UNIQUE(fusion_workspace_id, fusion_item_dms_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_transfer_status ON transfer_history(status);
CREATE INDEX IF NOT EXISTS idx_transfer_date ON transfer_history(transferred_at);
CREATE INDEX IF NOT EXISTS idx_fusion_item ON transfer_history(fusion_workspace_id, fusion_item_dms_id);
