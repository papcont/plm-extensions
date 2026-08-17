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
    var paused = false;
    var timer = null;

    $(document).ready(function () {
        initAssetContext();
        $.getJSON('/iot/config', function (res) {
            cfg = res.data;
            $('#cm-source').text('source: ' + cfg.source);
            start();
        }).fail(function () { $('#cm-source').text('source: unavailable'); });

        $('#cm-pause').on('click', function () {
            paused = !paused;
            $(this).toggleClass('icon-pause', !paused).toggleClass('icon-play', paused);
        });
        $('#cm-reset').on('click', function () {
            $.post('/iot/reset', function () { samples = []; events = []; renderEvents(); });
        });
        $('#cm-range').on('change', renderCharts);
        $(window).on('resize', renderCharts);
    });

    function start() {
        if (timer) clearInterval(timer);
        timer = setInterval(poll, 1000);
        poll();
    }

    function poll() {
        if (paused) return;
        $.ajax({ url: '/iot/tick', method: 'POST' }).done(function (res) {
            if (!res.success || !res.data.accepted) return;
            var d = res.data;
            samples.push({
                t: d.summary.lastTelemetry,
                health: d.health.score,
                vibration: d.health.vibration,
                temperature: d.summary.temperature,
                condition: d.condition.condition
            });
            if (samples.length > 5000) samples.splice(0, samples.length - 5000);
            if (d.conditionEvent) { events.unshift(d.conditionEvent); if (events.length > 50) events.pop(); renderEvents(); }
            renderTiles();
            renderCharts();
        });
    }

    function renderTiles() {
        var s = samples[samples.length - 1];
        if (!s) return;
        $('#cm-status-dot').css('background', CONDITION_COLOR[s.condition] || '#8a8f98');
        $('#cm-status-text').text(s.condition).css('color', CONDITION_COLOR[s.condition] || '');
        $('#cm-health').text(s.health);
        $('#cm-temp').text(fmt(s.temperature, 1));
        $('#cm-vib').text(fmt(s.vibration, 2));
        $('#cm-updated').text(new Date(s.t).toLocaleTimeString());

        var prev = samples[samples.length - 2];
        var trend = $('#cm-vib-trend');
        if (prev) {
            if (s.vibration > prev.vibration + 0.05)      trend.text(' ▲').css('color', '#f85149');
            else if (s.vibration < prev.vibration - 0.05) trend.text(' ▼').css('color', '#3fb950');
            else                                          trend.text(' –').css('color', '#8a8f98');
        }
        if (events[0]) $('#cm-last-event').text(events[0].severity + ' · ' + new Date(events[0].timestamp).toLocaleTimeString());
    }

    function renderEvents() {
        var list = $('#cm-events-list');
        if (!events.length) { list.html('<div class="cm-events-empty">No events yet.</div>'); return; }
        list.empty();
        events.forEach(function (e) {
            var color = CONDITION_COLOR[e.severity] || '#8a8f98';
            list.append(
                '<div class="cm-event-row">' +
                '<span class="cm-dot" style="background:' + color + '"></span>' +
                '<span class="cm-event-sev" style="color:' + color + '">' + e.severity + '</span>' +
                '<span class="cm-event-type">' + e.type + '</span>' +
                '<span class="cm-event-reason">' + escapeHtml(e.reason) + '</span>' +
                '<span class="cm-event-time">' + new Date(e.timestamp).toLocaleTimeString() + '</span>' +
                '</div>');
        });
    }

    function windowed() {
        var n = parseInt($('#cm-range').val(), 10) || 0;
        return (n > 0 && samples.length > n) ? samples.slice(samples.length - n) : samples;
    }

    function renderCharts() {
        var data = windowed();
        var th = cfg ? cfg.thresholds : { vibration: {}, temperature: {} };
        lineChart('cm-chart-health', data.map(function (s) { return s.health; }), data, {
            min: 0, max: 100, accent: '#58a6ff',
            guides: [{ v: (cfg && cfg.conditionBands.warning) || 40, color: '#d29922' }]
        });
        var vibMax = Math.max((th.vibration.critical || 8) * 1.25, maxOf(data, 'vibration'));
        lineChart('cm-chart-vib', data.map(function (s) { return s.vibration; }), data, {
            min: 0, max: vibMax, accent: '#d29922',
            guides: [{ v: th.vibration.warn, color: '#d29922' }, { v: th.vibration.critical, color: '#f85149' }]
        });
        var tMax = Math.max((th.temperature.critical || 80) * 1.1, maxOf(data, 'temperature'));
        lineChart('cm-chart-temp', data.map(function (s) { return s.temperature; }), data, {
            min: 20, max: tMax, accent: '#ff7b72',
            guides: [{ v: th.temperature.warn, color: '#d29922' }, { v: th.temperature.critical, color: '#f85149' }]
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
        for (var g = 0; g <= 4; g++) {
            var val = opts.min + (range * g / 4);
            var y = yOf(val);
            ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
            ctx.fillText(Math.round(val), 4, y + 3);
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

    function initAssetContext() {
        var dms = glob('dmsId'), ws = glob('wsId') || '904', desc = glob('descriptor');
        if (!dms) return;                                  // no asset context -> standalone demo
        $('#cm-asset').show();
        $('#cm-asset-name').text(desc || (ws + '/' + dms));
        $.getJSON('/plm/details?wsId=' + ws + '&dmsId=' + dms, function (res) {
            var d = res.data || res;
            if (!desc && d.title) $('#cm-asset-name').text(d.title);
            var link = findFieldLink(d, 'SENSORS_LIST');
            var m = link && link.match(/workspaces\/(\d+)\/items\/(\d+)/);
            if (!m) { renderSensors([], 'This asset has no linked sensor.'); return; }
            // In this tenant a Sensors (968) record IS one sensor bound to the asset and carries
            // IOT_DEVICE_ID directly — read that record's own fields, not a BOM.
            $.getJSON('/plm/details?wsId=' + m[1] + '&dmsId=' + m[2], function (sr) {
                var s = sr.data || sr;
                renderSensors([{ name: s.title || 'Sensor', deviceId: findFieldValue(s, 'IOT_DEVICE_ID') }], null);
            }).fail(function () { renderSensors([], 'Could not read the linked sensor.'); });
        }).fail(function () { renderSensors([], 'Asset details unavailable.'); });
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
    function findFieldLink(details, fieldId) { var f = findField(details, fieldId); return (f && f.value && f.value.link) || null; }
    function findFieldValue(details, fieldId) {
        var f = findField(details, fieldId);
        if (!f || f.value == null) return null;
        return (typeof f.value === 'object') ? (f.value.title || f.value.descriptor || null) : String(f.value);
    }

    function renderSensors(sensors, emptyMsg) {
        var list = $('#cm-sensors-list');
        if (!sensors.length) {
            list.html('<div class="cm-events-empty">' + escapeHtml(emptyMsg || 'No sensor linked to this asset yet.') + '</div>');
            return;
        }
        list.empty();
        sensors.forEach(function (s) {
            var id = s.deviceId ? '<span class="cm-sensor-id">' + escapeHtml(s.deviceId) + '</span>'
                                : '<span class="cm-sensor-id cm-sensor-noid">no device id</span>';
            list.append('<div class="cm-sensor-row"><span class="cm-dot" style="background:#58a6ff"></span>' +
                '<span class="cm-sensor-name">' + escapeHtml(s.name) + '</span>' + id + '</div>');
        });
    }

    function maxOf(arr, key) { return arr.reduce(function (m, s) { return Math.max(m, s[key] || 0); }, 0); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function fmt(v, d) { return (typeof v === 'number') ? v.toFixed(d) : '-'; }
    function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

})();
