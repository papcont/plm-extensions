const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { config } = require('../../config/default');
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            // Ensure data directory exists
            const dbDir = path.dirname(config.database.path);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(config.database.path, (err) => {
                if (err) {
                    logger.error('Failed to connect to database:', err);
                    reject(err);
                } else {
                    logger.info(`Database connected: ${config.database.path}`);
                    this.createTables()
                        .then(resolve)
                        .catch(reject);
                }
            });
        });
    }

    async createTables() {
        const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        return new Promise((resolve, reject) => {
            this.db.exec(schema, (err) => {
                if (err) {
                    logger.error('Failed to create tables:', err);
                    reject(err);
                } else {
                    logger.info('Database tables initialized');
                    resolve();
                }
            });
        });
    }

    async logTransfer(transferData) {
        const {
            fusionWorkspaceId,
            fusionItemDmsId,
            fusionItemTitle,
            dolibarrBomId,
            status,
            errorMessage,
            bomSnapshot
        } = transferData;

        const sql = `
      INSERT OR REPLACE INTO transfer_history 
      (fusion_workspace_id, fusion_item_dms_id, fusion_item_title, dolibarr_bom_id, status, error_message, bom_snapshot, transferred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

        return new Promise((resolve, reject) => {
            this.db.run(
                sql,
                [fusionWorkspaceId, fusionItemDmsId, fusionItemTitle, dolibarrBomId, status, errorMessage, JSON.stringify(bomSnapshot)],
                function (err) {
                    if (err) {
                        logger.error('Failed to log transfer:', err);
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    async getTransferHistory(limit = 50) {
        const sql = `
      SELECT * FROM transfer_history 
      ORDER BY transferred_at DESC 
      LIMIT ?
    `;

        return new Promise((resolve, reject) => {
            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    logger.error('Failed to fetch transfer history:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getTransferById(id) {
        const sql = 'SELECT * FROM transfer_history WHERE id = ?';

        return new Promise((resolve, reject) => {
            this.db.get(sql, [id], (err, row) => {
                if (err) {
                    logger.error('Failed to fetch transfer:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getTransferByFusionItem(workspaceId, itemDmsId) {
        const sql = `
      SELECT * FROM transfer_history 
      WHERE fusion_workspace_id = ? AND fusion_item_dms_id = ?
      ORDER BY transferred_at DESC
      LIMIT 1
    `;

        return new Promise((resolve, reject) => {
            this.db.get(sql, [workspaceId, itemDmsId], (err, row) => {
                if (err) {
                    logger.error('Failed to fetch transfer by Fusion item:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    logger.error('Error closing database:', err);
                } else {
                    logger.info('Database connection closed');
                }
            });
        }
    }
}

module.exports = new Database();
