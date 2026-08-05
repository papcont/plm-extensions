// Persists the refresh token of whichever user is designated as the "service account" for
// unattended work (currently the Lean Change Order webhook - see erpWebhookManager.js). Captured
// automatically the next time that person logs into the app normally (routes/landing.js), no
// separate login flow needed. File-backed for the same reason as erpHistoryStore.js - avoids a
// native DB dependency for a single small piece of state that must survive server restarts.

const fs   = require('fs');
const path = 'storage/erp';
const file = path + '/service-tokens.json';

function ensureFolder() {
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

function readAll() {
    ensureFolder();
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return {};
    }
}

function saveRefreshToken(email, refreshToken) {
    const tokens = readAll();
    tokens[email] = { refreshToken: refreshToken, updatedAt: new Date().toISOString() };
    ensureFolder();
    fs.writeFileSync(file, JSON.stringify(tokens, null, 2));
}

function getRefreshToken(email) {
    const entry = readAll()[email];
    return entry ? entry.refreshToken : null;
}

module.exports = { saveRefreshToken, getRefreshToken };
