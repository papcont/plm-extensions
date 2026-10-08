// Condition Monitoring dashboard. Reads the self-contained /iot/* backend: polls /iot/tick once a
// second, keeps a local sample buffer, and renders status tiles + three native-canvas trend charts.
// No charting library (canvas is enough), no PLM/APS calls. Reads server-injected globals: theme.

(function () {

    var CONDITION_COLOR = {
        OFF: '#8a8f98', NORMAL: '#3fb950', OBSERVE: '#58a6ff', WARNING: '#d29922', CRITICAL: '#f85149'
    };

    var cfg = null;                 // /iot/config payload (thresholds, bands, source)
    var samples = [];               // { t, health, vibration, temperature, condition }
    var events = [];                // condition events, newest first
    var latestAnalytics = null;     // learned-baseline snapshot from the last poll (modelState, anomaly, baseline)
    var paused = false;
    var timer = null;
    var liveAsset = null;           // FM asset id when bound to a real sensor; null => simulator demo
    var liveSeenT = null;           // last uplink timestamp already sampled (dedupe live polls)
    var sensorInfo = null;          // { name, deviceId, url } of the linked Sensors (968) record, once read from FM

    $(document).ready(function () {
        initAssetContext();
        loadMaintenanceCase();
        $('#cm-ai-explain').on('click', loadAiInsight);
        $('#cm-ai-briefing').on('click', loadBriefing);
        initCaseCreate();
        $.getJSON('/iot/config', function (res) {
            cfg = res.data;
            if (!liveAsset) $('#cm-source').text('Quelle: ' + cfg.source);
            if (cfg.aiCredentialConfigured === false) $('#cm-ai-status').text('KI-Einschätzung ist auf diesem Server nicht konfiguriert.');
            start();
        }).fail(function () { $('#cm-source').text('Quelle: nicht verfügbar'); });

        // Pause/resume BOTH the client poll and the unattended server ticker, so pausing actually
        // stops mock data from accumulating (not just the on-screen updates). Reflect real state on load.
        $.getJSON('/iot/ticker', function (res) {
            if (res && res.data && res.data.configured) setPaused(!res.data.running);
        });
        $('#cm-pause').on('click', function () {
            var next = !paused;
            setPaused(next);
            $.post('/iot/ticker', { running: !next });   // paused => ticker off, resume => ticker on
        });
        $('#cm-reset').on('click', function () {
            $.post('/iot/reset', function () { samples = []; events = []; renderEvents(); });
        });
        $('#cm-range').on('change', function () {
            if (liveAsset) loadLiveHistory(); else renderCharts();
        });
        $(window).on('resize', renderCharts);
    });

    function setPaused(p) {
        paused = p;
        $('#cm-pause').toggleClass('icon-pause', !p).toggleClass('icon-play', p).text(p ? 'Fortsetzen' : 'Pause');
    }

    function start() {
        if (timer) clearInterval(timer);
        timer = setInterval(poll, 1000);
        poll();
    }

    function poll() {
        if (paused) return;
        if (liveAsset) return pollLive();
        $.ajax({ url: '/iot/tick', method: 'POST' }).done(function (res) {
            if (!res.success || !res.data.accepted) return;
            var d = res.data;
            samples.push({
                t: d.summary.lastTelemetry,
                health: d.health.score,
                vibration: d.health.vibration,
                temperature: d.summary.temperature,
                humidity: d.summary.humidity,
                condition: d.condition.condition
            });
            if (samples.length > 5000) samples.splice(0, samples.length - 5000);
            if (d.analytics) latestAnalytics = d.analytics;
            if (d.conditionEvent) { events.unshift(d.conditionEvent); if (events.length > 50) events.pop(); renderEvents(); }
            renderTiles();
            renderCharts();
        });
    }

    // Live mode: read the real asset's condition (written by the TTN->MQTT->bridge path). Read-only —
    // no /tick. Uplinks are sparse (~20 min), so one sample is added per new lastTelemetry; polling the
    // same uplink repeatedly is deduped. The selected persisted history is loaded separately.
    function pollLive() {
        $.getJSON('/iot/state?assetId=' + encodeURIComponent(liveAsset), function (res) {
            var st = res && res.data;
            if (!st || !st.summary) { $('#cm-source').text('Quelle: live · Asset ' + liveAsset + ' · wartet auf ersten Uplink'); return; }
            var sm = st.summary;
            if (sm.deviceId) renderSensors([sensorInfo ? Object.assign({}, sensorInfo, { deviceId: sensorInfo.deviceId || sm.deviceId }) : { name: 'Live-Sensor', deviceId: sm.deviceId }], null);
            if (sm.lastTelemetry !== liveSeenT) {
                liveSeenT = sm.lastTelemetry;
                if (sm.deviceId) $('#cm-source').text('Quelle: live · ' + sm.deviceId + ' · Asset ' + liveAsset);
                samples.push({
                    t: sm.lastTelemetry,
                    health: sm.healthScore,
                    vibration: sm.vibration,
                    temperature: sm.temperature,
                    humidity: sm.humidity,
                    condition: st.condition
                });
                if (samples.length > 5000) samples.splice(0, samples.length - 5000);
            }
            if (st.analytics) latestAnalytics = st.analytics;
            events = (st.events || []).slice().reverse();   // bridge stores oldest-first; UI wants newest-first
            renderEvents();
            renderTiles();
            renderCharts();
        });
    }

    // Bind the dashboard to a real asset: stop simulating, drop any sim samples. Idempotent — re-calling
    // with the same asset only refreshes the label (e.g. once the device id is known), no buffer wipe.
    function goLive(assetId, deviceId) {
        assetId = String(assetId);
        var changed = liveAsset !== assetId;
        if (changed) { liveAsset = assetId; samples = []; events = []; liveSeenT = null; renderEvents(); }
        $('#cm-source').text('Quelle: live · ' + (deviceId || 'Sensor') + ' · Asset ' + liveAsset);
        if (changed) loadLiveHistory();
    }

    function loadLiveHistory() {
        if (!liveAsset) return;
        var hours = parseInt($('#cm-range').val(), 10) || 0;
        var rangeMs = hours > 0 ? hours * 60 * 60 * 1000 : 0;
        $.getJSON('/iot/history?assetId=' + encodeURIComponent(liveAsset) + '&rangeMs=' + rangeMs, function (res) {
            var byTime = {};
            (res && res.data || []).forEach(function (p) {
                var m = p.metrics || {};
                byTime[p.t] = {
                    t: p.t,
                    health: p.healthScore,
                    vibration: historyVibration(p, m),
                    temperature: m.temperature,
                    humidity: m.humidity,
                    condition: p.condition || 'NORMAL'
                };
            });
            samples.forEach(function (sample) { byTime[sample.t] = sample; });
            samples = Object.keys(byTime).map(function (key) { return byTime[key]; })
                .sort(function (a, b) { return new Date(a.t) - new Date(b.t); });
            if (samples.length > 5000) samples.splice(0, samples.length - 5000);
            if (samples.length) liveSeenT = samples[samples.length - 1].t;
            renderTiles();
            renderCharts();
        });
    }

    function historyVibration(point, metrics) {
        var ax = Number(metrics.accelerationX), ay = Number(metrics.accelerationY), az = Number(metrics.accelerationZ);
        var hasAxes = Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az);
        // Legacy VIBMOD=4 points were stored before the gravity-compensated model was tagged.
        // Recalculate their derived value from the retained raw axes without modifying the archive.
        if (hasAxes && (point.fPort === 7 || !point.vibrationModel)) {
            return Math.abs(Math.sqrt(ax * ax + ay * ay + az * az) - 1);
        }
        if (typeof point.vibration === 'number') return point.vibration;
        if (typeof metrics.vibrationG === 'number') return metrics.vibrationG;
        var x = Number(metrics.velocityX) || 0;
        var y = Number(metrics.velocityY) || 0;
        var z = Number(metrics.velocityZ) || 0;
        return Math.sqrt(x * x + y * y + z * z);
    }

    function renderTiles() {
        var s = samples[samples.length - 1];
        if (!s) return;
        // Stale telemetry is a presentation state only: the stored condition stays untouched and is
        // shown as "last known", never as a fresh green NORMAL.
        var stale = currentStale();
        $('#cm-summary').toggleClass('cm-is-stale', !!stale);
        $('#cm-status-dot').css('background', stale ? CONDITION_COLOR.OFF : (CONDITION_COLOR[s.condition] || '#8a8f98'));
        $('#cm-status-text').text(stale ? 'KEINE AKTUELLEN DATEN' : s.condition).css('color', stale ? '' : (CONDITION_COLOR[s.condition] || ''));
        $('#cm-status-sub').text(stale ? 'Letzter bekannter Zustand: ' + s.condition + ' · Health ' + s.health + ' %' : '');
        $('#cm-health').text(s.health);
        $('#cm-temp').text(fmt(s.temperature, 1));
        $('#cm-humidity').text(fmt(s.humidity, 1));
        $('#cm-vib').text(fmt(s.vibration, 2));
        $('#cm-updated').text(new Date(s.t).toLocaleTimeString() + (stale ? ' · ' + stale : ''));

        var prev = samples[samples.length - 2];
        var trend = $('#cm-vib-trend');
        if (prev) {
            if (s.vibration > prev.vibration + 0.05)      trend.text(' ▲').css('color', s.condition === 'NORMAL' ? '#8a8f98' : '#f85149');   // red only when the condition itself is off
            else if (s.vibration < prev.vibration - 0.05) trend.text(' ▼').css('color', '#3fb950');
            else                                          trend.text(' –').css('color', '#8a8f98');
        }
        if (events[0]) $('#cm-last-event').text(events[0].severity + ' · ' + new Date(events[0].timestamp).toLocaleTimeString());
        renderAnalyticsTiles();
    }

    // Freshness of the newest sample (live mode only, existing cmFormat rule); '' when fresh.
    function currentStale() {
        var s = samples[samples.length - 1];
        return (s && liveAsset) ? cmFormat.staleText(s.t, Date.now()) : '';
    }

    // AI-model state, anomaly score, trend, and the vibration unit — all from the learned-baseline snapshot.
    function renderAnalyticsTiles() {
        var a = latestAnalytics;
        if (a && a.unit) { $('#cm-vib-unit').text(' ' + a.unit); $('#cm-vib-chart-unit').text(a.unit); }
        if (!a) { $('#cm-ai-state').text('-'); $('#cm-anomaly').text('-'); $('#cm-trend').text('-'); return; }

        var ready = a.modelState === 'READY';
        $('#cm-ai-state').text(a.modelState || '-').css('color', ready ? '#3fb950' : '#58a6ff');
        var min = a.minimumSamples || (cfg && cfg.analytics && cfg.analytics.minimumSamples) || 0;
        $('#cm-ai-samples').text(ready ? ('Messpunkte ' + a.sampleCount) : ('Messpunkte ' + a.sampleCount + ' / ' + min));

        if (typeof a.anomalyScore === 'number') {
            $('#cm-anomaly').text(a.anomalyScore.toFixed(2)).css('color', anomalyColor(a.anomalyScore));
            $('#cm-anomaly-driver').text(a.primaryDriver ? ('Treiber: ' + a.primaryDriver) : '');
        } else {
            $('#cm-anomaly').text(cmFormat.anomalyText(a.anomalyScore)).css('color', '');
            $('#cm-anomaly-driver').text(ready ? '' : 'lernt');
        }
        $('#cm-trend').text(a.trend || '-');
        renderWhy();
        renderBaseline();
    }

    function anomalyColor(score) {
        var A = cfg && cfg.analytics;
        if (!A) return '';
        if (score >= A.criticalThreshold) return '#f85149';
        if (score >= A.warningThreshold)  return '#d29922';
        if (score >= A.observeThreshold)  return '#58a6ff';
        return '#3fb950';
    }

    // Explainability: build the "why" from the computed analytics facts — never invented text.
    function renderWhy() {
        var a = latestAnalytics, body = $('#cm-why-body'), s = samples[samples.length - 1];
        // Only for a fresh, actually anomalous state (OBSERVE or worse, or score above observe threshold).
        var observe = cfg && cfg.analytics ? cfg.analytics.observeThreshold : 0.4;
        var anomalous = !!a && a.modelState === 'READY' && !currentStale() &&
            ((s && ['OBSERVE', 'WARNING', 'CRITICAL'].indexOf(s.condition) >= 0) || (typeof a.anomalyScore === 'number' && a.anomalyScore >= observe));
        $('#cm-why').toggle(anomalous);
        if (!anomalous) return;
        var vb = a.baseline && a.baseline.vibration, vd = a.drivers && a.drivers.vibration;
        var td = a.drivers && a.drivers.temperature;
        var unit = a.unit || '';
        var lines = [];
        var scored = typeof a.anomalyScore === 'number';
        var abnormal = scored && a.anomalyScore >= observe;
        lines.push('<div class="cm-why-head" style="color:' + (scored ? anomalyColor(a.anomalyScore) : '') + '">' +
            (abnormal ? 'Primäre Abweichung: ' + escapeHtml(a.primaryDriver || 'vibration') : scored ? 'Innerhalb des gelernten Normalbereichs' : 'Anomalie-Score nicht verfügbar') +
            ' · Anomalie ' + cmFormat.anomalyText(a.anomalyScore) + '</div>');
        if (vb) {
            // Vibration amplitude is non-negative: a median−3σ lower bound can go below 0 for a near-zero
            // baseline. Clamp only the DISPLAYED value to 0 (the chart already floors at 0); the learned
            // baseline math is untouched.
            var vbLower = Math.max(0, vb.lower), vCur = !!vd && typeof vd.current === 'number' && isFinite(vd.current);
            // No current value in the analytics snapshot: say so, and print no deviation for it.
            lines.push(whyRow('Vibration', vCur ? cmFormat.vibrationText(vd.current, unit) : 'kein aktueller Wert in der Anomalie-Auswertung',
                'gelernter Median ' + vb.median + ' ' + unit + ', normal ' + vbLower + '–' + vb.upper + ' ' + unit +
                (vCur ? ', Abweichung ' + vd.z + ' MAD' : '')));
        }
        if (td) {
            lines.push(whyRow('Temperatur', td.current + ' °C',
                'gelernter Median ' + (a.baseline.temperature ? a.baseline.temperature.median : '?') + ' °C' +
                ', Abweichung ' + td.z + ' MAD'));
        } else {
            lines.push(whyRow('Temperatur', 'im Normalbereich', ''));
        }
        lines.push('<div class="cm-why-line">Trend: ' + escapeHtml(a.trend || 'STABLE') + '</div>');
        body.html(lines.join(''));
    }

    // Learned baseline, straight from the analytics snapshot. Frozen = learning stopped; the anomaly is measured against it.
    function renderBaseline() {
        var a = latestAnalytics, body = $('#cm-baseline-body'), vb = a && a.baseline && a.baseline.vibration, u = (a && a.unit) || 'g';
        if (!a || !vb) { body.html('<div class="cm-events-empty">Noch keine gelernte Baseline.</div>'); return; }
        var row = function (l, v) { return '<div class="cm-case-row"><span>' + l + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>'; };
        body.html('<div class="cm-baseline-grid"><div>' +
            row('Baseline-Status', a.baselineFrozen ? 'FROZEN – Lernen beendet' : (a.modelState === 'READY' ? 'READY – lernt noch' : 'LEARNING')) +
            row('Eingefroren am', a.baselineFrozenAt ? new Date(a.baselineFrozenAt).toLocaleString() : 'n/a') +
            row('Messpunkte', a.sampleCount + (a.minimumSamples ? ' (Minimum ' + a.minimumSamples + ')' : '')) + '</div><div>' +
            row('Vibrations-Median', vb.median + ' ' + u) + row('MAD', vb.mad + ' ' + u) +
            row('Normalband (unten–oben)', Math.max(0, vb.lower) + ' – ' + vb.upper + ' ' + u) + '</div></div>' +
            '<div class="cm-case-note">Die aktuelle Anomalie wird gegen diese gelernte Referenz gemessen. ' + (u === 'g' ? 'Vibration ist Spitzenbeschleunigung in g (nicht mm/s), ohne FFT-Spektrum.' : 'Vibration ist Schwinggeschwindigkeit in ' + escapeHtml(u) + ', ohne FFT-Spektrum.') + ' Das ist keine Ausfallwahrscheinlichkeit und keine Restlaufzeit.</div>');
    }

    function whyRow(label, value, detail) {
        return '<div class="cm-why-line"><span class="cm-why-label">' + escapeHtml(label) + ':</span> ' +
            '<span class="cm-why-value">' + escapeHtml(String(value)) + '</span>' +
            (detail ? ' <span class="cm-why-detail">(' + escapeHtml(detail) + ')</span>' : '') + '</div>';
    }

    function renderEvents() {
        var list = $('#cm-events-list');
        if (!events.length) { list.html('<div class="cm-events-empty">Keine lokale Event-Historie vorhanden.</div>'); return; }
        var latest = events[0], esc1 = events.filter(function (e) { return e.type === 'ESCALATION'; })[0];
        var ev = function (title, e) {
            if (!e) return '';
            var c = CONDITION_COLOR[e.severity] || '#8a8f98', b = e.baselineRef && e.baselineRef.vibration;
            return '<div class="cm-event-card"><div class="cm-case-block-title">' + title + '</div>' +
                '<div class="cm-case-row"><span>Typ</span><strong style="color:' + c + '">' + escapeHtml(e.type) + ' · ' + escapeHtml(e.from) + ' → ' + escapeHtml(e.to) + '</strong></div>' +
                '<div class="cm-case-row"><span>Schwere / Zeit</span><strong>' + escapeHtml(e.severity) + ' · ' + new Date(e.timestamp).toLocaleString() + '</strong></div>' +
                '<div class="cm-case-row"><span>Grund</span><strong>' + escapeHtml(e.reason) + '</strong></div>' +
                '<div class="cm-case-row"><span>Anomalie / Health / Treiber</span><strong>' + escapeHtml(cmFormat.anomalyText(e.anomalyScore) + ' / ' + e.healthScore + ' / ' + (e.primaryDriver || 'n/a')) + '</strong></div>' +
                (e.metrics ? '<div class="cm-case-row"><span>Vibration beim Event</span><strong>' + escapeHtml(e.metrics.vibration + ' ' + (e.metrics.vibrationUnit || 'g') + (b ? ' (normal ≤ ' + b.upper + ')' : '')) + '</strong></div>' : '') +
                '<div class="cm-case-row"><span>Event-ID</span><strong class="cm-mono">' + escapeHtml(e.eventId || 'n/a') + '</strong></div></div>';
        };
        $('#cm-latest-event').html('<div class="cm-event-cards">' + ev('Letztes Condition Event', latest) + (esc1 && esc1 !== latest ? ev('Letzte Eskalation', esc1) : '') + '</div>');
        // Presentation only: one summary line for repeated escalation/recovery, the newest rows inline and
        // older rows behind a native <details> (no inner scroll box). Event data and semantics are unchanged.
        var keepOpen = list.find('details.cm-events-older').prop('open');
        list.empty();
        var nEsc = events.filter(function (e) { return e.type === 'ESCALATION'; }).length;
        var nRec = events.filter(function (e) { return e.type === 'RECOVERY'; }).length;
        if (nEsc > 1 && nRec > 1) list.append('<div class="cm-events-summary">Wiederholte Zustandswechsel: ' + nEsc + '× Eskalation, ' + nRec + '× Rückkehr zu NORMAL zwischen ' +
            new Date(events[events.length - 1].timestamp).toLocaleTimeString() + ' und ' + new Date(events[0].timestamp).toLocaleTimeString() + '.</div>');
        var VISIBLE = 6, older = null;
        if (events.length > VISIBLE) older = $('<details class="cm-events-older"><summary>Ältere Events anzeigen (' + (events.length - VISIBLE) + ')</summary></details>').prop('open', !!keepOpen);
        events.forEach(function (e, idx) {
            var color = CONDITION_COLOR[e.severity] || '#8a8f98';
            // Case creation is offered only for a real durable ESCALATION event (operator choice, never automatic).
            var caseBtn = (e.type === 'ESCALATION' && e.eventId)
                ? '<button class="cm-case-from-event button" data-event-id="' + escapeHtml(e.eventId) + '" title="Maintenance-Case-Vorschau für dieses Event">Case-Vorschau</button>' : '';
            (idx < VISIBLE ? list : older).append(
                '<div class="cm-event-row">' +
                '<span class="cm-dot" style="background:' + color + '"></span>' +
                '<span class="cm-event-sev" style="color:' + color + '">' + e.severity + '</span>' +
                '<span class="cm-event-type">' + e.type + '</span>' +
                '<span class="cm-event-reason">' + escapeHtml(e.reason) + '</span>' +
                '<span class="cm-event-time">' + new Date(e.timestamp).toLocaleTimeString() + '</span>' +
                caseBtn +
                '</div>');
        });
        if (older) list.append(older);
        updateCaseButton();
    }

    function windowed() {
        var hours = parseInt($('#cm-range').val(), 10) || 0;   // 0 = All
        if (hours <= 0) return samples;
        var cutoff = Date.now() - hours * 3600 * 1000;
        return samples.filter(function (s) { return new Date(s.t).getTime() >= cutoff; });
    }

    function renderCharts() {
        var data = windowed();
        var th = cfg ? cfg.thresholds : { vibration: {}, temperature: {} };
        lineChart('cm-chart-health', data.map(function (s) { return s.health; }), data, {
            min: 0, max: 100, accent: '#58a6ff',
            guides: [{ v: (cfg && cfg.conditionBands.warning) || 40, color: '#d29922' }]
        });
        var band = latestAnalytics && latestAnalytics.baseline && latestAnalytics.baseline.vibration;
        var vibValues = data.map(function (s) { return s.vibration; });
        // Scale to fit both the samples and the learned normal band, so the band is always visible.
        var vibScale = autoScale(
            vibValues.concat(band ? [band.lower, band.upper, band.median] : []),
            band ? Math.max(band.upper - band.lower, 0.02) : 0.05, true, 4);
        lineChart('cm-chart-vib', vibValues, data, {
            min: vibScale.min, max: vibScale.max, divisions: vibScale.divisions, accent: '#d29922',
            band: band ? { median: band.median, lower: band.lower, upper: band.upper,
                           provisional: latestAnalytics.modelState !== 'READY' } : null,
            guides: [{ v: th.vibration.warn, color: '#d29922' }, { v: th.vibration.critical, color: '#f85149' }]
        });
        var tempScale = focusedTemperatureScale(data.map(function (s) { return s.temperature; }));
        lineChart('cm-chart-temp', data.map(function (s) { return s.temperature; }), data, {
            min: tempScale.min, max: tempScale.max, divisions: tempScale.divisions, accent: '#ff7b72',
            guides: []
        });
        var humidityScale = { min: 0, max: 100, divisions: 5 };
        lineChart('cm-chart-humidity', data.map(function (s) { return s.humidity; }), data, {
            min: humidityScale.min, max: humidityScale.max, divisions: humidityScale.divisions,
            accent: '#2a9d8f', guides: []
        });
    }

    // Native canvas line chart with optional horizontal guide lines. Colors the line by the sample's
    // condition where a condition array is supplied (health uses a single accent instead).
    function lineChart(id, values, meta, opts) {
        var canvas = document.getElementById(id);
        if (!canvas) return;
        var dpr = window.devicePixelRatio || 1;
        var cssW = canvas.parentElement.clientWidth - 24;
        var cssH = 160;
        canvas.style.width = cssW + 'px';
        canvas.width = Math.max(1, cssW * dpr);
        canvas.height = cssH * dpr;
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        var padL = 34, padR = 8, padT = 10, padB = 16;
        var w = cssW - padL - padR, h = cssH - padT - padB;
        var dark = (typeof theme !== 'undefined' && theme === 'dark');
        var grid = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
        var text = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
        var range = (opts.max - opts.min) || 1;
        var yOf = function (v) { return padT + h - ((v - opts.min) / range) * h; };
        var xOf = function (i, n) { return padL + (n <= 1 ? 0 : (i / (n - 1)) * w); };

        // y axis labels + gridlines
        ctx.font = '10px sans-serif'; ctx.fillStyle = text; ctx.strokeStyle = grid; ctx.lineWidth = 1;
        var divisions = opts.divisions || 4;
        for (var g = 0; g <= divisions; g++) {
            var val = opts.min + (range * g / divisions);
            var y = yOf(val);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
            ctx.fillText(formatAxis(val, range / divisions), 4, y + 3);
        }
        // learned normal band (shaded region between lower/upper + dashed median) — "this is normal for
        // THIS asset". Drawn under the guides and value line. Dashed/fainter while the model is provisional.
        if (opts.band && typeof opts.band.median === 'number') {
            var bLo = yOf(clamp(opts.band.lower, opts.min, opts.max));
            var bHi = yOf(clamp(opts.band.upper, opts.min, opts.max));
            ctx.save();
            ctx.fillStyle = dark ? 'rgba(63,185,80,0.14)' : 'rgba(63,185,80,0.12)';
            ctx.fillRect(padL, bHi, w, Math.max(1, bLo - bHi));
            if (opts.band.median >= opts.min && opts.band.median <= opts.max) {
                ctx.strokeStyle = opts.band.provisional ? '#8a8f98' : '#3fb950';
                ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
                var my = yOf(opts.band.median);
                ctx.beginPath(); ctx.moveTo(padL, my); ctx.lineTo(padL + w, my); ctx.stroke();
            }
            ctx.restore();
        }
        // guide lines (thresholds)
        (opts.guides || []).forEach(function (guide) {
            if (typeof guide.v !== 'number' || guide.v < opts.min || guide.v > opts.max) return;
            var y = yOf(guide.v);
            ctx.save(); ctx.strokeStyle = guide.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke(); ctx.restore();
        });
        // value line
        if (values.length) {
            ctx.strokeStyle = opts.accent; ctx.lineWidth = 1.8; ctx.beginPath();
            values.forEach(function (v, i) {
                var x = xOf(i, values.length), y = yOf(clamp(v, opts.min, opts.max));
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            // condition markers (small dots) so the state is visible along the line
            values.forEach(function (v, i) {
                if (values.length > 120 && i % Math.ceil(values.length / 120) !== 0) return;
                var c = meta[i] && CONDITION_COLOR[meta[i].condition];
                if (!c || meta[i].condition === 'NORMAL') return;
                ctx.fillStyle = c;
                ctx.beginPath(); ctx.arc(xOf(i, values.length), yOf(clamp(v, opts.min, opts.max)), 2, 0, 6.283); ctx.fill();
            });
        }
    }

    // ----- Asset anchor -----
    // When launched with an asset context (/condition-monitoring?wsId=904&dmsId=<asset>), bind the
    // dashboard to that Fusion Manage Asset: show its descriptor and its SENSORS_LIST (WS 968 container
    // -> sensor BOM rows). Without an asset context this is a no-op and the standalone demo runs.
    // The live telemetry stream stays the /iot simulator until individual sensors carry a hardware id
    // (DevEUI) — see docs/features/iot-condition-monitoring/fusion-manage-mapping.md.
    function glob(name) {
        var v = (typeof window[name] !== 'undefined') ? window[name] : '';
        return (v && v !== 'undefined') ? String(v) : '';
    }

    // ?embedded=compact (used by the Instance BOM Editor): status tiles + charts only, plus a link to this page in full.
    $(function () {
        var q = new URLSearchParams(location.search);
        if (!q.get('embedded')) return;
        $('body').addClass('embedded');
        q.delete('embedded');
        $('#cm-fullview-link').attr('href', location.pathname + '?' + q.toString());
    });

    function initAssetContext() {
        var dms = glob('dmsId'), ws = glob('wsId') || '904', desc = glob('descriptor');
        if (!dms) return;                                  // no asset context -> standalone demo
        goLive(dms, null);                                 // asset context => live telemetry for THIS asset,
                                                           // independent of the FM sensor link (device id is
                                                           // refined below / from the backend state)
        $('#cm-asset').show();
        $('#cm-asset-name').text(desc || (ws + '/' + dms)).attr('href', assetUrl(ws, dms));
        $('#cm-asset-link').attr('href', assetUrl(ws, dms));
        $('#cm-info-link').attr('href', assetUrl(ws, dms));
        loadParts(ws, dms, desc);
        $('#cm-chat').show();
        aiChat('#cm-chat', {
            endpoint    : '/iot/ai/chat',
            baseBody    : function () { return { assetId: String(dms) }; },
            placeholder : 'Frage zu Zustand, Baseline oder Events …',
            suggestions : ['Was bedeutet der aktuelle Zustand?', 'Warum gab es das letzte Condition Event?', 'Wie verlässlich ist die Baseline?', 'Was fehlt für eine Diagnose?']
        });
        $.getJSON('/iot/asset?wsId=' + encodeURIComponent(ws) + '&assetId=' + encodeURIComponent(dms), function (res) {
            var d = res.data || res;
            if (d && (d.errorCode || d.error || d.status >= 400)) {
                renderAssetInfoError();
                renderSensors([], 'Sensorzuordnung konnte nicht geladen werden.');
                return;
            }
            if (!desc && d.title) $('#cm-asset-name').text(d.title);
            renderAssetInfo(d);
            var link = findFieldLink(d, 'SENSORS_LIST') || (d.sensor && d.sensor.link);   // /iot/asset returns the sanitized sensor reference
            var m = link && link.match(/workspaces\/(\d+)\/items\/(\d+)/);
            if (!m) { renderSensors([], 'Diesem Asset ist kein Sensor zugeordnet.'); return; }
            // In this tenant a Sensors (968) record IS one sensor bound to the asset and carries
            // IOT_DEVICE_ID directly — read that record's own fields, not a BOM.
            $.getJSON('/plm/details?wsId=' + m[1] + '&dmsId=' + m[2], function (sr) {
                var s = sr.data || sr;
                var deviceId = findFieldValue(s, 'IOT_DEVICE_ID');
                sensorInfo = { name: s.title || 'Sensor', deviceId: deviceId, url: assetUrl(m[1], m[2]) };
                renderSensors([sensorInfo], null);
                if (deviceId) goLive(dms, deviceId);        // real sensor bound -> live telemetry for this asset
            }).fail(function () { renderSensors([], 'Zugeordneter Sensor konnte nicht gelesen werden.'); });
        }).fail(function (xhr) {
            renderSensors([], 'Asset-Details nicht verfügbar (' + (xhr.status || 'Anfrage fehlgeschlagen') + ').');
        });
    }

    // Service-BOM parts of this asset; parts Intelligent Sourcing knows (matched by title) get a deep link.
    // Condition -> part -> sourcing is the Operate -> Source hand-off; nothing is written from here.
    function loadParts(ws, dms, desc) {
        $.when($.getJSON('/iot/asset-parts?wsId=' + encodeURIComponent(ws) + '&assetId=' + encodeURIComponent(dms)),
               $.getJSON('/sourcing/items').then(function (r) { return r; }, function () { return $.Deferred().resolve({ data: [] }); }))
            .done(function (p, s) {
                var parts = (p[0].data && p[0].data.parts) || [], known = {};
                ((s && (s.data || (s[0] && s[0].data))) || []).forEach(function (i) { known[String(i.title).toLowerCase()] = i.id; });
                parts.forEach(function (x) { x.sourcingId = known[x.title.replace(/^.+? - /, '').toLowerCase()]; });
                parts.sort(function (a, b) { return (b.sourcingId ? 1 : 0) - (a.sourcingId ? 1 : 0); });   // sourcable parts first
                var rows = parts.map(function (x) {
                    var id = x.sourcingId;
                    var link = id ? ' <a class="cm-fm-link" href="/intelligent-sourcing?item=' + encodeURIComponent(id) + '&asset=' + encodeURIComponent(dms) +
                        '&assetName=' + encodeURIComponent(desc || '') + '">Beschaffung analysieren →</a>' : '';
                    return '<div class="cm-case-row"><span><a class="cm-fm-link" href="' + escapeHtml(x.url) + '" target="_blank" rel="noopener">' + escapeHtml(x.title) + '</a></span>' +
                        '<strong>' + (link || '') + '</strong></div>';
                });
                if (!rows.length) return;
                $('#cm-parts-list').html(rows.join(''));
                $('#cm-parts').show();
            });
    }

    function findField(details, fieldId) {
        var secs = (details && details.sections) || [];
        for (var i = 0; i < secs.length; i++) {
            var fs = secs[i].fields || [];
            for (var j = 0; j < fs.length; j++) {
                if ((fs[j].__self__ || '').indexOf('/fields/' + fieldId) !== -1) return fs[j];
            }
        }
        return null;
    }
    function findFieldLink(details, fieldId) {
        var f = findField(details, fieldId);
        if (!f || f.value == null) return null;
        return (typeof f.value === 'object') ? (f.value.link || null) : String(f.value);
    }
    function findFieldValue(details, fieldId) {
        var f = findField(details, fieldId);
        if (!f || f.value == null) return null;
        return (typeof f.value === 'object') ? (f.value.title || f.value.descriptor || null) : String(f.value);
    }

    function renderAssetInfo(details) {
        if (!details || details.errorCode || details.error) return renderAssetInfoError();
        var values = {
            'cm-info-id': details.id,
            'cm-info-title': details.title,
            'cm-info-customer': details.customer,
            'cm-info-project': details.projectType,
            'cm-info-asset-bom': details.assetBom,
            'cm-info-operational': details.operational,
            'cm-info-description': details.description
        };
        Object.keys(values).forEach(function (id) { $('#' + id).text(values[id] || '-'); });
        var imageFields = ['IMAGE_1', 'IMAGE_2', 'IMAGE_3', 'IMAGE_4', 'IMAGE_5'];
        var images = imageFields.filter(function (id) { return findFieldValue(details, id); }).length;
        $('#cm-info-images').text(images ? images + ' hinterlegt' : 'Keine hinterlegt');
        $('#cm-asset-info').show();
        $('#cm-asset-info-message').hide();
    }

    function renderAssetInfoError() {
        $('#cm-asset-info').hide();
        $('#cm-asset-info-message').show();
    }

    function loadMaintenanceCase() {
        var assetId = glob('dmsId');
        if (!assetId) return;
        $.getJSON('/iot/maintenance-case?assetId=' + encodeURIComponent(assetId), function (res) {
            var c = res && res.data;
            if (!c) return renderMaintenanceCaseError();
            $('#cm-case-id').empty().append(c.itemUrl
                ? $('<a class="cm-fm-title" target="_blank" rel="noopener" title="In Fusion Manage öffnen"></a>').attr('href', c.itemUrl).text(c.caseId || '-')
                : document.createTextNode(c.caseId || '-'));
            $('#cm-case-event-id').text(c.conditionEventId || '-');
            $('#cm-case-anomaly').text(c.anomalyAtDetection || '-');
            $('#cm-case-driver').text(c.primaryDriver || '-');
            $('#cm-case-workflow').text(c.workflow || '-');
            $('#cm-case-urgency').text(c.urgency || '-');
            $('#cm-case-assessment').text(c.assessment || '-');
            $('#cm-case-cause').text(c.confirmedCause || '-');
            $('#cm-case-link').attr('href', c.itemUrl || '#');
            $('#cm-maintenance-case-message').hide();
            $('#cm-maintenance-case').show();
        }).fail(renderMaintenanceCaseError);
    }

    // Model output is untrusted text: render with .text() only, never .html().
    function loadAiInsight() { runAi('/iot/ai/explain', renderExplain); }
    function loadBriefing() { runAi('/iot/ai/technician-briefing', renderBriefing); }

    // One POST, body exactly { assetId }. Both buttons are locked while a request is in flight.
    function aiFacts() {
        var a = latestAnalytics || {}, vb = a.baseline && a.baseline.vibration, e = events[0], s = samples[samples.length - 1];
        var row = function (l, v) { return '<div class="cm-case-row"><span>' + l + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>'; };
        var stale = s ? cmFormat.staleText(s.t, Date.now()) : '';
        return '<div class="cm-ai-facts-grid"><div><div class="cm-ai-list-title">Gemessene / geprüfte Fakten <span class="cm-src">deterministisch</span></div>' +
            row(stale ? 'Letzter bekannter Zustand / Health' : 'Zustand / Health', s ? s.condition + ' / ' + s.health : 'n/a') + row('Vibration', s ? fmt(s.vibration, 3) + ' ' + (a.unit || 'g') : 'n/a') +
            row('Gelernter Normalbereich', vb ? Math.max(0, vb.lower) + ' – ' + vb.upper + ' ' + (a.unit || 'g') : 'n/a') + row('Anomalie', cmFormat.anomalyText(a.anomalyScore)) +
            row('Telemetrie', s ? new Date(s.t).toLocaleString() + (stale ? ' · ' + stale : '') : 'n/a') + '</div>' +
            '<div><div class="cm-ai-list-title">Event-Belege <span class="cm-src">deterministisch</span></div>' +
            (e ? row('Letztes Event', e.type + ' ' + e.from + ' → ' + e.to) + row('Grund', e.reason) + row('Event-Zeit', new Date(e.timestamp).toLocaleString()) : '<div class="cm-events-empty">Keine Events.</div>') + '</div></div>';
    }

    function runAi(url, render) {
        $('#cm-ai-facts').html(aiFacts()).show();
        var btns = $('#cm-ai-explain, #cm-ai-briefing').prop('disabled', true);
        $('#cm-ai-status').html('<div class="cm-loading"><div class="cm-loading-bar"></div><div>AI Insight wird aus Messwerten, Baseline und Events erzeugt … ca. 15 s</div></div>');
        $.ajax({ url: url, method: 'POST', contentType: 'application/json',
            data: JSON.stringify({ assetId: String(glob('dmsId')) }), dataType: 'json' }).done(function (res) {
            $('#cm-ai-result, #cm-ai-briefing-result').hide();
            render(res.data.insight);
            $('#cm-ai-status').text(res.data.cached
                ? 'Zwischengespeichertes Ergebnis (identischer Kontext, kein neuer KI-Aufruf).'
                : 'Live-KI-Antwort von ' + (res.data.model || res.data.provider || 'Provider') + ' in ' + Math.round((res.data.latencyMs || 0) / 1000) + ' s.');
        }).fail(function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'KI-Einschätzung konnte nicht erzeugt werden.';
            $('#cm-ai-status').text(msg);
            if (xhr.status === 503) { $('#cm-ai-disabled').show(); }
        }).always(function () { btns.prop('disabled', false); });
    }

    function fillList(sel, items) {
        var ul = $(sel).empty();
        items.forEach(function (t) { ul.append($('<li>').text(t)); });
    }

    function renderExplain(i) {
        $('#cm-ai-summary').text(i.summary);
        $('#cm-ai-current').text(i.currentStateExplanation);
        $('#cm-ai-historical').text(i.historicalContext);
        $('#cm-ai-human').text(i.humanAssessmentContext);
        fillList('#cm-ai-checks', i.suggestedChecks);
        fillList('#cm-ai-limitations', i.limitations);
        $('#cm-ai-confidence').text('Konfidenz: ' + i.confidence + '. KI-generierte Erklärung, keine Diagnose. Die menschliche Bewertung hat Vorrang.');
        $('#cm-ai-result').show();
    }

    function renderBriefing(i) {
        $('#cm-brief-headline').text(i.headline);
        $('#cm-brief-situation').text(i.currentSituation);
        fillList('#cm-brief-known', i.knownFacts);
        fillList('#cm-brief-unknown', i.unknowns);
        fillList('#cm-brief-checks', i.recommendedChecks);
        $('#cm-brief-handover').text(i.handoverNote);
        $('#cm-brief-confidence').text('Konfidenz: ' + i.confidence + '. KI-generiertes Briefing, keine Diagnose. Empfohlene Prüfungen sind Vorschläge. Die menschliche Bewertung hat Vorrang.');
        $('#cm-ai-briefing-result').show();
    }

    function renderMaintenanceCaseError() {
        $('#cm-maintenance-case').hide();
        $('#cm-maintenance-case-message').show();
    }

    // ----- Maintenance Case creation (operator-gated) -----
    // Flow: real durable ESCALATION event -> GET preview (non-mutating) -> explicit checkbox -> POST create.
    // The server rebuilds every field from its own stores; the browser only names the event.
    var casePreview = null;          // last preview payload
    var caseEventId = null;          // event the preview belongs to

    function initCaseCreate() {
        $('#cm-case-btn').on('click', function () { var e = latestEscalationEvent(); if (e) openCasePreview(e.eventId); });
        $('#cm-events-list').on('click', '.cm-case-from-event', function () { openCasePreview($(this).data('event-id')); });
        $('#cm-case-confirm').on('change', updateCaseSubmit);
        $('#cm-case-submit').on('click', submitCaseCreate);
    }

    function latestEscalationEvent() {
        for (var i = 0; i < events.length; i++) if (events[i].type === 'ESCALATION' && events[i].eventId) return events[i];   // newest-first
        return null;
    }

    function updateCaseButton() {
        var e = latestEscalationEvent();
        $('#cm-case-btn').prop('disabled', !e || !liveAsset);
        $('#cm-case-latest').text(e
            ? 'Letzte dauerhafte Eskalation: ' + e.from + ' → ' + (e.to || e.severity) + ' am ' + new Date(e.timestamp).toLocaleString() + ' · ' + e.eventId
            : 'Keine dauerhafte Eskalation vorhanden.');
    }

    function caseRow(label, value) {
        return '<div class="cm-case-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value == null || value === '' ? '-' : String(value)) + '</strong></div>';
    }

    function openCasePreview(eventId) {
        if (!eventId || !liveAsset) return;
        caseEventId = eventId; casePreview = null;
        $('#cm-case-result').hide(); $('#cm-case-preview').hide();
        $('#cm-case-confirm').prop('checked', false); updateCaseSubmit();
        $('#cm-case-status').text('Vorschau wird geladen …');
        $.getJSON('/iot/maintenance-case/preview?assetId=' + encodeURIComponent(liveAsset) + '&eventId=' + encodeURIComponent(eventId), function (res) {
            var p = res && res.data; if (!p) return;
            casePreview = p;
            var ev = p.event, c = p.conditionSnapshot || {}, b = p.baseline || {}, f = p.fieldMapping || {}, ai = p.aiSummary, idem = p.idempotency || {};
            var rows = [
                caseRow('Quelle', p.source), caseRow('Asset', (p.asset && p.asset.title) ? p.asset.id + ' · ' + p.asset.title : (p.asset && p.asset.id)),
                caseRow('Condition Event', ev.eventId), caseRow('Übergang', ev.from + ' → ' + ev.to + ' (' + ev.severity + ')'),
                caseRow('Erkannt am', new Date(ev.detectedAt).toLocaleString()), caseRow('Grund', ev.reason),
                caseRow('Anomalie bei Erkennung', ev.anomalyScore), caseRow('Primärer Treiber', ev.primaryDriver),
                caseRow('Aktueller Zustand', c.condition + ' · Health ' + c.health + ' · Anomalie ' + (c.anomalyScore == null ? 'n/a' : c.anomalyScore)),
                caseRow('Aktuelle Vibration / Temperatur', c.vibrationG + ' g / ' + (c.temperatureC == null ? 'n/a' : c.temperatureC + ' °C')),
                caseRow('Baseline', (b.frozen ? 'eingefroren' : 'nicht eingefroren') + ' · Median ' + b.medianG + ' g · MAD ' + b.madG + ' g · oben ' + b.upperBandG + ' g'),
                caseRow('KI-Zusammenfassung (nur Kontext)', ai ? (ai.explainSummary || ai.briefingHeadline) : 'noch keine erzeugt'),
                caseRow('FM-Ziel', 'Workspace ' + f.workspaceId + ' · Section ' + (f.sectionId || 'nicht gesetzt') + ' · initialer Workflow ' + f.initialWorkflow),
                caseRow('Felder', Object.keys(f.fields || {}).map(function (k) { return k + '=' + f.fields[k]; }).join(', ') + (f.references && f.references.ASSET ? ', ASSET→' + f.references.ASSET.link : '')),
                caseRow('Bewertung / bestätigte Ursache', 'bleibt leer (nur durch Menschen)'),
                caseRow('Idempotenz', (idem.localLink ? 'lokale Verknüpfung → Item ' + idem.localLink.fmDmsId : 'keine lokale Verknüpfung') + ' · FM-Suche ' + (idem.fmSearch ? idem.fmSearch.status + ' (' + idem.fmSearch.matches.length + ' Treffer)' : 'n/a')),
                caseRow('Schreib-Gate', p.writeEnabled ? 'AKTIV' : 'auf diesem Server DEAKTIVIERT'),
                caseRow('Blocker', (p.blockers || []).join(', ') || 'keine')
            ];
            $('#cm-case-preview-body').html(rows.join(''));
            $('#cm-case-preview').show();
            if (p.existingCase) $('#cm-case-status').text('Für dieses Event existiert bereits ein Case (Item ' + p.existingCase.fmDmsId + '). Es wird kein neuer Case angelegt.');
            else if (!p.writeEnabled) $('#cm-case-status').text('Nur Vorschau – Schreiben nach Fusion Manage ist auf diesem Server deaktiviert.');
            else if (p.blockers.length) $('#cm-case-status').text('Vorschau geladen – Anlage blockiert: ' + p.blockers.join(', '));
            else $('#cm-case-status').text('Vorschau geladen. Zum Anlegen bestätigen.');
            updateCaseSubmit();
        }).fail(function (xhr) {
            $('#cm-case-status').text('Vorschau fehlgeschlagen: ' + ((xhr.responseJSON && xhr.responseJSON.message) || xhr.status));
        });
    }

    function updateCaseSubmit() {
        var ok = !!(casePreview && casePreview.writeEnabled && !casePreview.blockers.length && $('#cm-case-confirm').prop('checked'));
        $('#cm-case-submit').prop('disabled', !ok).text(casePreview && !casePreview.writeEnabled ? 'In Fusion Manage anlegen (Schreiben deaktiviert)' : 'In Fusion Manage anlegen');
    }

    function submitCaseCreate() {
        if (!casePreview || !caseEventId || !liveAsset) return;
        $('#cm-case-submit, #cm-case-btn').prop('disabled', true);
        $('#cm-case-status').text('Wird angelegt …');
        $.ajax({ url: '/iot/maintenance-case/create', method: 'POST', contentType: 'application/json', dataType: 'json',
            data: JSON.stringify({ assetId: String(liveAsset), eventId: String(caseEventId), confirm: 'CREATE_MAINTENANCE_CASE' }) }).done(function (res) {
            var d = res.data || {};
            $('#cm-case-result-body').html([
                caseRow('Ergebnis', d.outcome === 'created' ? 'Angelegt' : 'Bestehender Case gefunden'),
                caseRow('FM-Item (dmsId)', d.fmDmsId), caseRow('FM-ID', d.fmId), caseRow('Workflow', d.workflow || 'Definition'),
                caseRow('Verknüpftes Condition Event', d.conditionEventId)
            ].join(''));
            $('#cm-case-result').show(); $('#cm-case-preview').hide();
            $('#cm-case-status').text(d.outcome === 'created' ? 'In Fusion Manage angelegt.' : 'Bestehender Case gefunden – nichts angelegt.');
            loadMaintenanceCase();   // the Historical detection panel now shows the real case
        }).fail(function (xhr) {
            var m = (xhr.responseJSON && xhr.responseJSON.message) || 'Anfrage fehlgeschlagen';
            $('#cm-case-status').text(xhr.status === 503 && m === 'WRITE_DISABLED' ? 'Schreiben auf diesem Server deaktiviert – nichts angelegt.' : 'Fehler: ' + m);
        }).always(function () { updateCaseButton(); updateCaseSubmit(); });
    }

    function renderSensors(sensors, emptyMsg) {
        var list = $('#cm-sensors-list');
        if (!sensors.length) {
            list.html('<div class="cm-events-empty">' + escapeHtml(emptyMsg || 'Diesem Asset ist noch kein Sensor zugeordnet.') + '</div>');
            return;
        }
        list.empty();
        sensors.forEach(function (s) {
            var id = s.deviceId ? '<span class="cm-sensor-id">' + escapeHtml(s.deviceId) + '</span>'
                                : '<span class="cm-sensor-id cm-sensor-noid">keine Device-ID</span>';
            var label = s.url
                ? '<a class="cm-sensor-name cm-fm-title" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" title="Sensor-Datensatz in Fusion Manage öffnen">' + escapeHtml(s.name) + '</a>'
                : '<span class="cm-sensor-name">' + escapeHtml(s.name) + '</span>';
            list.append('<div class="cm-sensor-row"><span class="cm-dot" style="background:#58a6ff"></span>' + label + id + '</div>');
        });
    }

    function maxOf(arr, key) { return arr.reduce(function (m, s) { return Math.max(m, s[key] || 0); }, 0); }
    function niceCeil(value) {
        if (!(value > 0)) return 0.1;
        var power = Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
        var fraction = value / power;
        var nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
        return nice * power;
    }
    function autoScale(values, minimumSpan, floorAtZero, targetDivisions) {
        targetDivisions = targetDivisions || 4;
        var finite = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
        if (!finite.length) return { min: 0, max: minimumSpan || 1, divisions: targetDivisions };
        var low = Math.min.apply(Math, finite), high = Math.max.apply(Math, finite);
        var span = Math.max(high - low, minimumSpan || 0);
        var center = (low + high) / 2;
        var paddedLow = center - span * 0.6, paddedHigh = center + span * 0.6;
        if (floorAtZero) paddedLow = Math.max(0, paddedLow);
        var step = niceCeil((paddedHigh - paddedLow) / targetDivisions);
        var min = Math.floor(paddedLow / step) * step;
        var max = Math.ceil(paddedHigh / step) * step;
        if (floorAtZero) min = Math.max(0, min);
        if (max <= min) max = min + step;
        return { min: min, max: max, divisions: Math.round((max - min) / step) };
    }
    function focusedTemperatureScale(values) {
        var finite = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
        if (!finite.length) return { min: 20, max: 35, divisions: 30 };
        var low = Math.max(20, Math.min.apply(Math, finite));
        var high = Math.min(35, Math.max.apply(Math, finite));
        var center = (low + high) / 2;
        var span = Math.max(high - low, 2);
        var min = Math.max(20, Math.floor((center - span / 2) * 2) / 2);
        var max = Math.min(35, Math.ceil((center + span / 2) * 2) / 2);
        if (max - min < 2) max = Math.min(35, min + 2);
        return { min: min, max: max, divisions: Math.round((max - min) * 2) };
    }
    function formatAxis(value, step) {
        var decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
        return value.toFixed(decimals);
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function fmt(v, d) { return (typeof v === 'number') ? v.toFixed(d) : '-'; }
    function assetUrl(ws, dms) {
        if (typeof genItemURL === 'function') return genItemURL({ wsId: ws, dmsId: dms });
        return (typeof tenantLink === 'string' ? tenantLink : '') + '/plm/workspaces/' + ws + '/items/' + dms;
    }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

})();
