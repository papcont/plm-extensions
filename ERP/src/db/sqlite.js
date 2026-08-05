const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { config } = require('../config');

let db = null;

/**
 * Initialize SQLite database and create tables if they don't exist
 */
function initialize() {
  return new Promise((resolve, reject) => {
    // Ensure data directory exists
    const dbDir = path.dirname(config.db.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new sqlite3.Database(config.db.path, (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Create transfer_log table
      db.run(`
        CREATE TABLE IF NOT EXISTS transfer_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fusion_item_id TEXT NOT NULL,
          dolibarr_product_ref TEXT,
          dolibarr_bom_id INTEGER,
          direction TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT,
          dry_run INTEGER DEFAULT 0,
          diff_summary TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Add new columns if they don't exist (for existing databases)
        db.run(`
          ALTER TABLE transfer_log 
          ADD COLUMN dry_run INTEGER DEFAULT 0
        `, () => {
          // Ignore error if column already exists
        });

        db.run(`
          ALTER TABLE transfer_log 
          ADD COLUMN diff_summary TEXT
        `, () => {
          // Ignore error if column already exists
        });

        // Create index for faster lookups
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_fusion_item_id 
          ON transfer_log(fusion_item_id)
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Create scheduled_items table for cron jobs
          db.run(`
            CREATE TABLE IF NOT EXISTS scheduled_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              fusion_item_id TEXT NOT NULL UNIQUE,
              enabled INTEGER DEFAULT 1,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) {
              reject(err);
              return;
            }

            // Create index for scheduled_items
            db.run(`
              CREATE INDEX IF NOT EXISTS idx_scheduled_item_id 
              ON scheduled_items(fusion_item_id)
            `, (err) => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            });
          });
        });
      });
    });
  });
}

/**
 * Log a transfer operation
 * @param {Object} params - Transfer log parameters
 * @param {string} params.fusionItemId - Fusion Manage item ID
 * @param {string} [params.dolibarrProductRef] - Dolibarr product reference
 * @param {number} [params.dolibarrBomId] - Dolibarr BOM ID
 * @param {string} params.direction - Transfer direction (e.g., 'FM->Dolibarr')
 * @param {string} params.status - Status ('SUCCESS' | 'ERROR' | 'DRY_RUN')
 * @param {string} [params.message] - Optional message
 * @param {boolean} [params.dryRun] - Whether this was a dry run
 * @param {string} [params.diffSummary] - Summary of changes made
 * @returns {Promise<number>} - The inserted row ID
 */
function logTransfer({ fusionItemId, dolibarrProductRef, dolibarrBomId, direction, status, message, dryRun = false, diffSummary = null }) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO transfer_log 
      (fusion_item_id, dolibarr_product_ref, dolibarr_bom_id, direction, status, message, dry_run, diff_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fusionItemId, 
      dolibarrProductRef || null, 
      dolibarrBomId || null, 
      direction, 
      status, 
      message || null,
      dryRun ? 1 : 0,
      diffSummary || null
    ], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.lastID);
    });
  });
}

/**
 * Get transfer history for a specific Fusion Manage item
 * @param {string} fusionItemId - Fusion Manage item ID
 * @returns {Promise<Array>} - Array of transfer log entries
 */
function getTransferHistoryByItem(fusionItemId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        id,
        fusion_item_id,
        dolibarr_product_ref,
        dolibarr_bom_id,
        direction,
        status,
        message,
        dry_run,
        diff_summary,
        created_at
      FROM transfer_log
      WHERE fusion_item_id = ?
      ORDER BY created_at DESC
    `, [fusionItemId], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

/**
 * Get all scheduled items for cron sync
 * @returns {Promise<Array>} - Array of scheduled item IDs
 */
function getScheduledItems() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT fusion_item_id
      FROM scheduled_items
      WHERE enabled = 1
      ORDER BY updated_at DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows.map(row => row.fusion_item_id));
    });
  });
}

/**
 * Get all scheduled items with full details
 * @returns {Promise<Array>} - Array of scheduled item objects
 */
function getAllScheduledItems() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        id,
        fusion_item_id,
        enabled,
        created_at,
        updated_at
      FROM scheduled_items
      ORDER BY updated_at DESC
    `, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

/**
 * Add a scheduled item
 * @param {Object} params - Scheduled item parameters
 * @param {string} params.fusionItemId - Fusion Manage item ID
 * @param {boolean} [params.enabled=true] - Whether the item is enabled
 * @returns {Promise<number>} - The inserted row ID
 */
function addScheduledItem({ fusionItemId, enabled = true }) {
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO scheduled_items (fusion_item_id, enabled, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(fusion_item_id) DO UPDATE SET
        enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    `, [fusionItemId, enabled ? 1 : 0, enabled ? 1 : 0], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.lastID);
    });
  });
}

/**
 * Delete a scheduled item by ID
 * @param {number} id - Scheduled item ID
 * @returns {Promise<boolean>} - True if item was deleted
 */
function deleteScheduledItem(id) {
  return new Promise((resolve, reject) => {
    db.run(`
      DELETE FROM scheduled_items
      WHERE id = ?
    `, [id], function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.changes > 0);
    });
  });
}

/**
 * Update a scheduled item
 * @param {number} id - Scheduled item ID
 * @param {Object} updates - Update parameters
 * @param {boolean} [updates.enabled] - Whether the item is enabled
 * @returns {Promise<boolean>} - True if item was updated
 */
function updateScheduledItem(id, { enabled }) {
  return new Promise((resolve, reject) => {
    const updates = [];
    const values = [];
    
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }
    
    if (updates.length === 0) {
      resolve(false);
      return;
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    db.run(`
      UPDATE scheduled_items
      SET ${updates.join(', ')}
      WHERE id = ?
    `, values, function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.changes > 0);
    });
  });
}

/**
 * Close database connection
 */
function close() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        db = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initialize,
  logTransfer,
  getTransferHistoryByItem,
  getScheduledItems,
  getAllScheduledItems,
  addScheduledItem,
  deleteScheduledItem,
  updateScheduledItem,
  close
};

