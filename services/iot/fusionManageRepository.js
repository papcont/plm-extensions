// Fusion Manage condition repository. Fusion Manage is NOT a time-series DB — it stores only the
// business-relevant state: the current asset condition summary and discrete condition events.
// Writes are gated by config.fusionManageWrites (default OFF). When off (dev/MVP) it records the
// intended writes in memory so the pipeline and UI work end to end without touching a tenant.
//
// The real v3 REST write shape is prepared but not enabled until the target workspace + field IDs
// are defined for the tenant (see docs/features/iot-condition-monitoring/fusion-manage-mapping.md).
// Those IDs are tenant-specific and must not be invented.

function createFusionManageRepository(config, logger = console) {
    const summaries = new Map();   // assetId -> latest summary object
    const events = [];             // recorded condition events (newest last)

    // Upsert the asset's current condition summary (health, condition, last telemetry/alert).
    async function upsertConditionSummary(summary) {
        summaries.set(summary.assetId, summary);
        if (!config.fusionManageWrites) {
            return { written: false, mode: 'dry-run', summary };
        }
        // ponytail: live write intentionally not wired until target workspace/field IDs exist.
        // Guard rather than call an unverified endpoint. Flip on once mapping is confirmed.
        logger.log(' IoT/FM: live writes enabled but workspace/field mapping not configured - skipping');
        return { written: false, mode: 'blocked-no-mapping', summary };
    }

    // Append a discrete condition event (WARNING/CRITICAL escalation, recovery, ...).
    async function recordConditionEvent(event) {
        events.push(event);
        if (!config.fusionManageWrites) return { written: false, mode: 'dry-run', event };
        logger.log(' IoT/FM: live writes enabled but workspace/field mapping not configured - skipping');
        return { written: false, mode: 'blocked-no-mapping', event };
    }

    return {
        upsertConditionSummary,
        recordConditionEvent,
        getSummary : assetId => summaries.get(assetId) || null,
        getEvents  : assetId => events.filter(e => !assetId || e.assetId === assetId),
    };
}

module.exports = { createFusionManageRepository };
