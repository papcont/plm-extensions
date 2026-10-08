def sub(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)

JS = 'public/javascripts/apps/intelligent-sourcing.js'
s = open(JS, encoding='utf8').read()

# ---- 1. alternatives: slide taxonomy A Standardprofil, B ähnliches Teil, C anderer Lieferant, D Biegeteil statt Frästeil
a = s.index("        var cards = [['A', 'New bent part', A]")
b = s.index("        $('#is-alt-body').html(")
s = s[:a] + "        // Slide taxonomy (Engineering Intelligence): A Standardprofil, B ähnliches Teil, C anderer Lieferant, D Biegeteil statt Frästeil.\n        // Our deterministic recommendation (new bent part) is option D. Statuses and evidence are unchanged.\n        var cards = [['A', 'Standardprofil / U-Profil', C], ['B', 'Vorhandenes ähnliches Teil', B], ['C', 'Alternativer Lieferant', D], ['D', 'Alternative Fertigung / Biegeteil', A]];\n" + s[b:]

# ---- 2. assistant: replace old AI block (button + render) with fixed question list
a = s.index("    function aiHtml() {")
b = s.index("    function showWhy(id)")
new_ai = r"""    // ----- Assistant: FIXED questions (no free text). Answers: Empfehlung / Belege / QUELLEN / Offen. -----
    var QUESTIONS = [];            // /sourcing/ai/questions
    var answers = {};              // questionId -> rendered answer html (per analysis)
    var activeQuestion = null;
    function aiHtml() {
        if (activeQuestion && answers[activeQuestion]) return answers[activeQuestion];
        if (cfg && !cfg.aiEnabled) return '<div class="cm-events-empty">Der Assistent ist auf diesem Server deaktiviert. Verified facts, Calculated result und Missing evidence stehen für sich.</div>';
        return '<div class="cm-events-empty">Eine Frage oben wählen. Antworten nennen Quellen und offene Punkte; die KI ändert kein technisches Ergebnis.</div>';
    }
    function renderQuestions() {
        $('#is-assist-q').html(QUESTIONS.map(function (q) {
            return '<button type="button" class="button is-q' + (q.id === activeQuestion ? ' is-q-on' : '') + '" data-q="' + esc(q.id) + '"' + (cfg && !cfg.aiEnabled && !q.deterministic ? ' disabled' : '') + '>' + esc(q.text) + '</button>';
        }).join(''));
    }
    function loadingHtml(text) { return '<div class="cm-loading"><div class="cm-loading-bar"></div><div>' + esc(text) + '</div></div>'; }
    function askQuestion(id) {
        activeQuestion = id; renderQuestions();
        if (answers[id]) { $('#is-ai-box').html(answers[id]); return; }
        var q = QUESTIONS.filter(function (x) { return x.id === id; })[0];
        $('#is-assist-q .is-q').prop('disabled', true);
        $('#is-ai-box').html(loadingHtml(q && q.deterministic ? 'Antwort wird geprüft …' : 'Assistent prüft deterministische Analyse, Quellen und offene Punkte … ca. 20 s'));
        var body = request(); body.questionId = id;
        $.ajax({ url: '/sourcing/ai/ask', method: 'POST', contentType: 'application/json', dataType: 'json', data: JSON.stringify(body) }).done(function (res) {
            var d = res.data, i = d.insight;
            answers[id] = '<div class="is-ans-q">' + esc(d.question) + '</div><div class="is-ans-main">' + esc(i.answer) + '</div>' +
                (i.evidence.length ? '<div class="is-ai-sub">Belege</div>' + list(i.evidence.map(function (x) { return '<li>' + esc(x) + '</li>'; })) : '') +
                '<div class="is-ai-sub">Quellen</div><div>' + (i.sources.length ? i.sources.map(function (x) { return '<span class="is-src is-src-' + (x === 'Prototype / Local' ? 'proto' : x === 'Similarity Prototype' ? 'sim' : 'fm') + '">' + esc(x) + '</span>'; }).join('') : '<span class="is-muted">keine</span>') + '</div>' +
                '<div class="is-ai-sub">Offen / REVIEW</div>' + (i.openItems.length ? list(i.openItems.map(function (x) { return '<li>' + esc(x) + '</li>'; })) : '<div class="is-muted">nichts offen</div>') +
                '<div class="cm-case-note">' + (d.deterministic ? 'Feste Antwort, kein KI-Aufruf: dafür gibt es keine Datenquelle.' : 'AI Interpretation – kein technisches Urteil · ' + esc(d.model || d.provider) + ' · ' + (d.cached ? 'cached' : 'live, ' + Math.round((d.latencyMs || 0) / 1000) + ' s') + ' · Engine-Empfehlung unverändert: ' + esc(d.recommendedName || 'none')) + '</div>';
            $('#is-ai-box').html(answers[id]);
        }).fail(function (xhr) {
            $('#is-ai-box').html('<div class="cm-events-empty">' + esc((xhr.responseJSON && xhr.responseJSON.message) || 'Antwort konnte nicht erzeugt werden.') + '</div>');
        }).always(function () { renderQuestions(); });
    }
"""
s = s[:a] + new_ai + s[b:]

s = s.replace("        $('#is-why-body').on('click', '#is-ai-run', runAi);\n", "        $('#is-assist-q').on('click', '.is-q', function () { askQuestion($(this).data('q')); });\n")

# analyze(): reset answers + load questions once
s = s.replace("        $('#is-f-status').text('Analyzing…'); aiResult = null;", "        $('#is-f-status').text('Analyzing…'); aiResult = null; answers = {}; activeQuestion = null;")
s = s.replace("            renderAll();\n        }).fail(function (xhr) {\n            analysis = null;", "            renderAll();\n            if (!QUESTIONS.length) $.getJSON('/sourcing/ai/questions', function (r) { QUESTIONS = r.data || []; renderQuestions(); }); else renderQuestions();\n        }).fail(function (xhr) {\n            analysis = null;")

# why panel: AI block title + content from aiHtml, question bar container above blocks
s = s.replace("""'<div class="is-block"><div class="is-block-title">AI interpretation</div><div id="is-ai-box">' + aiHtml() + '</div></div>' +""",
              """'<div class="is-block is-block-ai"><div class="is-block-title">AI interpretation</div><div id="is-ai-box">' + aiHtml() + '</div></div>' +""")
open(JS, 'w', encoding='utf8').write(s)

# ---- pug: question bar in section 5
sub('views/apps/intelligent-sourcing.pug', [
("""                .is-step-label 5 · Warum diese Empfehlung?
                #is-why-body""", """                .is-step-label 5 · Warum diese Empfehlung?
                .is-assist
                    .is-assist-title Fragen an den Assistant
                    #is-assist-q.is-assist-q
                    .cm-ai-note AI Interpretation – nur auf Klick, feste Fragen. Der Assistant erklärt das deterministische Ergebnis und erfindet keine Daten.
                #is-why-body"""),
])

# ---- css
open('public/stylesheets/apps/intelligent-sourcing.css', 'a', encoding='utf8').write("""
.is-assist { margin-bottom: 14px; }
.is-assist-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.65; margin-bottom: 8px; }
.is-assist-q { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
.is-q { height: auto; line-height: 18px; padding: 6px 14px; font-size: 13px; }
.is-q-on { outline: 2px solid var(--color-blue-500); }
.is-ans-q { font-size: 12px; opacity: 0.65; margin-bottom: 4px; }
.is-ans-main { font-size: 15px; font-weight: 600; line-height: 1.45; margin-bottom: 6px; }
""")
open('public/stylesheets/apps/condition-monitoring.css', 'a', encoding='utf8').write("""
/* Shared AI loading state (Sourcing assistant + Condition Monitoring AI Insight): visible progress for 10-20 s waits. */
.cm-loading { display: flex; flex-direction: column; gap: 8px; font-size: 13px; padding: 6px 0; }
.cm-loading-bar { position: relative; height: 4px; border-radius: 2px; overflow: hidden; background: rgba(128,128,128,0.25); }
.cm-loading-bar::after { content: ''; position: absolute; top: 0; bottom: 0; width: 35%; background: var(--color-blue-500); animation: cm-load 1.4s ease-in-out infinite; }
@keyframes cm-load { 0% { left: -35%; } 100% { left: 100%; } }
""")

# ---- IoT: loading text with bar
sub('public/javascripts/apps/condition-monitoring.js', [
("""        $('#cm-ai-status').text('Generating…');""", """        $('#cm-ai-status').html('<div class="cm-loading"><div class="cm-loading-bar"></div><div>AI Insight wird aus Messwerten, Baseline und Events erzeugt … ca. 15 s</div></div>');"""),
])
