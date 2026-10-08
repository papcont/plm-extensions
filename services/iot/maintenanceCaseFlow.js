// Operator-gated Maintenance Case flow: durable Condition Event -> non-mutating preview -> explicit
// confirmation -> ONE gated Fusion Manage create -> durable event->case link. The human decides; nothing
// here runs on event arrival, on AI completion, or on page load. AI text is supporting context only and
// is never projected into confirmedCause/assessment (the writer projects machine facts only).

const C = require('./maintenanceCase');

const CONFIRM = 'CREATE_MAINTENANCE_CASE';
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;

function num(v) { const n = Number(v); return (v == null || v === '' || !Number.isFinite(n)) ? null : n; }

function createMaintenanceCaseFlow({ config, events, linkStore, caseRepo, fmCaseRepo, getState, readAsset = null, searchByEventId = null, lastInsight = null, logger = console }) {

    // Eligibility is business logic only: a real durable ESCALATION event, chosen by the operator. The event
    // severity is never reinterpreted; RECOVERY events are not a case trigger.
    function resolveEvent(assetId, eventId) {
        if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) return { error: 'INVALID_EVENT_ID', status: 400 };
        const event = events.find(eventId, assetId);
        if (!event || String(event.assetId) !== String(assetId)) return { error: 'UNKNOWN_EVENT', status: 404 };
        if (event.type !== 'ESCALATION') return { error: 'EVENT_NOT_ELIGIBLE', status: 409 };
        return { event };
    }

    function eventView(e) {
        return { eventId: e.eventId, type: e.type, from: e.from || null, to: e.to || e.severity || null, severity: e.severity || null,
            timestamp: e.timestamp, detectedAt: e.detectedAt || e.timestamp, reason: e.reason || null,
            anomalyScore: num(e.anomalyScore), healthScore: num(e.healthScore), primaryDriver: e.primaryDriver || null,
            metrics: e.metrics || null, baselineRef: e.baselineRef || null };
    }

    function snapshot(assetId) {
        const st = getState(assetId);
        if (!st) return { condition: null, baseline: null };
        const s = st.summary || {}, a = st.analytics || {};
        const vib = (a.baseline && a.baseline.vibration) || {};
        return {
            condition: { condition: s.condition || st.condition || null, health: num(s.healthScore), anomalyScore: num(a.anomalyScore),
                primaryDriver: a.primaryDriver || null, vibrationG: num(s.vibration), temperatureC: num(s.temperature), lastTelemetryAt: s.lastTelemetry || null },
            baseline: { frozen: a.baselineFrozen === true, frozenAt: a.baselineFrozenAt || null, medianG: num(vib.median), madG: num(vib.mad),
                upperBandG: num(vib.upper), sampleCount: num(a.sampleCount) },
        };
    }

    function aiSummary(assetId) {
        if (!lastInsight) return null;
        const e = lastInsight('explain_asset_state', assetId), b = lastInsight('technician_briefing', assetId);
        if (!e && !b) return null;
        return { explainSummary: e ? e.insight.summary : null, explainAt: e ? e.at : null,
            briefingHeadline: b ? b.insight.headline : null, briefingAt: b ? b.at : null,
            note: 'AI interpretation – supporting context only; never written as assessment or confirmedCause.' };
    }

    async function fmLookup(eventId) {
        if (!searchByEventId) return { status: 'unavailable', matches: [], error: 'RECONCILE_PATH_UNAVAILABLE' };
        try { return { status: 'ok', matches: await searchByEventId(eventId) }; }
        catch (e) { return { status: 'unavailable', matches: [], error: e.message || 'search failed' }; }
    }

    async function assetInfo(assetId) {
        if (!readAsset) return { id: String(assetId), title: null };
        try { const a = await readAsset(assetId); return { id: (a && a.id) || String(assetId), title: (a && a.title) || null }; }
        catch (e) { return { id: String(assetId), title: null, note: 'asset details unavailable' }; }
    }

    function projection(event) {
        const kase = C.fromConditionEvent(event, { assetWorkspaceId: config.assetWorkspaceId || '904' });   // pure; not stored
        const p = fmCaseRepo.projectCreate(kase);
        let wireBody = null, wireError = null;
        try { wireBody = fmCaseRepo.createBody(p, config.caseSectionId); } catch (e) { wireError = e.message; }
        return { kase, p, wireBody, wireError };
    }

    // Non-mutating. Everything the operator must see before confirming.
    async function preview({ assetId, eventId }) {
        const r = resolveEvent(assetId, eventId);
        if (r.error) return r;
        const event = r.event;
        const { p, wireBody, wireError } = projection(event);
        const localLink = linkStore.get(eventId);
        const fmSearch = await fmLookup(eventId);
        const writeEnabled = config.fusionManageCaseWrites === true;
        const blockers = [];
        if (!writeEnabled) blockers.push('WRITE_DISABLED');
        if (localLink) blockers.push('ALREADY_LINKED');
        else if (fmSearch.matches.length) blockers.push('FM_ITEM_EXISTS');
        if (!p.assetResolved) blockers.push('UNRESOLVED_ASSET');
        if (!config.caseSectionId) blockers.push('NO_SECTION_ID');
        if (!config.caseDefaultUrgency) blockers.push('NO_URGENCY');
        if (wireError) blockers.push(wireError);
        const snap = snapshot(assetId);
        return {
            eligible: true, source: C.SOURCE.CONDITION_EVENT,
            asset: await assetInfo(assetId),
            event: eventView(event),
            conditionSnapshot: snap.condition, baseline: snap.baseline,
            aiSummary: aiSummary(assetId),
            fieldMapping: { workspaceId: String(config.caseWorkspaceId || '907'), sectionId: config.caseSectionId || null,
                fields: p.fields, references: p.references, initialWorkflow: 'Definition', assessment: null, confirmedCause: null },
            wireBody,
            idempotency: { localLink, fmSearch },
            writeEnabled, blockers,
            existingCase: localLink ? { fmDmsId: localLink.fmDmsId, fmWorkspaceId: localLink.fmWorkspaceId, fmId: localLink.fmId || null, conditionEventId: eventId }
                : (fmSearch.matches.length === 1 ? { fmDmsId: fmSearch.matches[0], fmWorkspaceId: String(config.caseWorkspaceId || '907'), conditionEventId: eventId, reconciled: true } : null),
        };
    }

    // Mutating ONLY with the exact confirmation, the gate ON, and no existing case for this event.
    async function create({ assetId, eventId, confirm }) {
        if (confirm !== CONFIRM) return { error: 'CONFIRMATION_REQUIRED', status: 400 };
        const r = resolveEvent(assetId, eventId);
        if (r.error) return r;
        const event = r.event;
        const localLink = linkStore.get(eventId);
        if (localLink) return { outcome: 'existing', fmDmsId: localLink.fmDmsId, fmWorkspaceId: localLink.fmWorkspaceId, fmId: localLink.fmId || null, conditionEventId: eventId, workflow: localLink.workflow || null };
        if (config.fusionManageCaseWrites !== true) return { error: 'WRITE_DISABLED', status: 503, writeEnabled: false };

        const fmSearch = await fmLookup(eventId);
        if (fmSearch.status !== 'ok' && fmSearch.error !== 'RECONCILE_PATH_UNAVAILABLE') return { error: 'FM_SEARCH_UNAVAILABLE', status: 503 };
        if (fmSearch.matches.length > 1) return { error: 'DUPLICATE_BUSINESS_KEY', status: 409 };
        if (fmSearch.matches.length === 1) {
            const link = persistLink(eventId, { assetId: String(assetId), fmDmsId: fmSearch.matches[0], fmWorkspaceId: String(config.caseWorkspaceId || '907'), reconciled: true });
            return { outcome: 'existing', reconciled: true, fmDmsId: fmSearch.matches[0], fmWorkspaceId: String(config.caseWorkspaceId || '907'), conditionEventId: eventId, durable: link.durable };
        }

        const kase = caseRepo.createFromConditionEvent(eventId);           // machine facts only; idempotent per event
        const res = await fmCaseRepo.create(kase);                        // single attempt, no retry
        if (!res.ok) { logger.log(' IoT/Case: create failed ' + res.error); return { error: 'CREATE_FAILED', status: 502, detail: res.error }; }
        const link = persistLink(eventId, { assetId: String(assetId), caseId: kase.caseId, fmDmsId: res.fmDmsId, fmWorkspaceId: res.workspaceId, fmItemUrl: (kase.sync && kase.sync.fmItemUrl) || null, workflow: 'Definition' });
        logger.log(' IoT/Case: created 907 item ' + res.fmDmsId + ' for event ' + eventId + (link.durable ? '' : ' (link NOT durable)'));
        return { outcome: 'created', fmDmsId: res.fmDmsId, fmWorkspaceId: res.workspaceId, conditionEventId: eventId, workflow: 'Definition', caseId: kase.caseId, durable: link.durable };
    }

    function persistLink(eventId, link) {
        try { return Object.assign({ durable: true }, linkStore.set(eventId, link)); }
        catch (e) { logger.log(' IoT/Case: link not persisted - ' + e.message); return Object.assign({ durable: false }, link); }
    }

    return { preview, create, CONFIRM };
}

module.exports = { createMaintenanceCaseFlow, CONFIRM };
