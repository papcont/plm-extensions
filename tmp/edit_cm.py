p='views/apps/condition-monitoring.pug'
s=open(p,encoding='utf8').read()
def rep(a,b):
    global s
    assert a in s,a[:50]; s=s.replace(a,b,1)
rep("""        #condition-monitoring

""","""        #condition-monitoring

            .cm-pipeline
                span Telemetrie
                span.cm-pipe-arrow →
                span Gelernte Baseline (eingefroren)
                span.cm-pipe-arrow →
                span Ergebnis Condition · Anomalie · Event
                span.cm-pipe-arrow →
                span.cm-pipe-ai KI-Erklärung (nur auf Klick)
                span.cm-pipe-arrow →
                span Mensch / Maintenance Case

""")
rep(".cm-label AI model",".cm-label Baseline model")
rep("""            #cm-controls.surface-level-2""","""            #cm-baseline.surface-level-2
                .cm-section-title Learned baseline
                #cm-baseline-body
                    .cm-events-empty Learning this asset’s normal behavior…

            #cm-controls.surface-level-2""")
rep("""                .cm-section-title Condition events
                #cm-events-list""","""                .cm-section-title Condition events
                #cm-latest-event
                #cm-events-list""")
start=s.index("            #cm-ai-insight.surface-level-2")
end=s.index("            //- Operator-gated Maintenance Case creation")
ai=s[start:end]; s=s[:start]+s[end:]
ai=ai.replace("""                .cm-ai-note AI interpretation – no automatic diagnosis. Explicit request only; nothing is written to Fusion Manage.""","""                .cm-ai-note AI interpretation – no automatic diagnosis. Explicit request only; nothing is written to Fusion Manage.
                .cm-ai-status#cm-ai-disabled(style='display:none') AI Insight ist auf diesem Server deaktiviert. Messwerte, Baseline und Condition Events oben bleiben vollständig verfügbar.""")
ai=ai.replace("""                #cm-ai-result(style='display:none')
                    .cm-ai-summary#cm-ai-summary""","""                #cm-ai-facts(style='display:none')
                #cm-ai-result(style='display:none')
                    .cm-ai-list-title AI interpretation
                    .cm-ai-summary#cm-ai-summary""")
ai=ai.replace("""                    .cm-ai-list-title Limitations""","""                    .cm-ai-list-title Uncertainty / limitations""")
ai=ai.replace("""                    .cm-section-title Technician Briefing""","""                    .cm-section-title Technician Briefing – AI interpretation""")
rep("            #cm-maintenance-case.surface-level-2(style='display:none')", ai+"            #cm-maintenance-case.surface-level-2(style='display:none')")
open(p,'w',encoding='utf8').write(s)

p='public/javascripts/apps/condition-monitoring.js'
s=open(p,encoding='utf8').read()
rep("        $('#cm-trend').text(a.trend || '-');\n        renderWhy();","        $('#cm-trend').text(a.trend || '-');\n        renderWhy();\n        renderBaseline();")
rep("    function whyRow(label, value, detail) {","""    // Learned baseline, straight from the analytics snapshot. Frozen = learning stopped; the anomaly is measured against it.
    function renderBaseline() {
        var a = latestAnalytics, body = $('#cm-baseline-body'), vb = a && a.baseline && a.baseline.vibration, u = (a && a.unit) || 'g';
        if (!a || !vb) { body.html('<div class="cm-events-empty">Noch keine gelernte Baseline.</div>'); return; }
        var row = function (l, v) { return '<div class="cm-case-row"><span>' + l + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>'; };
        body.html('<div class="cm-baseline-grid"><div>' +
            row('Baseline status', a.baselineFrozen ? 'FROZEN – Lernen beendet' : (a.modelState === 'READY' ? 'READY – lernt noch' : 'LEARNING')) +
            row('Frozen at', a.baselineFrozenAt ? new Date(a.baselineFrozenAt).toLocaleString() : 'n/a') +
            row('Samples', a.sampleCount + (a.minimumSamples ? ' (Minimum ' + a.minimumSamples + ')' : '')) + '</div><div>' +
            row('Vibration median', vb.median + ' ' + u) + row('MAD', vb.mad + ' ' + u) +
            row('Normal band (lower–upper)', Math.max(0, vb.lower) + ' – ' + vb.upper + ' ' + u) + '</div></div>' +
            '<div class="cm-case-note">Die aktuelle Anomalie wird gegen diese gelernte Referenz gemessen. Vibration ist Spitzenbeschleunigung in g (nicht mm/s), ohne FFT-Spektrum. Das ist keine Ausfallwahrscheinlichkeit und keine Restlaufzeit.</div>');
    }

    function whyRow(label, value, detail) {""")
rep("        list.empty();\n        events.forEach(function (e) {","""        var latest = events[0], esc1 = events.filter(function (e) { return e.type === 'ESCALATION'; })[0];
        var ev = function (title, e) {
            if (!e) return '';
            var c = CONDITION_COLOR[e.severity] || '#8a8f98', b = e.baselineRef && e.baselineRef.vibration;
            return '<div class="cm-event-card"><div class="cm-case-block-title">' + title + '</div>' +
                '<div class="cm-case-row"><span>Type</span><strong style="color:' + c + '">' + escapeHtml(e.type) + ' · ' + escapeHtml(e.from) + ' → ' + escapeHtml(e.to) + '</strong></div>' +
                '<div class="cm-case-row"><span>Severity / time</span><strong>' + escapeHtml(e.severity) + ' · ' + new Date(e.timestamp).toLocaleString() + '</strong></div>' +
                '<div class="cm-case-row"><span>Reason</span><strong>' + escapeHtml(e.reason) + '</strong></div>' +
                '<div class="cm-case-row"><span>Anomaly / health / driver</span><strong>' + escapeHtml(cmFormat.anomalyText(e.anomalyScore) + ' / ' + e.healthScore + ' / ' + (e.primaryDriver || 'n/a')) + '</strong></div>' +
                (e.metrics ? '<div class="cm-case-row"><span>Vibration at event</span><strong>' + escapeHtml(e.metrics.vibration + ' ' + (e.metrics.vibrationUnit || 'g') + (b ? ' (normal ≤ ' + b.upper + ')' : '')) + '</strong></div>' : '') +
                '<div class="cm-case-row"><span>Event ID</span><strong class="cm-mono">' + escapeHtml(e.eventId || 'n/a') + '</strong></div></div>';
        };
        $('#cm-latest-event').html('<div class="cm-event-cards">' + ev('Latest condition event', latest) + (esc1 && esc1 !== latest ? ev('Latest escalation', esc1) : '') + '</div>');
        list.empty();
        events.forEach(function (e) {""")
rep("    function runAi(url, render) {","""    function aiFacts() {
        var a = latestAnalytics || {}, vb = a.baseline && a.baseline.vibration, e = events[0], s = samples[samples.length - 1];
        var row = function (l, v) { return '<div class="cm-case-row"><span>' + l + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>'; };
        var stale = s ? cmFormat.staleText(s.t, Date.now()) : '';
        return '<div class="cm-ai-facts-grid"><div><div class="cm-ai-list-title">Measured / verified facts <span class="cm-src">deterministisch</span></div>' +
            row('Condition / health', s ? s.condition + ' / ' + s.health : 'n/a') + row('Vibration', s ? s.vibration + ' ' + (a.unit || 'g') : 'n/a') +
            row('Learned normal band', vb ? Math.max(0, vb.lower) + ' – ' + vb.upper + ' ' + (a.unit || 'g') : 'n/a') + row('Anomaly', cmFormat.anomalyText(a.anomalyScore)) +
            row('Telemetry', s ? new Date(s.t).toLocaleString() + (stale ? ' · ' + stale : '') : 'n/a') + '</div>' +
            '<div><div class="cm-ai-list-title">Event evidence <span class="cm-src">deterministisch</span></div>' +
            (e ? row('Latest event', e.type + ' ' + e.from + ' → ' + e.to) + row('Reason', e.reason) + row('Event time', new Date(e.timestamp).toLocaleString()) : '<div class="cm-events-empty">Keine Events.</div>') + '</div></div>';
    }

    function runAi(url, render) {
        $('#cm-ai-facts').html(aiFacts()).show();""")
rep("""            $('#cm-ai-status').text((xhr.responseJSON && xhr.responseJSON.message) || 'AI Insight could not be generated.');""","""            var msg = (xhr.responseJSON && xhr.responseJSON.message) || 'AI Insight could not be generated.';
            $('#cm-ai-status').text(msg);
            if (xhr.status === 503) { $('#cm-ai-disabled').show(); }""")
open(p,'w',encoding='utf8').write(s)

open('public/stylesheets/apps/condition-monitoring.css','a',encoding='utf8').write("""
#condition-monitoring { position: absolute; top: 68px; bottom: 0; left: 0; right: 0; }
.cm-baseline-grid, .cm-ai-facts-grid, .cm-event-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 8px 32px; }
.cm-event-cards { margin-bottom: 14px; }
.cm-event-card { padding: 10px 12px; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 3px; }
.cm-mono { font-family: Consolas, monospace; font-size: 11px; }
.cm-src { font-size: 10px; font-weight: 500; border: 1px solid rgba(128,128,128,0.45); border-radius: 8px; padding: 0 6px; margin-left: 6px; opacity: 0.75; }
#cm-ai-facts { margin: 10px 0 14px; }
""")
