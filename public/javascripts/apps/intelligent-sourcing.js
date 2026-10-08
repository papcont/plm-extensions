// Intelligent Sourcing. Talks only to the /sourcing/* backend: deterministic analysis -> recommendation,
// alternatives, eligibility, ranking, comparison, explanation, history, RFQ preview (never written).
// No PLM/APS calls. All server and model text is rendered via esc().

(function () {

    var cfg = null, items = [], analysis = null, selectedWhy = null, aiResult = null;
    var compare = [];            // supplierIds in the comparison (max 3)
    var rfqIds = [];             // supplierIds proposed for the RFQ preview

    var CHIP = {
        fm:    { cls: 'fm',    label: 'Fusion Manage' },
        proto: { cls: 'proto', label: 'Prototype / Local' },
        sim:   { cls: 'sim',   label: 'Similarity Prototype' },
        ai:    { cls: 'ai',    label: 'AI Interpretation' },
        demo:  { cls: 'demo',  label: 'Demo Seed' },
        ctx:   { cls: 'demo',  label: 'Konferenz-Konfiguration' }
    };
    var CHECK_LABEL = { process: 'Prozess', material: 'Werkstoff', toleranceClass: 'Toleranz', maxDimensionMm: 'Größe', certifications: 'Zertifikate', capacity: 'Kapazität' };
    var CHECK_ORDER = ['process', 'material', 'toleranceClass', 'maxDimensionMm', 'certifications', 'capacity'];
    var STD_PROFILE_MISSING = ['Innenradius', 'Lastfall', 'Anschlussgeometrie'];
    // Display labels only; engine identifiers stay unchanged.
    var MISSING_LABEL = { capability: 'Fähigkeitsdaten', price: 'Preis', history: 'Historie', leadTime: 'Lieferzeit', requiredDate: 'Bedarfstermin', qualityHistory: 'Qualitätshistorie' };
    var PRICE_SRC = { quote: 'Angebot', history: 'Historie' };

    // ?embedded=compact (used by the Supplier Package Center): request, recommendation and alternatives only.
    var embeddedQuery = new URLSearchParams(location.search);
    if (embeddedQuery.get('embedded')) {
        $(function () {
            $('body').addClass('embedded');
            var q = new URLSearchParams(location.search); q.delete('embedded'); q.delete('from'); q.delete('fromName');
            $('#is-fullview-link').attr('href', location.pathname + '?' + q.toString());
        });
    }

    $(document).ready(function () {
        var c = (typeof config !== 'undefined' && config) || {};
        $('#is-qty').val(c.defaultQuantity || 20);
        var d = new Date(); d.setDate(d.getDate() + (c.defaultLeadDays || 38));
        $('#is-date').val(d.toISOString().slice(0, 10));
        $('#is-analyze').on('click', analyze);
        $('#is-item').on('change', analyze);
        $('#is-ranking-body, #is-elig-body').on('click', 'tr.is-row', function (e) { if (!$(e.target).closest('input, a').length) showWhy($(this).data('id')); });
        $('#is-ranking-body').on('change', '.is-cmp', function () { toggleCompare($(this).val(), this.checked); });
        $('#is-rfq-body').on('change', '.is-rfq-pick', function () { rfqIds = $('.is-rfq-pick:checked').map(function () { return this.value; }).get(); loadRfq(); });
        $('#is-assist-q').on('click', '.is-q', function () { askQuestion($(this).data('q')); });
        $.when($.getJSON('/sourcing/config'), $.getJSON('/sourcing/items')).done(function (a, b) {
            cfg = a[0].data || {}; items = b[0].data || [];
            var mode = (cfg.dataSource || 'demo').toUpperCase();
            $('#is-data').text(mode + ' · RFQ nur Vorschau').attr('data-mode', mode);
            $('#is-f-mode').text(mode);
            var sel = $('#is-item').empty();
            items.forEach(function (i) { sel.append($('<option>').val(i.id).text(i.id + ' · ' + i.title)); });
            if (c.primaryItemId && items.some(function (i) { return i.id === c.primaryItemId; })) sel.val(c.primaryItemId);
            // Deep link from Condition Monitoring: /intelligent-sourcing?item=<id>&asset=<dmsId>&assetName=<text>
            var q = new URLSearchParams(location.search), want = q.get('item'), fromAsset = q.get('asset');
            if (want && items.some(function (i) { return i.id === want; })) sel.val(want);
            if (fromAsset) $('#intelligent-sourcing').prepend('<div class="surface-level-2">Bedarf aus Condition Monitoring · Ersatzteil für Asset <a class="cm-fm-link" href="/condition-monitoring?wsId=904&dmsId=' +
                encodeURIComponent(fromAsset) + '&descriptor=' + encodeURIComponent(q.get('assetName') || '') + '">' + esc(q.get('assetName') || fromAsset) + '</a> · zurück zum Zustand</div>');
            if (q.get('from') === 'package') $('#intelligent-sourcing').prepend('<div class="surface-level-2">Bedarf aus Supplier Package · <a class="cm-fm-link" href="/supplier-package-center">' +
                esc(q.get('fromName') || 'Package') + '</a> · zurück zum Package</div>');
            analyze();
        }).fail(function () { $('#is-hero').html('<div class="cm-events-empty">Konfiguration oder Artikelliste konnte nicht geladen werden.</div>'); });
    });

    // ----- helpers -----
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); }
    function chip(k) { var c = CHIP[k] || CHIP.fm; return '<span class="is-src is-src-' + c.cls + '">' + c.label + '</span>'; }
    function srcKey(v) { return v === 'prototype-local' ? 'proto' : v === 'fusion-manage' ? 'fm' : 'demo'; }
    function lab(st) { return st === 'UNKNOWN' ? 'REVIEW' : st; }
    function badge(st) { return '<span class="is-badge is-' + esc(st) + '">' + lab(st) + '</span>'; }
    function nv(v, unit) { return v == null ? '<span class="is-muted">n/a</span>' : esc(v) + (unit ? ' ' + unit : ''); }
    function money(v) { return v == null ? '<span class="is-muted">n/a</span>' : Number(v).toFixed(2) + ' EUR'; }
    function name(c) { return c.displayName || c.name; }
    // Opens the Fusion Manage record a value was read from (hybrid/fm mode). Demo/prototype values get no link.
    function fmLink(kind, id, html) {
        var r = analysis && analysis.fmLinks && analysis.fmLinks[kind] && analysis.fmLinks[kind][id];
        if (!r || typeof genItemURL !== 'function') return html;
        return '<a class="is-fm" href="' + esc(genItemURL({ wsId: r.workspaceId, dmsId: r.dmsId })) + '" target="_blank" rel="noopener" title="In Fusion Manage öffnen">' + html + '</a>';
    }
    // Purchase history records live in Supplier Packages (WS 147): add a link that opens them in the Package Center.
    function pkgLink(id) {
        var r = analysis && analysis.fmLinks && analysis.fmLinks.purchases && analysis.fmLinks.purchases[id];
        return r && String(r.workspaceId) === '147' ? ' <a class="cm-fm-link" href="/supplier-package-center?package=' + encodeURIComponent(r.dmsId) + '" target="_blank" rel="noopener" title="Im Supplier Package Center öffnen">Package</a>' : '';
    }
    function missLabel(m) { return MISSING_LABEL[m] || m; }
    function priceSrc(v) { return PRICE_SRC[v] || v; }
    function byId(id) { return analysis && analysis.candidates.filter(function (c) { return c.supplierId === id; })[0] || null; }
    function protoFields(c) { return (c.prototypeEvidence || []).map(function (p) { return p.field; }); }
    function usesPrototype(c) { return protoFields(c).length > 0; }
    function missingChecks(c) { return c.technicalChecks.filter(function (t) { return t.status === 'UNKNOWN'; }).map(function (t) { return CHECK_LABEL[t.check] || t.check; }); }
    function qs(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
    function request() { return { itemId: $('#is-item').val(), quantity: $('#is-qty').val(), requiredDate: $('#is-date').val() }; }
    function basisText() {
        var m = cfg && cfg.dataSource;
        if (m === 'hybrid') return 'Die Analyse nutzt ' + chip('fm') + ' + ' + chip('proto') + ' + ' + chip('sim') + ' – Quellen bleiben je Aussage sichtbar.';
        if (m === 'fm') return 'Die Analyse nutzt ausschließlich ' + chip('fm') + '. Keine lokalen Ergänzungen.';
        return 'Die Analyse nutzt lokale ' + chip('demo') + ' – keine Fusion-Manage-Daten.';
    }

    // ----- analysis -----
    function analyze() {
        var r = request(); if (!r.itemId) return;
        $('#is-f-status').text('Analyse läuft …'); aiResult = null; answers = {}; activeQuestion = null;
        $.getJSON('/sourcing/analysis?' + qs(r), function (res) {
            analysis = res.data;
            var s = analysis.summary;
            selectedWhy = analysis.recommendedSupplierId || (analysis.candidates[0] && analysis.candidates[0].supplierId);
            var nonFail = analysis.candidates.filter(function (c) { return c.technicalStatus !== 'FAIL'; });
            rfqIds = nonFail.slice(0, 3).map(function (c) { return c.supplierId; });
            compare = defaultCompare();
            $('#is-f-status').html('<span class="is-st">' + s.passCount + ' PASS · ' + s.unknownCount + ' REVIEW · ' + s.failCount + ' FAIL</span> <span class="is-muted">' + new Date(analysis.request.analyzedAt).toLocaleTimeString() + ' · ' + analysis.candidates.length + ' Lieferanten</span>');
            renderAll();
            if (!QUESTIONS.length) $.getJSON('/sourcing/ai/questions', function (r) { QUESTIONS = r.data || []; renderQuestions(); }); else renderQuestions();
        }).fail(function (xhr) {
            analysis = null;
            $('#is-f-status').text('Analyse fehlgeschlagen: ' + ((xhr.responseJSON && xhr.responseJSON.message) || xhr.status));
        });
    }
    function defaultCompare() {
        var c = analysis.candidates, out = [];
        if (c[0]) out.push(c[0].supplierId);
        var priced = c.filter(function (x) { return x.unitPrice != null && out.indexOf(x.supplierId) < 0; }).sort(function (a, b) { return a.unitPrice - b.unitPrice; });
        if (priced[0]) out.push(priced[0].supplierId);
        var other = c.filter(function (x) { return out.indexOf(x.supplierId) < 0 && x.technicalStatus !== 'FAIL'; })[0];
        if (other && out.length < 3) out.push(other.supplierId);
        return out;
    }
    function renderAll() {
        renderRequest(); renderHero(); renderAlternatives(); renderEligibility(); renderRanking(); renderCompare(); renderWhy(); renderHistory(); loadRfq();
    }

    function renderRequest() {
        var it = analysis.item, r = it.requirements || {};
        $('#is-req-id').html(fmLink('items', it.id, esc(it.id)));
        $('#is-req-rev').html(it.id === (config && config.primaryItemId) && config.primaryRevision ? 'Revision ' + esc(config.primaryRevision) + ' ' + chip('ctx') : '').attr('title', 'Revision aus der Konferenz-Konfiguration (settings). Der Fusion-Manage-Tenant weist nur die Arbeitsrevision aus.');
        $('#is-req-title').text(it.title || '');
        $('#is-f-material').text(r.material || 'n/a');
        $('#is-f-thickness').text(it.thicknessMm == null ? 'n/a' : it.thicknessMm + ' mm');
        $('#is-f-process').text(r.process || 'n/a');
        $('#is-basis').html(basisText());
    }

    // ----- recommendation hero -----
    function renderHero() {
        var rec = byId(analysis.recommendedSupplierId), s = analysis.summary;
        if (!rec) {
            var review = analysis.candidates.filter(function (c) { return c.technicalStatus === 'UNKNOWN'; });
            var missing = {};
            review.forEach(function (c) { missingChecks(c).forEach(function (m) { (missing[m] = missing[m] || []).push(name(c)); }); });
            var rows = Object.keys(missing).map(function (m) { return '<li><strong>' + esc(m) + '</strong> fehlt bei ' + esc(missing[m].join(', ')) + ' ' + chip('fm') + '</li>'; });
            var hybridHint = cfg && cfg.dataSource === 'fm' ? '<div class="is-info"><strong>Hinweis:</strong> Die Hybrid-Analyse kann fehlende Prototyp-Evidenz ergänzen. Der Datenmodus wird serverseitig gesetzt (<code>SOURCING_DATA_SOURCE=hybrid</code>) und hier bewusst nicht automatisch gewechselt.</div>' : '';
            $('#is-hero').html('<div class="is-hero-none"><div class="is-hero-kicker">KEINE EMPFEHLUNG</div>' +
                '<div class="is-hero-title">Keine automatische Empfehlung – technische Kapazitätsdaten fehlen.</div>' +
                '<div class="is-hero-stats">' + stat('Technisch PASS', s.passCount) + stat('REVIEW', s.unknownCount) + stat('FAIL (ausgeschlossen)', s.failCount) + '</div>' +
                '<div class="is-block-title">Was fehlt</div>' + (rows.length ? '<ul>' + rows.join('') + '</ul>' : '<div class="cm-events-empty">Kein Lieferant ist technisch prüfbar.</div>') +
                '<div class="cm-case-note">Das ist ein Ergebnis, kein Fehler: Ohne belegte Kapazität wird kein Lieferant als technisch geeignet empfohlen.</div>' + hybridHint + '</div>');
            return;
        }
        var window_ = analysis.request.availableDays;
        var reasons = rec.technicalChecks.filter(function (t) { return t.status === 'PASS' && t.check !== 'supplierStatus'; }).map(function (t) { return '<li>✓ ' + esc(checkSentence(t)) + ' ' + chip(srcKey(t.source)) + '</li>'; });
        if (rec.leadTimeDays != null && window_ != null && rec.deliveryRisk !== 'LATE') reasons.push('<li>✓ ' + esc('Lieferzeit ' + rec.leadTimeDays + ' Tage innerhalb von ' + window_ + ' Tagen verfügbar') + ' ' + chip(srcKey(rec.leadTimeSource === 'capability' ? analysis.dataSources.capabilities : analysis.dataSources.purchaseHistory)) + '</li>');
        if (rec.purchaseCount + rec.similarPurchaseCount > 0) reasons.push('<li>✓ ' + esc(rec.purchaseCount + ' eigene und ' + rec.similarPurchaseCount + ' vergleichbare Beschaffung(en) vorhanden') + ' ' + chip(rec.purchaseCount ? 'fm' : 'sim') + '</li>');
        var protoNote = usesPrototype(rec) ? '<div class="is-proto-note">PASS basiert teilweise auf ' + chip('proto') + ': ' + esc(rec.prototypeEvidence.map(function (p) { return p.field + ' = ' + p.value; }).join(', ')) + '. Nicht in Fusion Manage hinterlegt.</div>' : '';
        $('#is-hero').html('<div class="is-hero-grid"><div>' +
            '<div class="is-hero-kicker">EMPFEHLUNG</div><div class="is-hero-title">' + fmLink('suppliers', rec.supplierId, esc(name(rec))) + '</div>' +
            '<ul class="is-reasons">' + reasons.join('') + '</ul>' + protoNote + '</div>' +
            '<div class="is-hero-stats">' + stat('Technisch', badge(rec.technicalStatus), true) + stat('Gesamt', rec.overallScore) + stat('Lieferzeit', rec.leadTimeDays == null ? 'n/a' : rec.leadTimeDays + ' Tage') +
            stat('Beschaffungshistorie', rec.purchaseCount + ' eigene · ' + rec.similarPurchaseCount + ' ähnliche') + '</div></div>');
    }
    function stat(label, value, raw) { return '<div class="is-stat"><div class="cm-label">' + esc(label) + '</div><div class="is-stat-v">' + (raw ? value : esc(value)) + '</div></div>'; }
    function checkSentence(t) {
        var a = t.actual == null ? 'n/a' : t.actual;
        if (t.check === 'process') return 'Prozess ' + t.required + ' wird angeboten';
        if (t.check === 'material') return 'Werkstoff ' + t.required + ' wird unterstützt';
        if (t.check === 'maxDimensionMm') return 'Bauteilgröße ' + t.required + ' mm ≤ ' + a + ' mm';
        if (t.check === 'capacity') return 'Kapazität ' + a + ' pro Monat ≥ Menge ' + t.required;
        if (t.check === 'toleranceClass') return 'Toleranzklasse ' + a + ' erfüllt ' + t.required;
        if (t.check === 'certifications') return 'Zertifizierungen vorhanden';
        return t.check + ': ' + t.status;
    }

    // ----- alternatives A-D -----
    function renderAlternatives() {
        var c = analysis.candidates, rec = byId(analysis.recommendedSupplierId), s = analysis.summary;
        var sim = analysis.similarityEvidence, std = analysis.standardAlternatives;
        var others = c.filter(function (x) { return x.supplierId !== analysis.recommendedSupplierId && x.technicalStatus !== 'FAIL'; });
        var A = rec ? { st: 'PASS', why: name(rec) + ': alle technischen Prüfungen bestanden' + (usesPrototype(rec) ? ' (teilweise Prototype-Evidenz)' : ''), src: usesPrototype(rec) ? ['fm', 'proto'] : ['fm'] }
            : s.unknownCount ? { st: 'UNKNOWN', why: s.unknownCount + ' Lieferant(en) technisch prüfbar, Kapazitätsnachweis fehlt', src: ['fm'] }
            : { st: 'FAIL', why: 'Kein Lieferant erfüllt die technischen Anforderungen', src: ['fm'] };
        var B = sim.length ? { st: 'UNKNOWN', why: sim.length + ' ähnliche Artikel bereits beschafft (z. B. ' + (sim[0].similarItemTitle || sim[0].similarItemId) + '). Gleichwertigkeit nicht belegt.', src: ['sim'] }
            : { st: 'UNKNOWN', why: 'Keine Ähnlichkeitsevidenz verfügbar' + (cfg && cfg.dataSource === 'fm' ? ' (Similarity im FM-Modus nicht aktiv)' : ''), src: [] };
        var C = { st: 'UNKNOWN', why: std.length ? std.length + ' Standardprofil(e) bekannt, Eignung nicht belegt' : 'Standardprofil nicht bewertbar', miss: STD_PROFILE_MISSING, src: cfg && cfg.dataSource === 'fm' ? [] : ['proto'] };
        var D = others.length ? { st: others[0].technicalStatus, why: others.slice(0, 3).map(name).join(', ') + (others[0].technicalStatus === 'PASS' ? ': ebenfalls technisch geeignet' : ': Kapazitätsnachweis fehlt'), src: ['fm'] }
            : { st: 'FAIL', why: 'Keine weitere Fertigungsroute / kein weiterer Lieferant technisch geeignet', src: ['fm'] };
        // Slide taxonomy (Engineering Intelligence): A Standardprofil, B ähnliches Teil, C anderer Lieferant, D Biegeteil statt Frästeil.
        // Our deterministic recommendation (new bent part) is option D. Statuses and evidence are unchanged.
        var cards = [['A', 'Standardprofil / U-Profil', C], ['B', 'Vorhandenes ähnliches Teil', B], ['C', 'Alternativer Lieferant', D], ['D', 'Alternative Fertigung / Biegeteil', A]];
        $('#is-alt-body').html(cards.map(function (x) {
            var o = x[2];
            return '<div class="is-alt is-alt-' + o.st + '"><div class="is-alt-head"><span class="is-alt-key">' + x[0] + '</span><span class="is-alt-title">' + esc(x[1]) + '</span>' + badge(o.st) + '</div>' +
                '<div class="is-alt-why">' + esc(o.why) + '</div>' +
                (o.miss ? '<div class="is-alt-miss">Fehlende Evidenz:<ul>' + o.miss.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>' : '') +
                '<div class="is-alt-src">' + o.src.map(chip).join('') + '</div></div>';
        }).join(''));
    }

    // ----- technical eligibility matrix -----
    function mark(t) {
        if (!t) return '<span class="is-muted">–</span>';
        var g = t.status === 'PASS' ? '✓' : t.status === 'FAIL' ? '✗' : '?';
        return '<span class="is-mark is-' + t.status + '" title="' + esc(t.detail + ' (gefordert ' + t.required + ', Ist ' + (t.actual == null ? 'n/a' : t.actual) + ')') + '" aria-label="' + lab(t.status) + '">' + g + '</span>' + (t.source === 'prototype-local' ? '<span class="is-src is-src-proto is-src-mini">Prototype</span>' : '');
    }
    function renderEligibility() {
        var cols = CHECK_ORDER.filter(function (k) { return analysis.candidates.some(function (c) { return c.technicalChecks.some(function (t) { return t.check === k; }); }); });
        function row(c) {
            var f = c.capabilityFacts;
            return '<tr class="is-row is-r-' + c.technicalStatus + '" data-id="' + esc(c.supplierId) + '"><td>' + fmLink('suppliers', c.supplierId, esc(name(c))) + '</td><td>' + badge(c.technicalStatus) + (usesPrototype(c) ? ' <span class="is-src is-src-proto is-src-mini">teilw. Prototype</span>' : '') + '</td>' +
                cols.map(function (k) { return '<td class="is-c">' + mark(c.technicalChecks.filter(function (t) { return t.check === k; })[0]) + '</td>'; }).join('') +
                '<td class="is-c is-info-cell">' + (f && f.maxThicknessMm != null && analysis.item.thicknessMm != null ? esc(analysis.item.thicknessMm) + ' ≤ ' + esc(f.maxThicknessMm) + ' mm' : '–') + '</td><td class="is-c is-info-cell">' + (f && f.tolerance ? esc(f.tolerance) : '–') + '</td></tr>';
        }
        var head = '<thead><tr><th>Lieferant</th><th>Technisch</th>' + cols.map(function (k) { return '<th class="is-c">' + CHECK_LABEL[k] + '</th>'; }).join('') + '<th class="is-c" title="Information aus Fusion Manage, kein Engine-Check">Blechdicke (Info)</th><th class="is-c" title="Information aus Fusion Manage, kein Engine-Check">Toleranz (Info)</th></tr></thead>';
        var live = analysis.candidates.filter(function (c) { return c.technicalStatus !== 'FAIL'; }), failed = analysis.candidates.filter(function (c) { return c.technicalStatus === 'FAIL'; });
        $('#is-elig-body').html('<div class="is-table-wrap"><table class="is-table is-elig">' + head + '<tbody>' + live.map(row).join('') + '</tbody></table></div>' +
            (failed.length ? '<details class="is-fail-list"><summary>' + failed.length + ' technisch ausgeschlossene Lieferanten (FAIL) anzeigen</summary><div class="is-table-wrap"><table class="is-table is-elig">' + head + '<tbody>' + failed.map(row).join('') + '</tbody></table></div></details>' : ''));
    }

    // ----- ranking -----
    function renderRanking() {
        var rec = analysis.recommendedSupplierId;
        var rows = analysis.candidates.map(function (c) {
            var ov, ev = [];
            if (c.technicalStatus === 'FAIL') ov = '<span class="is-excl">ausgeschlossen</span>';
            else if (c.technicalStatus === 'UNKNOWN') ov = c.overallScore == null ? '<span class="is-muted">n/a</span>' : '<span class="is-indic" title="Indikativ: technische Evidenz unvollständig, keine Empfehlung">(' + c.overallScore + ')*</span>';
            else ov = '<strong>' + nv(c.overallScore) + '</strong>';
            if (c.capabilitySource === 'fusion-manage' || c.purchaseCount) ev.push(chip('fm'));
            if (usesPrototype(c)) ev.push(chip('proto'));
            if (c.similarPurchaseCount) ev.push(chip('sim'));
            var miss = c.technicalStatus === 'UNKNOWN' ? missingChecks(c) : c.technicalStatus === 'FAIL' ? c.technicalChecks.filter(function (t) { return t.status === 'FAIL'; }).map(function (t) { return CHECK_LABEL[t.check] || t.check; }) : [];
            var evNote = miss.length ? '<div class="is-ev-note">' + (c.technicalStatus === 'FAIL' ? 'FAIL: ' : 'fehlt: ') + esc(miss.join(', ')) + '</div>' : '';
            var cls = 'is-row is-r-' + c.technicalStatus + (c.supplierId === rec ? ' is-rec' : '') + (c.supplierId === selectedWhy ? ' is-selected' : '');
            return '<tr class="' + cls + '" data-id="' + esc(c.supplierId) + '"><td class="is-c"><input type="checkbox" class="is-cmp" value="' + esc(c.supplierId) + '" title="Für den Lieferantenvergleich auswählen (max. 3) – nicht für den RFQ"' + (compare.indexOf(c.supplierId) >= 0 ? ' checked' : '') + '></td>' +
                '<td>' + fmLink('suppliers', c.supplierId, esc(name(c))) + (c.supplierId === rec ? ' <span class="is-flag">Empfehlung</span>' : '') + (c.conflicts.length ? ' <span class="is-flag warn">Konflikt</span>' : '') + '</td>' +
                '<td>' + badge(c.technicalStatus) + '</td><td class="is-num">' + ov + '</td>' +
                '<td class="is-num">' + money(c.unitPrice) + '</td><td class="is-num">' + nv(c.leadTimeDays, 'd') + '</td>' +
                '<td class="is-num">' + (c.purchaseCount + c.similarPurchaseCount ? c.purchaseCount + ' / ' + c.similarPurchaseCount : '<span class="is-muted">keine</span>') + '</td>' +
                '<td class="is-num">' + nv(c.qualityScore) + '</td><td>' + ev.join('') + evNote + '</td></tr>';
        });
        $('#is-ranking-body').html('<div class="is-table-wrap"><table class="is-table is-rank"><thead><tr><th class="is-c is-cmp-col" title="Für den Lieferantenvergleich auswählen (max. 3) – nicht für den RFQ">Vergleich</th><th>Lieferant</th><th>Technisch</th><th class="is-num">Gesamt</th><th class="is-num">Preis</th><th class="is-num">Lieferzeit</th><th class="is-num" title="eigene / vergleichbare Beschaffungen">Historie</th><th class="is-num">Qualität</th><th>Evidenz</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
            '<div class="cm-case-note">Technisch steht vor Gesamt. FAIL: keine Gesamtbewertung, bleibt einsehbar. * REVIEW: indikativer Wert, keine Empfehlung. Historie = eigene / vergleichbare Beschaffungen. „Vergleich“ wählt nur die Spalten des Lieferantenvergleichs unten, nicht die RFQ-Lieferanten. Zeile anklicken für die Begründung.</div>');
    }

    // ----- comparison -----
    function toggleCompare(id, on) {
        compare = compare.filter(function (x) { return x !== id; });
        if (on) compare.push(id);
        if (compare.length > 3) compare.shift();
        renderRanking(); renderCompare();
    }
    function renderCompare() {
        var cs = compare.map(byId).filter(Boolean), box = $('#is-compare');
        if (cs.length < 2) { box.show().html('<div class="is-cmp-title">Lieferantenvergleich</div><div class="cm-events-empty">2–3 Lieferanten über die Spalte „Vergleich“ im Ranking auswählen.</div>'); return; }
        var it = analysis.item, r = it.requirements || {};
        var priced = analysis.candidates.filter(function (c) { return c.unitPrice != null; }).sort(function (a, b) { return a.unitPrice - b.unitPrice; })[0];
        var banner = '';
        if (priced && priced.technicalStatus !== 'PASS' && compare.indexOf(priced.supplierId) >= 0) banner = '<div class="is-info"><strong>Am günstigsten heißt nicht technisch geeignet:</strong> ' + esc(name(priced)) + ' ist am günstigsten (' + priced.unitPrice.toFixed(2) + ' EUR) – technischer Status ' + lab(priced.technicalStatus) + '.</div>';
        function chk(c, k) { return c.technicalChecks.filter(function (t) { return t.check === k; })[0]; }
        function cell(c, k, txt) { var t = chk(c, k); return mark(t) + ' ' + txt; }
        var G = function (title) { return '<tr class="is-grp"><td colspan="' + (cs.length + 1) + '">' + title + '</td></tr>'; };
        var R = function (label, fn) { return '<tr><th>' + label + '</th>' + cs.map(function (c) { return '<td>' + fn(c) + '</td>'; }).join('') + '</tr>'; };
        var body = G('TECHNISCHE ZULÄSSIGKEIT') +
            R('Technisch', function (c) { return badge(c.technicalStatus); }) +
            R('Werkstoff <span class="is-req">gef. ' + esc(r.material || 'n/a') + '</span>', function (c) { var f = c.capabilityFacts; return cell(c, 'material', f ? esc((f.materials || []).join(', ') || 'n/a') : 'n/a'); }) +
            R('Blechdicke <span class="is-req">gef. ' + (it.thicknessMm == null ? 'n/a' : it.thicknessMm + ' mm') + '</span>', function (c) { var f = c.capabilityFacts; return f && f.maxThicknessMm != null ? 'max ' + esc(f.maxThicknessMm) + ' mm <span class="is-muted">(Info, kein Engine-Check)</span>' : '<span class="is-muted">n/a</span>'; }) +
            R('Prozess <span class="is-req">gef. ' + esc(r.process || 'n/a') + '</span>', function (c) { var f = c.capabilityFacts; return cell(c, 'process', f ? esc((f.processes || []).join(', ') || 'n/a') : 'n/a'); }) +
            R('Toleranz <span class="is-req">gef. ' + esc(it.tolerance || 'n/a') + '</span>', function (c) { var f = c.capabilityFacts; return f && f.tolerance ? esc(f.tolerance) + ' <span class="is-muted">(Info, kein Engine-Check)</span>' : '<span class="is-muted">n/a</span>'; }) +
            R('Größe <span class="is-req">gef. ' + esc(r.maxDimensionMm || 'n/a') + ' mm</span>', function (c) { var f = c.capabilityFacts; return cell(c, 'maxDimensionMm', f && f.maxDimensionMm != null ? 'max ' + esc(f.maxDimensionMm) + ' mm' : 'n/a'); }) +
            R('Kapazität <span class="is-req">gef. ' + esc(analysis.request.quantity) + '</span>', function (c) { var t = chk(c, 'capacity'); return mark(t) + ' ' + (t && t.actual != null ? esc(t.actual) + ' / Monat' : '<span class="is-muted">fehlt</span>'); }) +
            G('KAUFMÄNNISCH') +
            R('Preis', function (c) { return money(c.unitPrice) + (c.priceSource ? ' <span class="is-muted">' + esc(priceSrc(c.priceSource)) + '</span>' : ''); }) +
            R('Lieferzeit', function (c) { return nv(c.leadTimeDays, 'Tage') + (c.deliveryRisk ? ' <span class="is-flag warn">' + esc(c.deliveryRisk) + '</span>' : ''); }) +
            R('Historie', function (c) { return esc(c.purchaseCount) + ' eigene · ' + esc(c.similarPurchaseCount) + ' ähnliche'; }) +
            R('Qualität', function (c) { return nv(c.qualityScore) + (c.qualityTrend ? ' <span class="is-muted">' + esc(c.qualityTrend) + '</span>' : ''); }) +
            R('Gesamt', function (c) { return c.technicalStatus === 'FAIL' ? '<span class="is-excl">ausgeschlossen</span>' : c.technicalStatus === 'UNKNOWN' ? '<span class="is-indic">(' + nv(c.overallScore) + ')* indikativ</span>' : '<strong>' + nv(c.overallScore) + '</strong>'; }) +
            G('EVIDENZ') +
            R('FM-Datensätze', function (c) { return c.capabilitySource === 'fusion-manage' ? chip('fm') + ' ' + esc(c.purchaseCount) + ' Beschaffung(en)' : '<span class="is-muted">keine</span>'; }) +
            R('Prototyp-Evidenz', function (c) { return usesPrototype(c) ? chip('proto') + ' ' + esc(c.prototypeEvidence.map(function (p) { return p.field + ' ' + p.value; }).join(', ')) : '<span class="is-muted">keine</span>'; }) +
            R('Fehlende Evidenz', function (c) { var m = c.technicalStatus === 'FAIL' ? [] : missingChecks(c).concat(c.missingData.filter(function (x) { return x !== 'qualityHistory'; }).map(missLabel)); return m.length ? esc(m.join(', ')) : '<span class="is-muted">keine</span>'; });
        box.show().html('<div class="is-cmp-title">Lieferantenvergleich</div>' + banner + '<div class="is-table-wrap"><table class="is-table is-cmp-table"><thead><tr><th></th>' + cs.map(function (c) { return '<th>' + fmLink('suppliers', c.supplierId, esc(name(c))) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>');
    }

    // ----- why this recommendation -----
    function list(items) { return items.length ? '<ul>' + items.join('') + '</ul>' : '<div class="cm-events-empty">keine</div>'; }
    function renderWhy() {
        var c = byId(selectedWhy); if (!c) { $('#is-why-body').html('<div class="cm-events-empty">Keine Lieferanten.</div>'); return; }
        $('#is-ranking-body tr').removeClass('is-selected').filter(function () { return $(this).data('id') === c.supplierId; }).addClass('is-selected');
        var facts = c.technicalChecks.filter(function (t) { return t.check !== 'supplierStatus' && t.status !== 'UNKNOWN'; }).map(function (t) { return '<li>' + esc((CHECK_LABEL[t.check] || t.check) + ': ' + t.status + ' – ' + t.detail + ' (gefordert ' + t.required + ', Ist ' + (t.actual == null ? 'n/a' : t.actual) + ')') + ' ' + chip(srcKey(t.source)) + '</li>'; });
        if (c.purchaseCount) facts.push('<li>' + esc(c.purchaseCount + ' eigene Beschaffung(en)' + (c.onTimeRate != null ? ', Termintreue ' + Math.round(c.onTimeRate * 100) + ' %' : '')) + ' ' + chip('fm') + '</li>');
        if (c.similarPurchaseCount) facts.push('<li>' + esc(c.similarPurchaseCount + ' vergleichbare Beschaffung(en) ähnlicher Artikel') + ' ' + chip('sim') + '</li>');
        if (c.leadTimeDays != null) facts.push('<li>' + esc('Lieferzeit ' + c.leadTimeDays + ' Tage') + ' ' + chip(srcKey(analysis.dataSources.capabilities)) + '</li>');
        if (c.unitPrice != null) facts.push('<li>' + esc('Preis ' + c.unitPrice.toFixed(2) + ' EUR (' + priceSrc(c.priceSource) + ')') + ' ' + chip(srcKey(analysis.dataSources.capabilities)) + '</li>');
        var w = { commercial: 35, delivery: 30, quality: 20, history: 15 };
        var calc = [['Technisch', lab(c.technicalStatus) + ' (maßgeblich)'], ['Kaufmännisch', c.commercialScore, w.commercial], ['Lieferzeit', c.deliveryScore, w.delivery], ['Qualität', c.qualityScore, w.quality], ['Historie', c.historyScore, w.history],
            ['Gesamt', c.technicalStatus === 'FAIL' ? 'ausgeschlossen' : c.overallScore == null ? null : c.overallScore + (c.technicalStatus === 'UNKNOWN' ? ' (indikativ)' : '') + ' · Datenabdeckung ' + Math.round(c.dataCompleteness * 100) + ' %']];
        var calcHtml = calc.map(function (x) { return '<div class="cm-case-row"><span>' + esc(x[0]) + (x[2] ? ' <span class="is-muted">Gewicht ' + x[2] + ' %</span>' : '') + '</span><strong>' + (x[1] == null ? 'n/a (nicht gewertet)' : esc(x[1])) + '</strong></div>'; }).join('');
        var miss = missingChecks(c).map(function (m) { return '<li>' + esc(m + ': technische Evidenz fehlt') + '</li>'; })
            .concat(c.missingData.map(function (m) { return '<li>' + esc(missLabel(m)) + '</li>'; })).concat(c.conflicts.map(function (x) { return '<li>' + esc(x.type + ': ' + x.detail) + '</li>'; }));
        var protoBanner = usesPrototype(c) ? '<div class="is-proto-note">Der technische PASS basiert teilweise auf ' + chip('proto') + ' (' + esc(protoFields(c).join(', ')) + '). ' + esc(c.prototypeEvidence[0].note || '') + '</div>' : '';
        $('#is-why-body').html('<div class="is-why-head"><strong>' + fmLink('suppliers', c.supplierId, esc(name(c))) + '</strong> ' + badge(c.technicalStatus) + (c.supplierId === analysis.recommendedSupplierId ? ' <span class="is-flag">Empfehlung der Engine</span>' : '') + '</div>' + protoBanner +
            '<div class="is-cols">' +
            '<div class="is-block"><div class="is-block-title">Geprüfte Fakten</div>' + list(facts) + '</div>' +
            '<div class="is-block"><div class="is-block-title">Berechnetes Ergebnis</div>' + calcHtml + '</div>' +
            '<div class="is-block is-block-ai"><div class="is-block-title">AI Interpretation</div><div id="is-ai-box">' + aiHtml() + '</div></div>' +
            '<div class="is-block"><div class="is-block-title">Fehlende Evidenz</div>' + list(miss) + '</div></div>');
    }
    // ----- Assistant: FIXED questions (no free text). Answers: Empfehlung / Belege / QUELLEN / Offen. -----
    var QUESTIONS = [];            // /sourcing/ai/questions
    var answers = {};              // questionId -> rendered answer html (per analysis)
    var activeQuestion = null;
    function aiHtml() {
        if (activeQuestion && answers[activeQuestion]) return answers[activeQuestion];
        if (cfg && !cfg.aiEnabled) return '<div class="cm-events-empty">Der Assistent ist auf diesem Server deaktiviert. Geprüfte Fakten, Berechnetes Ergebnis und Fehlende Evidenz stehen für sich.</div>';
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
    function showWhy(id) { selectedWhy = id; renderWhy(); }

    // ----- history -----
    function renderHistory() {
        var nameOf = function (sid) { var c = byId(sid); return c ? name(c) : sid; };
        var leadOf = function (sid) { var c = byId(sid); return c && c.leadTimeDays != null ? c.leadTimeDays + (c.leadTimeDays === 1 ? ' Tag' : ' Tage') : 'n/a'; };
        var rows = analysis.similarityEvidence.map(function (s) {
            return '<tr><td>' + fmLink('items', s.similarItemId, esc(s.similarItemTitle || s.similarItemId)) + ' <span class="is-muted">' + esc(s.similarItemId) + '</span></td><td>' + fmLink('suppliers', s.historicalSupplier, esc(nameOf(s.historicalSupplier))) + '</td><td class="is-num">' + nv(s.historicalQuantity, 'Stk') + '</td><td class="is-num">' + money(s.historicalPrice) + '</td><td class="is-num">' + esc(leadOf(s.historicalSupplier)) + '</td><td>' + esc(s.historicalDate || 'n/a') + '</td><td>' + chip('fm') + chip('sim') + '</td></tr>';
        });
        analysis.candidates.forEach(function (c) { c.evidence.purchases.forEach(function (p) {
            rows.unshift('<tr><td>' + fmLink('items', analysis.item.id, esc(analysis.item.title)) + ' <span class="is-muted">' + esc(analysis.item.id) + '</span></td><td>' + fmLink('suppliers', c.supplierId, esc(name(c))) + '</td><td class="is-num">' + nv(p.quantity, 'Stk') + '</td><td class="is-num">' + money(p.unitPrice) + '</td><td class="is-num">' + esc(leadOf(c.supplierId)) + '</td><td>' + fmLink('purchases', p.id, esc(p.date || 'n/a')) + pkgLink(p.id) + '</td><td>' + chip(srcKey(analysis.dataSources.purchaseHistory)) + '</td></tr>'); }); });
        var std = analysis.standardAlternatives.map(function (a) { return '<li>' + esc(a.itemId + ' · ' + a.title + (a.lastSupplierId ? ' · zuletzt von ' + a.lastSupplierId + ' @ ' + a.lastUnitPrice + ' (' + a.lastDate + ')' : ' · keine Beschaffung')) + '</li>'; });
        $('#is-history-body').html(rows.length ? '<div class="is-table-wrap"><table class="is-table"><thead><tr><th>Teil</th><th>Lieferant</th><th class="is-num">Menge</th><th class="is-num">Stückpreis</th><th class="is-num">Lieferzeit Lieferant</th><th>Datum</th><th>Quelle</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
            '<div class="cm-case-note">Beschaffungssätze: ' + chip('fm') + '. Unterstrichene Einträge (↗) öffnen den Datensatz in Fusion Manage. Die Beziehung „ähnlicher Artikel“ stammt aus dem ' + chip('sim') + ' (gleiche Familie, Score 0.8) und ändert keinen technischen Status.</div>'
            : '<div class="cm-events-empty">Keine Beschaffungshistorie ähnlicher Artikel' + (cfg && cfg.dataSource === 'fm' ? ' – Similarity ist im reinen FM-Modus nicht aktiv.' : '.') + '</div>');
        if (std.length) $('#is-history-body').append('<div class="is-block-title" style="margin-top:12px">Standardprofil-Alternativen</div>' + list(std));
    }

    // ----- RFQ preview (never written) -----
    function loadRfq() {
        var cands = analysis.candidates.filter(function (c) { return c.technicalStatus !== 'FAIL'; });
        if (!cands.length) { $('#is-rfq-body').html(rfqFrame('<div class="cm-events-empty">Keine technisch zulässigen oder prüfbaren Lieferanten für einen RFQ-Entwurf.</div>')); return; }
        var picks = '<div class="is-rfq-picks"><span class="is-rfq-picks-label">Lieferanten für den RFQ-Entwurf:</span>' + cands.map(function (c) { return '<label><input type="checkbox" class="is-rfq-pick" value="' + esc(c.supplierId) + '"' + (rfqIds.indexOf(c.supplierId) >= 0 ? ' checked' : '') + '> ' + esc(name(c)) + ' ' + badge(c.technicalStatus) + '</label>'; }).join('') + '</div>';
        if (!rfqIds.length) { $('#is-rfq-body').html(rfqFrame(picks + '<div class="cm-events-empty">Mindestens einen Lieferanten wählen.</div>')); return; }
        $.getJSON('/sourcing/rfq/preview?' + qs(request()) + '&supplierIds=' + encodeURIComponent(rfqIds.join(','))).done(function (res) {
            var d = res.data.draft;
            var sup = d.suppliers.map(function (s) {
                var c = byId(s.supplierId) || {};
                var evid = usesPrototype(c) ? 'PASS teilweise auf ' + 'Prototype / Local' + '-Evidenz' : c.technicalStatus === 'UNKNOWN' ? 'REVIEW – ' + missingChecks(c).join(', ') + ' fehlt' : 'PASS – Fusion Manage';
                return '<tr><td>' + fmLink('suppliers', s.supplierId, esc(c.displayName || s.name)) + '</td><td>' + badge(s.technicalStatus) + '</td><td class="is-num">' + (s.technicalStatus === 'PASS' ? nv(s.overallScore) : '<span class="is-indic">(' + nv(s.overallScore) + ')*</span>') + '</td><td>' + esc(evid) + '</td></tr>';
            }).join('');
            $('#is-rfq-body').html(rfqFrame(picks +
                '<div class="is-rfq-grid"><div class="cm-case-row"><span>Artikel</span><strong>' + esc(d.item.id + ' · ' + d.item.title) + '</strong></div><div class="cm-case-row"><span>Menge</span><strong>' + esc(d.quantity) + '</strong></div><div class="cm-case-row"><span>Bedarfstermin</span><strong>' + esc(d.requiredDate || 'n/a') + '</strong></div></div>' +
                '<div class="is-table-wrap"><table class="is-table"><thead><tr><th>Vorgeschlagener Lieferant</th><th>Technisch</th><th class="is-num">Gesamt</th><th>Evidenzstatus</th></tr></thead><tbody>' + sup + '</tbody></table></div>' +
                '<div class="cm-case-note">Nur Vorschau: Es wird nichts in Fusion Manage geschrieben. Es ist kein Schreibziel konfiguriert. Vorschlag-ID: ' + esc(d.rfqKey) + '</div>'));
        }).fail(function (xhr) { $('#is-rfq-body').html(rfqFrame(picks + '<div class="cm-events-empty">Vorschau fehlgeschlagen: ' + esc((xhr.responseJSON && xhr.responseJSON.message) || xhr.status) + '</div>')); });
    }
    function rfqFrame(inner) { return '<div class="is-rfq-head"><span class="is-preview">PREVIEW</span><span class="is-muted">RFQ-Entwurf, nicht erstellt</span></div>' + inner; }

})();
