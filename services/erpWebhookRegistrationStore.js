// Persists which Lean Change Order webhook hookIds are currently registered at Autodesk for
// which callbackUrl - lets the server tell "still valid, nothing to do" apart from "callback URL
// changed (e.g. tunnel restarted), re-register" on every startup. File-backed for the same reason
// as erpHistoryStore.js/erpServiceAccountStore.js.

const fs   = require('fs');
const path = 'storage/erp';
const file = path + '/webhook-registration.json';

function ensureFolder() {
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

function get() {
    ensureFolder();
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return null;
    }
}

// registrations: [{ transitionId, hookId }]
function save(callbackUrl, registrations) {
    ensureFolder();
    fs.writeFileSync(file, JSON.stringify({ callbackUrl: callbackUrl, registrations: registrations, updatedAt: new Date().toISOString() }, null, 2));
}

module.exports = { get, save };
