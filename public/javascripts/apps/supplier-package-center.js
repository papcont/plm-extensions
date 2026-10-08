let allPackages = [];
let selectedPackageLink = null;
let currentSharedItems = [];
let bulkExportViews = [];
let sourcingItems = null;   // /sourcing/items, loaded once; [] when Intelligent Sourcing is unavailable

$(document).ready(function() {
    appendOverlay();
    insertMenu();
    setUIEvents();
    loadPackages();
});

function setUIEvents() {
    window.addEventListener('message', onSourcingMessage);
    $('#apply-supplier').change(renderApplyPreview);
    $('#apply-confirm').change(updateApplyButton);
    $('#apply-package').click(applyToPackage);
    $('#refresh').click(loadPackages);
    $('#package-search').on('input', debounce(renderPackageTable, 200));
    bindItemPicker('#item-query', '#item-pick', function(match, label, count) { showItemSourcing(match, label, count); });
    bindItemPicker('#pkg-item-query', '#pkg-item-pick', function(match, label, count) { renderSourcing(match, label, count); });
    $('#filter-type, #filter-status, #filter-supplier, #filter-has-items').change(renderPackageTable);
    $('#close-package-detail').click(function() {
        $('#package-detail-panel').addClass('hidden').removeClass('item-mode');
        $('body').removeClass('with-package-detail');
        $('.package-row').removeClass('selected');
        selectedPackageLink = null;
        currentSharedItems = [];
        $('#bulk-export-panel').addClass('hidden');
        $('#item-viewer-panel').addClass('hidden');
    });
    $('#new-package').click(openCreatePackage);
    $('#back-to-package').click(closeExport);
    $('#export-all-excel').click(exportAllExcel);
    $('#attach-all-excel').click(attachAllExcel);
    $('#export-all-zip').click(exportAllZip);
}

function openCreatePackage() {
    const wsId = getPackagesWorkspaceId();
    if(isBlank(wsId)) return;

    insertCreate([], [wsId], {
        id            : 'create-package',
        headerLabel   : 'Create New Supplier Package',
        afterCreation : function(id, link) {
            $('#overlay').hide();
            loadPackages();
        }
    });
}

function openExport(link) {
    $('#export-frame').attr('src', '/bom-export-attachment-studio?link=' + encodeURIComponent(link) + '&embedded=true');
    $('#workspace').addClass('hidden');
    $('#export-view').removeClass('hidden');
}

function closeExport() {
    $('#export-view').addClass('hidden');
    $('#workspace').removeClass('hidden');
    $('#export-frame').attr('src', '');
}

function debounce(fn, delay) {
    let timer = null;
    return function() {
        clearTimeout(timer);
        const args = arguments;
        const context = this;
        timer = setTimeout(function() { fn.apply(context, args); }, delay);
    };
}

function getPackagesWorkspaceId() {
    return config.workspaceId || common.workspaceIds.supplierPackages;
}

function loadPackages() {
    const wsId = getPackagesWorkspaceId();
    if(isBlank(wsId)) return;

    $('#overlay').show();

    $.post('/plm/search', {
        wsId     : wsId,
        filter   : [],
        fields   : config.listFields || ['NUMBER', 'TYPE', 'WORKFLOW_STATUS', 'SUPPLIER'],
        pageSize : 500
    }, function(response) {
        $('#overlay').hide();

        const rows = (response.data && Array.isArray(response.data.row)) ? response.data.row : [];

        allPackages = rows.map(function(row) {
            return {
                dmsId      : row.dmsId,
                link       : '/api/v3/workspaces/' + wsId + '/items/' + row.dmsId,
                descriptor : getFieldText(row, 'DESCRIPTOR'),
                number     : getFieldText(row, 'NUMBER'),
                type       : getFieldText(row, 'TYPE'),
                status     : getFieldText(row, 'WORKFLOW_STATUS'),
                supplier   : getFieldText(row, 'SUPPLIER'),
                itemCount  : null
            };
        });

        populateFilterOptions();
        renderSummary();
        renderPackageTable();
        loadItemCounts();
        openPackageFromUrl();
    });
}

let packageFromUrlOpened = false;
function openPackageFromUrl() {
    if(packageFromUrlOpened) return;
    packageFromUrlOpened = true;

    const dmsId = new URLSearchParams(window.location.search).get('package');
    const pkg   = allPackages.find(function(p) { return String(p.dmsId) === String(dmsId); });
    if(!pkg) return;

    selectPackage(pkg.link);
    const elemRow = $('.package-row[data-link="' + pkg.link + '"]');
    if(elemRow.length) elemRow[0].scrollIntoView({ block : 'center' });
}

function loadItemCounts() {
    const concurrency = 3;   // browsers allow ~6 connections per host: keep some free for the user's own clicks and the embedded Sourcing
    let nextIndex = 0;
    let pending = allPackages.length;

    function runNext() {
        if(nextIndex >= allPackages.length) return;
        const pkg = allPackages[nextIndex++];

        $.get('/plm/details', { link : pkg.link, useCache : true }, function(response) {
            const section = ((response.data && response.data.sections) || []).find(function(s) {
                return (s.fields || []).some(function(f) { return f.title === 'Shared Items'; });
            });
            const field = section ? section.fields.find(function(f) { return f.title === 'Shared Items'; }) : null;
            const entries = (field && Array.isArray(field.value)) ? field.value : (field && field.value ? [field.value] : []);

            pkg.itemCount = entries.length;
            updateItemCountCell(pkg);
        }).always(function() {
            pending--;
            if(pending === 0 && $('#filter-has-items').prop('checked')) renderPackageTable();
            if(pending === 0) loadItemChoices();   // the 500-item list is loaded once the counting is done (or earlier, when a picker is used)
            runNext();
        });
    }

    for(let i = 0; i < concurrency; i++) runNext();
}

function updateItemCountCell(pkg) {
    const elemCell = $('.package-row[data-link="' + pkg.link + '"] .items-count');
    if(elemCell.length === 0) return;

    elemCell.html(pkg.itemCount).toggleClass('has-items', pkg.itemCount > 0);
}

function getFieldText(row, fieldId) {
    if(!row.data || !row.data[fieldId]) return '';
    return row.data[fieldId].displayValue || row.data[fieldId].value || '';
}

function populateFilterOptions() {
    fillSelect('#filter-type', uniqueSorted(allPackages.map(function(p) { return p.type; })));
    fillSelect('#filter-status', uniqueSorted(allPackages.map(function(p) { return p.status; })));
    fillSelect('#filter-supplier', uniqueSorted(allPackages.map(function(p) { return p.supplier; })));
}

function uniqueSorted(values) {
    return [...new Set(values.filter(function(v) { return !isBlank(v); }))].sort();
}

function fillSelect(selector, values) {
    const elem = $(selector);
    const current = elem.val();
    elem.find('option:not(:first)').remove();
    for(const value of values) {
        $('<option></option>').appendTo(elem).attr('value', value).html(value);
    }
    if(values.includes(current)) elem.val(current);
}

function renderSummary() {
    $('#total-count').html(allPackages.length);

    const counts = {};
    for(const pkg of allPackages) {
        const status = pkg.status || 'Unknown';
        counts[status] = (counts[status] || 0) + 1;
    }

    const elemBreakdown = $('#status-breakdown').html('');
    for(const status of Object.keys(counts).sort()) {
        $('<div></div>').appendTo(elemBreakdown).addClass('status-chip')
            .html('<span class="status-chip-label">' + status + '</span><span class="status-chip-count">' + counts[status] + '</span>');
    }
}

function renderPackageTable() {
    const query = $('#package-search').val().trim().toLowerCase();
    const type = $('#filter-type').val();
    const status = $('#filter-status').val();
    const supplier = $('#filter-supplier').val();
    const hasItemsOnly = $('#filter-has-items').prop('checked');

    const filtered = allPackages.filter(function(pkg) {
        if(type && pkg.type !== type) return false;
        if(status && pkg.status !== status) return false;
        if(supplier && pkg.supplier !== supplier) return false;
        if(hasItemsOnly && !(pkg.itemCount > 0)) return false;
        if(query) {
            const haystack = (pkg.number + ' ' + pkg.descriptor + ' ' + pkg.type).toLowerCase();
            if(haystack.indexOf(query) === -1) return false;
        }
        return true;
    });

    $('#shown-count').html(filtered.length);

    const body = $('#package-table-body').html('');

    if(filtered.length === 0) {
        $('<tr><td></td></tr>').appendTo(body).find('td').attr('colspan', 6).html('No packages match this filter.');
        return;
    }

    for(const pkg of filtered) {
        const row = $('<tr></tr>').appendTo(body).addClass('package-row').attr('data-link', pkg.link);
        if(pkg.link === selectedPackageLink) row.addClass('selected');
        $('<td></td>').appendTo(row).html(pkg.number);
        $('<td></td>').appendTo(row).html(pkg.type ? '<span class="type-badge">' + pkg.type + '</span>' : '');
        $('<td></td>').appendTo(row).html(pkg.status);
        $('<td></td>').appendTo(row).html(pkg.supplier);
        $('<td></td>').appendTo(row).addClass('items-count').toggleClass('has-items', pkg.itemCount > 0).html(pkg.itemCount === null ? '…' : pkg.itemCount);
        $('<td></td>').appendTo(row).addClass('descriptor').html(pkg.descriptor);
        row.click(function() { selectPackage($(this).attr('data-link')); });
    }
}

function selectPackage(link) {
    selectedPackageLink = link;
    $('.package-row').removeClass('selected');
    $('.package-row[data-link="' + link + '"]').addClass('selected');

    $('#package-detail-title').html('Package details');
    $('#package-detail-panel').removeClass('hidden').removeClass('item-mode');
    $('body').addClass('with-package-detail');
    $('#shared-items-list').html('<div class="empty-note">Loading...</div>');
    resetSourcingPanel();

    insertDetails(link, { useCache : true, toggles : true, id : 'package-details', editable : false, openInPLM : true }, {});
    insertAttachments(link, { editable : false, includeRelatedFiles : true, includeVaultFiles : true }, {});
    insertWorkflowActions(link, { onComplete : function() { loadPackages(); selectPackage(link); } });

    $.get('/plm/details', { link : link, useCache : true }, function(response) {
        renderSharedItems(response.data || {});
        renderSourcingPanel(response.data || {});
    });
}

function renderSharedItems(data) {
    const section = (data.sections || []).find(function(s) {
        return (s.fields || []).some(function(f) { return f.title === 'Shared Items'; });
    });
    const field = section ? section.fields.find(function(f) { return f.title === 'Shared Items'; }) : null;
    const entries = (field && Array.isArray(field.value)) ? field.value : (field && field.value ? [field.value] : []);

    currentSharedItems = entries.filter(function(entry) { return entry && entry.link && entry.title; });

    const elemList = $('#shared-items-list').html('');

    if(currentSharedItems.length === 0) {
        $('<div></div>').appendTo(elemList).addClass('empty-note').html('No shared items on this package.');
        $('#bulk-export-panel').addClass('hidden');
        return;
    }

    for(const entry of currentSharedItems) {
        const elemItem = $('<div></div>').appendTo(elemList).addClass('shared-item');
        $('<span></span>').appendTo(elemItem).addClass('shared-item-title').html(entry.title)
            .click(function() { previewItem(entry.link); });
        $('<div></div>').appendTo(elemItem).addClass('button with-icon icon-download').html('Export')
            .click(function() { openExport(entry.link); });
        addSourcingButton(elemItem, entry);
    }

    $('#bulk-export-panel').removeClass('hidden');
    loadBulkExportViews();
}

// Hand a shared item to Intelligent Sourcing when it knows the part (matched by title, "<number> - <title>").
function addSourcingButton(elemItem, entry) {

    let title = String(entry.title).replace(/^.+? - /, '').toLowerCase();

    let find = function(items) {
        let match = items.filter(function(i) { return String(i.title).toLowerCase() === title; })[0];
        if(!match) return;
        // Compact Intelligent Sourcing inline (request, recommendation, alternatives); its own link opens the full page.
        let elemButton = $('<div></div>').appendTo(elemItem).addClass('button').html('Sourcing').attr('title', 'Show suppliers and alternatives for this part');
        elemButton.click(function() {
            let elemEmbed = elemItem.children('.shared-item-embed');
            if(elemEmbed.length === 0) {
                elemEmbed = $('<div></div>').appendTo(elemItem).addClass('shared-item-embed');
                $('<iframe></iframe>').appendTo(elemEmbed).attr('title', 'Intelligent Sourcing').attr('src', '/intelligent-sourcing?item=' + encodeURIComponent(match.id) + '&embedded=compact');
                return;
            }
            elemEmbed.toggleClass('hidden');
        });
    };

    loadSourcingItems(find);

}

// Item picker (Items workspace): a single-select dropdown that is filled right away - parts Intelligent Sourcing can analyse
// first, then the first 500 items of the Items workspace. The input above it narrows the list by a live workspace search
// (number or title, 2+ characters) for everything else. Used twice: in the filter column (item first, no package needed)
// and inside the package's Sourcing panel.
const itemPickers = [];       // { input, pick } selector pairs
let itemChoices   = null;     // first 500 items of the Items workspace: { value, label }[], null until loaded
let itemTotal     = 0;
let itemChoicesRequested = false;

function loadItemChoices() {
    if(itemChoicesRequested) return;
    itemChoicesRequested = true;

    $.post('/plm/search', {
        wsId     : common.workspaceIds.items,
        filter   : [],
        fields   : ['NUMBER', 'TITLE'],
        sort     : ['NUMBER'],
        pageSize : 500
    }, function(response) {
        const rows = (response.data && Array.isArray(response.data.row)) ? response.data.row : [];
        itemTotal = Number(response.data && response.data.totalResultCount) || rows.length;
        itemChoices = uniqueItemOptions(rows);
    }).fail(function() {
        itemChoices = [];
    }).always(refreshIdleItemPickers);
}

function uniqueItemOptions(rows) {
    const seen = {};   // the search returns one row per revision
    const options = [];
    for(const row of rows) {
        const number = getFieldText(row, 'NUMBER'), title = getFieldText(row, 'TITLE');
        if(seen[number + '|' + title]) continue;
        seen[number + '|' + title] = true;
        options.push({ value : JSON.stringify({ number : number, title : title }), label : getFieldText(row, 'DESCRIPTOR') || (number + ' - ' + title) });
    }
    return options;
}

function refreshIdleItemPickers() {
    for(const picker of itemPickers) {
        if($(picker.input).val().trim().length < 2) renderItemOptions($(picker.pick));
    }
}

function renderItemOptions(elemPick) {
    elemPick.html('');
    $('<option></option>').appendTo(elemPick).attr('value', '').text('Choose an item...');

    loadSourcingItems(function(known) {
        if(known.length) {
            const group = $('<optgroup></optgroup>').appendTo(elemPick).attr('label', 'With Sourcing data (' + known.length + ')');
            for(const item of known) {
                $('<option></option>').appendTo(group).attr('value', JSON.stringify({ number : item.id, title : item.title })).text(item.id + ' - ' + item.title);
            }
        }

        const group = $('<optgroup></optgroup>').appendTo(elemPick);
        if(itemChoices === null) {
            group.attr('label', 'Items workspace');
            $('<option disabled></option>').appendTo(group).text('Loading items...');
        } else {
            group.attr('label', 'Items workspace (' + itemChoices.length + (itemTotal > itemChoices.length ? ' of ' + itemTotal + ' - type to search the rest' : '') + ')');
            for(const option of itemChoices) $('<option></option>').appendTo(group).attr('value', option.value).text(option.label);
        }
    });
}

function bindItemPicker(inputSelector, pickSelector, onPick) {

    let token = 0;
    itemPickers.push({ input : inputSelector, pick : pickSelector });
    $(inputSelector + ', ' + pickSelector).on('focus mousedown', loadItemChoices);   // loads only once
    renderItemOptions($(pickSelector));

    $(inputSelector).on('input', debounce(function() {
        const query = $(inputSelector).val().trim();
        const elemPick = $(pickSelector);

        if(query.length < 2) {
            ++token;
            renderItemOptions(elemPick);
            return;
        }

        const current = ++token;
        elemPick.html('<option value="">Searching...</option>');

        $.post('/plm/search', {
            wsId              : common.workspaceIds.items,
            filter            : [
                { field : 'NUMBER', type : '0', comparator : 'contains', value : query },
                { field : 'TITLE' , type : '0', comparator : 'contains', value : query }
            ],
            searchLogicClause : 'OR',
            fields            : ['NUMBER', 'TITLE'],
            pageSize          : 30
        }, function(response) {
            if(current !== token) return;   // a newer search is already running

            const rows    = (response.data && Array.isArray(response.data.row)) ? response.data.row : [];
            const options = uniqueItemOptions(rows);
            elemPick.html('');
            $('<option></option>').appendTo(elemPick).attr('value', '').text(options.length ? options.length + ' items found - choose one' : 'No items found');
            for(const option of options) $('<option></option>').appendTo(elemPick).attr('value', option.value).text(option.label);
        }).fail(function() {
            if(current === token) $(pickSelector).html('<option value="">Item search failed</option>');
        });
    }, 350));

    $(pickSelector).change(function() {
        const value = $(pickSelector).val();
        if(isBlank(value)) return;

        const item  = JSON.parse(value);
        const label = $(pickSelector + ' option:selected').text();

        loadSourcingItems(function(items) {
            const title = String(item.title).toLowerCase();
            const match = items.filter(function(i) { return i.id === item.number || String(i.title).toLowerCase() === title; })[0];
            onPick(match, label, items.length);
        });
    });

}

// ---- Fill the selected package from the Sourcing analysis: supplier + the part to order (Shared Items) ---------------------
// The embedded Sourcing reports which request it analysed (parameters only). The analysis itself is read from
// /sourcing/analysis here, so nothing in the message is trusted. A technically failed supplier is never offered.
let sourcingRequest = null;   // { itemId, quantity, requiredDate }
let applyContext    = null;   // { link, analysis, itemLink, itemTitle, details }

function onSourcingMessage(event) {
    const frame = $('#sourcing-frame-wrap iframe')[0];
    if(event.origin !== window.location.origin || !frame || event.source !== frame.contentWindow) return;
    if(!event.data || event.data.type !== 'sourcing-analysis' || !event.data.request) return;

    sourcingRequest = event.data.request;
    prepareApply();
}

function hideApply() {
    applyContext = null;
    $('#sourcing-apply').addClass('hidden');
    $('#apply-confirm').prop('checked', false);
    $('#apply-status').html('');
}

function getDetailsField(details, fieldId) {
    for(const section of (details.sections || [])) {
        for(const field of (section.fields || [])) {
            if((field.__self__ || '').endsWith('/fields/' + fieldId)) return { field : field, sectionId : String(section.link || '').split('/').pop(), locked : !!section.sectionLocked };
        }
    }
    return null;
}

function prepareApply() {
    hideApply();
    const link = selectedPackageLink;
    if(!link || !sourcingRequest || $('#package-detail-panel').hasClass('item-mode')) return;

    $.when($.getJSON('/sourcing/analysis', sourcingRequest), $.get('/plm/details', { link : link, useCache : false })).done(function(analysisResponse, detailsResponse) {
        if(link !== selectedPackageLink) return;

        const analysis = analysisResponse[0].data || {};
        const details  = (detailsResponse[0] && detailsResponse[0].data) || {};
        const links    = analysis.fmLinks || {};
        const itemRef  = links.items && links.items[analysis.item && analysis.item.id];
        const suppliers = (analysis.candidates || []).filter(function(c) {
            return c.technicalStatus !== 'FAIL' && links.suppliers && links.suppliers[c.supplierId];
        });

        const elemSupplier = $('#apply-supplier').html('');
        for(const c of suppliers) {
            $('<option></option>').appendTo(elemSupplier).attr('value', c.supplierId)
                .text((c.displayName || c.name) + ' - ' + (c.technicalStatus === 'UNKNOWN' ? 'REVIEW' : c.technicalStatus) + (c.overallScore != null ? ', score ' + c.overallScore : '') + (c.supplierId === analysis.recommendedSupplierId ? ' (recommended)' : ''));
        }
        if(analysis.recommendedSupplierId) elemSupplier.val(analysis.recommendedSupplierId);

        applyContext = { link : link, analysis : analysis, details : details, suppliers : suppliers, itemTitle : analysis.item && analysis.item.title,
            itemLink : itemRef ? '/api/v3/workspaces/' + itemRef.workspaceId + '/items/' + itemRef.dmsId : null };

        $('#sourcing-apply').removeClass('hidden');
        renderApplyPreview();
    });
}

function renderApplyPreview() {
    if(!applyContext) return;

    const ctx         = applyContext;
    const elemPreview = $('#apply-preview').html('');
    const supplier    = ctx.suppliers.filter(function(c) { return c.supplierId === $('#apply-supplier').val(); })[0];
    const current     = getDetailsField(ctx.details, 'SUPPLIER');
    const notes       = getDetailsField(ctx.details, 'NOTES');
    const currentName = (current && current.field.value && current.field.value.title) || 'none';

    ctx.problem = null;
    if(!supplier)           ctx.problem = 'No supplier without a technical failure is available for this part.';
    else if(!current || !notes) ctx.problem = 'This package has no Supplier / Notes field.';
    else if(current.locked || notes.locked) ctx.problem = 'The header of this package is locked (checked out or locked by its workflow state) - Fusion Manage would reject the change.';

    if(ctx.problem) {
        $('<div></div>').appendTo(elemPreview).addClass('empty-note').text(ctx.problem);
    } else {
        const supplierName = supplier.displayName || supplier.name;
        const request = sourcingRequest || {};
        const line = 'Intelligent Sourcing: ' + ctx.itemTitle + (request.quantity ? ', quantity ' + request.quantity : '') + (request.requiredDate ? ', required by ' + request.requiredDate : '') + ' - supplier ' + supplierName;
        const supplierRef = ctx.analysis.fmLinks.suppliers[supplier.supplierId];
        $('<div></div>').appendTo(elemPreview).addClass('apply-line').append($('<span></span>').text('Supplier: ' + currentName + ' \u2192 '), $('<strong></strong>').text(supplierName));
        $('<div></div>').appendTo(elemPreview).addClass('apply-line').append($('<span></span>').text('Notes: add "'), $('<strong></strong>').text(line), $('<span></span>').text('"'));
        // ponytail: Fusion Manage silently ignores edits of Shared Items on an existing package (204, value unchanged), so the part goes into Notes.
        if(supplier.technicalStatus === 'UNKNOWN') $('<div></div>').appendTo(elemPreview).addClass('empty-note').text('Note: this supplier is REVIEW - its technical suitability is not confirmed.');
        ctx.change = { supplierLink : '/api/v3/workspaces/' + supplierRef.workspaceId + '/items/' + supplierRef.dmsId, supplierName : supplierName,
            supplierSection : current.sectionId, notesSection : notes.sectionId,
            notesHtml : (notes.field.value ? String(notes.field.value) : '') + '<p>' + $('<div></div>').text(line).html() + '</p>' };
    }
    updateApplyButton();
}

function updateApplyButton() {
    const ready = !!(applyContext && !applyContext.problem && $('#apply-confirm').prop('checked'));
    $('#apply-package').toggleClass('disabled', !ready);
}

function applyToPackage() {
    const ctx = applyContext;
    if(!ctx || ctx.problem || !ctx.change || !$('#apply-confirm').prop('checked') || $('#apply-package').hasClass('busy')) return;

    const sections = {};
    const add = function(sectionId, field) { (sections[sectionId] = sections[sectionId] || { id : sectionId, fields : [] }).fields.push(field); };
    add(ctx.change.supplierSection, { fieldId : 'SUPPLIER',     type : 'single-select', value : ctx.change.supplierLink });
    add(ctx.change.notesSection,    { fieldId : 'NOTES',        value : ctx.change.notesHtml });

    $('#apply-package').addClass('busy disabled');
    $('#apply-status').text('Writing to Fusion Manage...');

    $.post('/plm/edit', { link : ctx.link, sections : Object.values(sections) }, function(response) {
        if(response.error) {
            $('#apply-status').text('Fusion Manage rejected the change: ' + (response.message || response.status || 'unknown error'));
            return;
        }
        const name = ctx.change.supplierName, title = ctx.itemTitle, link = ctx.link;
        loadPackages();
        selectPackage(link);
        setTimeout(function() { $('#apply-status').text('Package updated: supplier ' + name + ', part ' + title + ' noted in Notes.'); }, 0);
    }).fail(function() {
        $('#apply-status').text('The change could not be written (no permission or package not editable in its current state).');
    }).always(function() {
        $('#apply-package').removeClass('busy');
        updateApplyButton();
    });
}

// Empty sourcing panel of the selected package: only the picker, no analysis until an item is chosen.
function resetSourcingPanel() {
    sourcingRequest = null;
    hideApply();
    $('#sourcing-panel').removeClass('hidden');
    $('#sourcing-frame-wrap').html('');
    $('#sourcing-context').html('Choose an item to analyse its suppliers and alternatives.');
    $('#pkg-item-query').val('');
    renderItemOptions($('#pkg-item-pick'));
}

// Show the compact Intelligent Sourcing for the chosen item, or say honestly that it has no data for it.
function renderSourcing(match, label, knownCount) {
    sourcingRequest = null;
    hideApply();
    const safeLabel = $('<div></div>').text(label).html();
    $('#sourcing-frame-wrap').html('');
    if(match) {
        $('#sourcing-context').html('Item <strong>' + safeLabel + '</strong> from the Items workspace');
        $('<iframe></iframe>').appendTo('#sourcing-frame-wrap').attr('title', 'Intelligent Sourcing').attr('src', '/intelligent-sourcing?item=' + encodeURIComponent(match.id) + '&embedded=compact');
    } else {
        $('#sourcing-context').html('Intelligent Sourcing has no data for <strong>' + safeLabel + '</strong> yet. It currently covers ' + knownCount + ' parts (capabilities, suppliers, purchase history).');
    }
    $('#sourcing-panel').removeClass('hidden');
}

// Item first: no package needed, the detail panel shows only the sourcing section.
function showItemSourcing(match, label, knownCount) {
    selectedPackageLink = null;
    $('.package-row').removeClass('selected');
    $('#bulk-export-panel, #item-viewer-panel').addClass('hidden');

    $('#package-detail-title').html('Sourcing by item');
    $('#package-detail-panel').removeClass('hidden').addClass('item-mode');
    $('body').addClass('with-package-detail');

    renderSourcing(match, label, knownCount);
}

function loadSourcingItems(callback) {
    if(sourcingItems !== null) return callback(sourcingItems);
    $.getJSON('/sourcing/items', function(response) { sourcingItems = response.data || []; })
        .fail(function() { sourcingItems = []; })
        .always(function() { callback(sourcingItems); });
}

function getDetailsFieldValue(data, fieldId) {
    for(const section of (data.sections || [])) {
        for(const field of (section.fields || [])) {
            if((field.__self__ || '').endsWith('/fields/' + fieldId)) return (field.value && typeof field.value === 'object') ? (field.value.title || '') : String(field.value || '');
        }
    }
    return '';
}

// Packages written by Intelligent Sourcing (purchase history) keep their facts in NOTES as "key=value; key=value",
// e.g. "item=DEMO-SRC-ITEM-002; supplier=DEMO-SRC-SUP-001; quantity=20; unitPriceEUR=18.70". Show the part's compact sourcing next to them.
function renderSourcingPanel(data) {

    const notes = $('<textarea></textarea>').html(getDetailsFieldValue(data, 'NOTES')).text();
    const facts = {};
    notes.split(';').forEach(function(pair) {
        const index = pair.indexOf('=');
        if(index > 0) facts[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    });
    if(isBlank(facts.item)) return;

    const link = selectedPackageLink;
    loadSourcingItems(function(items) {
        const match = items.filter(function(i) { return i.id === facts.item; })[0];
        if(!match || link !== selectedPackageLink) return;

        const parts = [ 'Part <strong>' + match.title + '</strong>' ];
        if(facts.supplier)     parts.push('supplier ' + facts.supplier);
        if(facts.quantity)     parts.push(facts.quantity + ' pcs');
        if(facts.unitPriceEUR) parts.push(facts.unitPriceEUR + ' EUR each');
        $('#sourcing-context').html('Purchase history record of Intelligent Sourcing: ' + parts.join(' · '));
        $('<iframe></iframe>').appendTo('#sourcing-frame-wrap').attr('title', 'Intelligent Sourcing').attr('src', '/intelligent-sourcing?item=' + encodeURIComponent(match.id) + '&embedded=compact');
        $('#sourcing-panel').removeClass('hidden');
    });

}

function previewItem(link) {
    $('#item-viewer-panel').removeClass('hidden');
    insertViewer(link);
}

function getSelectedPackage() {
    return allPackages.find(function(pkg) { return pkg.link === selectedPackageLink; });
}

function getExportBaseName() {
    const pkg = getSelectedPackage();
    return (pkg && (pkg.number || pkg.descriptor)) || 'supplier-package';
}

function loadBulkExportViews() {
    if(currentSharedItems.length === 0) return;

    $.get('/plm/bom-views-and-fields', { link : currentSharedItems[0].link, useCache : true }, function(response) {
        bulkExportViews = Array.isArray(response.data) ? response.data : [];
        bulkExportViews.sort(function(left, right) { return String(left.name).localeCompare(String(right.name)); });

        const elemSelect = $('#bulk-bom-view').html('');
        for(const view of bulkExportViews) {
            $('<option></option>').appendTo(elemSelect).attr('value', view.id).html(view.name);
        }

        const defaultName = config.defaultBOMView || common.workspaces?.items?.defaultBOMView || '';
        const defaultView = bulkExportViews.find(function(view) { return view.name === defaultName; });
        if(defaultView) elemSelect.val(defaultView.id);
    });
}

function getBulkSelectedView() {
    const id = $('#bulk-bom-view').val();
    return bulkExportViews.find(function(view) { return String(view.id) === String(id); });
}

function getBulkExportSheets() {
    const view = getBulkSelectedView();
    const usedNames = {};

    return currentSharedItems.map(function(entry) {
        let name = entry.title.replace(/[\\\/\?\*\[\]:]/g, ' ').substring(0, 31);
        while(usedNames[name]) name = (name + '_').substring(0, 31);
        usedNames[name] = true;

        return {
            type         : 'bom',
            link         : entry.link,
            name         : name,
            bomView      : view ? view.name : '',
            depth        : $('#bulk-depth').val(),
            revisionBias : $('#bulk-revision-bias').val(),
            hideRoot     : false,
            fieldsIn     : config.exportFieldsIn || [],
            fieldsEx     : config.exportFieldsEx || []
        };
    });
}

function downloadFile(fileUrl) {
    window.open(document.location.origin + '/' + fileUrl, '_blank');
}

function exportAllExcel() {
    if(currentSharedItems.length === 0) return;

    $('#overlay').show();

    $.post('/plm/excel-export', {
        fileName : getExportBaseName() + '.xlsx',
        sheets   : getBulkExportSheets()
    }, function(response) {
        $('#overlay').hide();
        downloadFile(response.data.fileUrl);
    });
}

function attachAllExcel() {
    if(currentSharedItems.length === 0) return;
    if(!confirm('Attach the Excel export to ' + getExportBaseName() + '? This writes to the tenant and cannot be undone from here.')) return;

    const fileName = getExportBaseName() + '.xlsx';
    const wsId  = selectedPackageLink.split('/')[4];
    const dmsId = selectedPackageLink.split('/')[6];

    $('#overlay').show();

    $.post('/plm/excel-export', {
        fileName : fileName,
        sheets   : getBulkExportSheets()
    }, function(response) {
        fetch(document.location.origin + '/' + response.data.fileUrl)
            .then(function(fileResponse) { return fileResponse.blob(); })
            .then(function(blob) {
                const formData = new FormData();
                formData.append('newFiles', blob, fileName);

                return fetch('/plm/upload/' + wsId + '/' + dmsId, { method : 'POST', body : formData });
            })
            .then(function() {
                $('#overlay').hide();
                alert('Excel attached to ' + getExportBaseName() + '.');
                insertAttachments(selectedPackageLink, { editable : false, includeRelatedFiles : true, includeVaultFiles : true }, {});
            })
            .catch(function() {
                $('#overlay').hide();
                alert('Attach failed. Please try again.');
            });
    });
}

function exportAllZip() {
    if(currentSharedItems.length === 0) return;

    const includeAttachments = $('#bulk-zip-attachments').prop('checked');

    $('#overlay').show();

    const sendZip = function(excelPath) {
        const formData = new FormData();
        formData.append('links', JSON.stringify(currentSharedItems.map(function(entry) { return entry.link; })));
        formData.append('fileName', getExportBaseName() + '.zip');
        formData.append('includeAttachments', includeAttachments);
        if(excelPath) formData.append('excelPath', excelPath);

        fetch('/plm/zip-export', { method : 'POST', body : formData })
            .then(function(response) { return response.json(); })
            .then(function(response) {
                $('#overlay').hide();
                downloadFile(response.data.fileUrl);
            });
    };

    $.post('/plm/excel-export', {
        fileName : getExportBaseName() + '.xlsx',
        sheets   : getBulkExportSheets()
    }, function(response) { sendZip(response.data.fileUrl); });
}
