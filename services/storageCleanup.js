// storage/zip-export and storage/excel-export are written to via createServerFolderPath(path,
// false) - the folder is never cleared, so every export accumulates on disk forever. Sweeps files
// older than MAX_AGE_MS out of both on startup and then on a recurring interval.

const fs = require('fs');

const EXPORT_DIRS       = ['storage/zip-export', 'storage/excel-export'];
const MAX_AGE_MS        = 48 * 60 * 60 * 1000; // ponytail: fixed 48h - make configurable if a tenant needs longer-lived export links
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

function sweepDir(dir) {

    if (!fs.existsSync(dir)) return;

    const now = Date.now();

    for (const fileName of fs.readdirSync(dir)) {

        if (fileName.startsWith('.')) continue; // e.g. .gitkeep - not an export artifact

        const filePath = dir + '/' + fileName;

        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && (now - stats.mtimeMs) > MAX_AGE_MS) {
                fs.unlinkSync(filePath);
                console.log(' storage cleanup: removed old export ' + filePath);
            }
        } catch (error) {
            // file may have been removed/downloaded concurrently between readdir and stat/unlink - ignore
        }

    }

}

function sweepExportFolders() {
    EXPORT_DIRS.forEach(sweepDir);
}

function startExportCleanup() {
    sweepExportFolders();
    setInterval(sweepExportFolders, SWEEP_INTERVAL_MS);
}

module.exports = { startExportCleanup, sweepExportFolders };
