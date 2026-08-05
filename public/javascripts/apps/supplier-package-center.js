let allPackages = [];
let selectedPackageLink = null;
let currentSharedItems = [];
let bulkExportViews = [];

$(document).ready(function() {
    appendOverlay();
    insertMenu();
    setUIEvents();
    loadPackages();
});

function setUIEvents() {
    $('#refresh').click(loadPackages);
    $('#package-search').on('input', debounce(renderPackageTable, 200));
    $('#filter-type, #filter-status, #filter-supplier, #filter-has-items').change(renderPackageTable);
    $('#close-package-detail').click(function() {
        $('#package-detail-panel').addClass('hidden');
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
    });
}

function loadItemCounts() {
    const concurrency = 8;
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

    $('#package-detail-panel').removeClass('hidden');
    $('body').addClass('with-package-detail');
    $('#shared-items-list').html('<div class="empty-note">Loading...</div>');

    insertDetails(link, { useCache : true, toggles : true, id : 'package-details', editable : false, openInPLM : true }, {});
    insertAttachments(link, { editable : false, includeRelatedFiles : true, includeVaultFiles : true }, {});
    insertWorkflowActions(link, { onComplete : function() { loadPackages(); selectPackage(link); } });

    $.get('/plm/details', { link : link, useCache : true }, function(response) {
        renderSharedItems(response.data || {});
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
    }

    $('#bulk-export-panel').removeClass('hidden');
    loadBulkExportViews();
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
