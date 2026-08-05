let selectedItem = null;

$(document).ready(function() {

    appendOverlay();
    insertMenu();
    setUIEvents();
    checkConfig();
    loadHistory();
    openHistoryIdFromUrl();

    insertSearch({
        id           : 'search',
        hideHeader   : true, // the .section-title above the panel already labels it - avoid a duplicate "Search" header
        workspaceIds : [ config.workspaceId || common.workspaceIds.items ],
        onClickItem  : function(elemClicked) { selectItem(elemClicked); }
    });

    // Live search like the other extensions: search as you type instead of requiring Enter/button.
    $('#search-search-content-input').on('input', debounce(function() {
        if ($(this).val().length < 2) return;
        insertSearchData('search', false);
    }, 300));

});

function formatDateTime(iso) {
    return new Date(iso).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
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

function setUIEvents() {
    $('#refresh-history').click(loadHistory);
}

// Lands here from a failure-notification email link (?historyId=...) - jump straight to that
// transfer's details instead of making the user find it in the history table themselves.
function openHistoryIdFromUrl() {

    const historyId = new URLSearchParams(window.location.search).get('historyId');
    if (!historyId) return;

    $.get('/erp/transfer-status/' + historyId, function(response) {
        if (!response.data) return;
        selectItemByIds(response.data.wsId, response.data.dmsId, response.data.itemTitle);
        showTransferDetails(response.data);
    });

}

function checkConfig() {
    $.get('/erp/config', function(response) {
        if (response.data && !response.data.configured) $('#config-warning').removeClass('hidden');
    });
}

function selectItem(elemClicked) {

    const link  = elemClicked.attr('data-link');
    const parts = link.split('/');

    selectItemByIds(parts[4], parts[6], elemClicked.attr('data-title'));
}

// Shared by search results (which carry a ready-made /api/v3/... link) and history rows
// (which only carry wsId/dmsId) - both end up wanting the same selected-item + BOM/Details view.
function selectItemByIds(wsId, dmsId, title) {

    selectedItem = { wsId: wsId, dmsId: dmsId, title: title };

    const link = '/api/v3/workspaces/' + wsId + '/items/' + dmsId;

    renderSelectedItem();
    loadItemStatus();

    insertBOM(link, { hideHeader: true, depth: 10, fieldsIn: ['Quantity'] });
    insertDetails(link, { hideHeader: true });
}

// Fusion Manage's own web UI addresses an item via a backtick/comma-encoded variant of its urn
// (confirmed by inspecting the link the FM search results page itself renders) rather than the
// plain urn:adsk.plm:... form used everywhere else - so build it that way instead of the REST shape.
function fusionManageItemUrl(wsId, dmsId) {
    const urn    = 'urn:adsk.plm:tenant.workspace.item:' + tenant.toUpperCase() + '.' + wsId + '.' + dmsId;
    const itemId = urn.replace(/:/g, '`').replace(/\./g, ',');
    return 'https://' + tenant + '.autodeskplm360.net/plm/workspaces/' + wsId + '/items/itemDetails?view=full&tab=details&mode=view&itemId=' + encodeURIComponent(itemId);
}

function renderSelectedItem() {

    $('#selected-item').html('');

    const panel = $('<div>').addClass('selected-item-detail').appendTo('#selected-item');

    $('<div>').addClass('selected-item-title').text(selectedItem.title).appendTo(panel);

    const meta = $('<div>').addClass('selected-item-meta').appendTo(panel);
    meta.append(document.createTextNode('Workspace ' + selectedItem.wsId + ' · DMS ID ' + selectedItem.dmsId + ' · '));
    $('<a>').attr('href', fusionManageItemUrl(selectedItem.wsId, selectedItem.dmsId)).attr('target', '_blank').attr('rel', 'noopener')
        .text('Open in Fusion Manage').appendTo(meta);

    $('<div>').attr('id', 'transfer-button')
        .addClass('button').addClass('with-icon').addClass('icon-swap').addClass('default')
        .text('Transfer to ERP')
        .appendTo(panel)
        .click(transferSelected);

    $('<div>').attr('id', 'last-transfer-status').addClass('last-transfer-status').appendTo(panel);
    $('<div>').attr('id', 'transfer-current-part').addClass('transfer-current-part hidden').appendTo(panel);

}

function transferSelected(override) {

    if (!selectedItem) return;

    const button = $('#transfer-button');
    if (!override && button.hasClass('disabled')) return; // guards against double-submit races in Dolibarr

    button.addClass('disabled');

    startTransfer(selectedItem.wsId, selectedItem.dmsId, 'manual', function(response, xhr) {

        button.removeClass('disabled');

        if (xhr) {
            const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Transfer failed';
            renderLastStatus({ status: 'failed', errorMessage: message });
            return;
        }

        // Not a failure - the gate wants a human decision. Offer to force it through instead
        // of showing an error; the current Dolibarr demo never configures the gate, so this
        // path only ever fires once a releasedLifecycleValues setting is actually turned on.
        if (response.requiresOverride) {
            renderOverridePrompt(response.message, function() { transferSelected(true); });
            return;
        }

        renderLastStatus({
            status       : response.success ? 'success' : 'failed',
            errorMessage : response.success ? null : response.message,
            dolibarrBomId: response.data && response.data.dolibarrBomId
        });

    }, override);

}

function renderOverridePrompt(message, onConfirm) {

    const elem = $('#last-transfer-status').removeClass('status-success status-failed').html('');

    $('<div>').text(message).appendTo(elem);
    $('<div>').addClass('button default').css('margin-top', '8px').text('Trotzdem übertragen')
        .appendTo(elem)
        .click(onConfirm);

}

// Shared by the "Transfer to ERP" button and the history table's per-row Retry button.
// Drives the progress dialog + overview line, then hands the outcome to onDone(response, xhr)
// (xhr is only set on a transport-level failure, e.g. the request itself errored).
function startTransfer(wsId, dmsId, trigger, onDone, override) {

    const transferId = 'xfer-' + Math.random().toString(36).slice(2);
    showTransferProgressDialog();
    $('#transfer-current-part').removeClass('hidden').text('Starting transfer...');
    const pollHandle = setInterval(function() { pollTransferProgress(transferId); }, 400);

    $.post('/erp/transfer', { wsId: wsId, dmsId: dmsId, transferId: transferId, override: !!override, trigger: trigger }, function(response) {
        clearInterval(pollHandle);
        $('#transfer-current-part').addClass('hidden');
        if (response.requiresOverride) {
            // Nothing actually ran server-side (the gate returned before any work started) -
            // just close the dialog quietly instead of announcing success/failure.
            $('#transfer-progress-dialog').hide();
            $('#overlay').hide();
        } else {
            finishTransferProgressDialog(response.success);
            loadHistory();
        }
        onDone(response, null);
    }).fail(function(xhr) {
        clearInterval(pollHandle);
        finishTransferProgressDialog(false);
        $('#transfer-current-part').addClass('hidden');
        loadHistory();
        onDone(null, xhr);
    });

}

function retryTransfer(wsId, dmsId) {
    startTransfer(wsId, dmsId, 'retry', function() {});
}

// Progress dialog reused from the shared .dialog/.step/.step-bar/.step-counter framework
// classes (see framework/dialogs.css) - built once, then reset and re-shown per transfer.
// Progress itself is server-side state (services/erpProgressStore.js), polled here because
// the transfer runs inside a single long POST /erp/transfer request.
function showTransferProgressDialog() {

    let dialog = $('#transfer-progress-dialog');

    if (dialog.length === 0) {

        dialog = $('<div>').attr('id', 'transfer-progress-dialog').addClass('dialog').appendTo('body');
        $('<div>').addClass('dialog-header').text('Transferring to ERP').appendTo(dialog);

        const content = $('<div>').addClass('dialog-content').appendTo(dialog);
        const step = $('<div>').addClass('step in-work').attr('id', 'transfer-progress-step').appendTo(content);
        $('<div>').addClass('step-label').attr('id', 'transfer-progress-label').text('Starting transfer...').appendTo(step);
        const stepProgress = $('<div>').addClass('step-progress').appendTo(step);
        $('<div>').addClass('step-bar').attr('id', 'transfer-progress-bar').appendTo(stepProgress);
        $('<div>').addClass('step-counter').attr('id', 'transfer-progress-counter').appendTo(step);
        $('<div>').addClass('transfer-progress-detail').attr('id', 'transfer-progress-detail').appendTo(content);

        const footer = $('<div>').addClass('dialog-footer').appendTo(dialog);
        $('<div>').addClass('button default disabled').attr('id', 'transfer-progress-close').text('Close')
            .appendTo(footer)
            .click(function() {
                if ($(this).hasClass('disabled')) return;
                dialog.hide();
                $('#overlay').hide();
            });
    }

    $('#transfer-progress-label').text('Starting transfer...');
    $('#transfer-progress-bar').css('width', '0%');
    $('#transfer-progress-counter').text('');
    $('#transfer-progress-detail').text('');
    $('#transfer-progress-step').addClass('in-work');
    $('#transfer-progress-close').addClass('disabled');
    $('#overlay').show();
    dialog.show();

}

function pollTransferProgress(transferId) {

    $.get('/erp/transfer-progress/' + transferId, function(response) {

        const state = response.data;
        if (!state || !state.total) return;

        $('#transfer-progress-label').text(state.step);
        $('#transfer-progress-bar').css('width', (state.current * 100 / state.total) + '%');
        $('#transfer-progress-counter').text(state.current + ' of ' + state.total);
        $('#transfer-progress-detail').text(state.detail || '');

        const overviewText = state.step + ': ' + state.current + ' of ' + state.total
            + (state.detail ? ' – ' + state.detail : '');
        $('#transfer-current-part').text(overviewText);

    });

}

function finishTransferProgressDialog(success) {

    $('#transfer-progress-step').removeClass('in-work');
    $('#transfer-progress-label').text(success ? 'Transfer complete' : 'Transfer failed');
    $('#transfer-progress-close').removeClass('disabled');

}

function loadItemStatus() {

    $.get('/erp/transfer-item/' + selectedItem.wsId + '/' + selectedItem.dmsId, function(response) {
        renderLastStatus(response.data);
    }).fail(function() {
        renderLastStatus(null);
    });

}

// 'failed' is the pre-Phase-4 status still present in older history.json records - kept as a
// display alias for 'error' so those rows still render sensibly, no data migration needed.
const STATUS_LABELS = {
    success  : 'Successful',
    warning  : 'Successful (with warning)',
    rejected : 'Rejected',
    error    : 'Failed',
    failed   : 'Failed'
};

function statusClass(status) {
    return 'status-' + status;
}

const TRIGGER_LABELS = {
    manual        : 'Manual',
    retry         : 'Retry',
    batch         : 'Batch',
    webhook       : 'Lean Change Order approval',
    'webhook-retry' : 'Lean Change Order approval (auto-retry)'
};

function renderLastStatus(record) {

    const elem = $('#last-transfer-status');
    if (!elem.length) return;

    elem.removeClass('status-success status-warning status-rejected status-error status-failed');

    if (!record) {
        elem.html('No previous transfer for this item');
        return;
    }

    const label = 'Last transfer: ' + (STATUS_LABELS[record.status] || record.status)
        + (record.dolibarrBomId ? ' (Dolibarr BOM #' + record.dolibarrBomId + ')' : '')
        + (record.status !== 'success' && record.errorMessage ? ': ' + record.errorMessage : '');

    elem.text(label).addClass(statusClass(record.status));

}

function loadHistory() {

    $.get('/erp/transfer-history', { limit: 50 }, function(response) {
        renderHistory((response.data && response.data.history) || []);
    });

}

function markRowSelected(tr) {
    $('.history-row').removeClass('selected');
    tr.addClass('selected');
}

function renderHistory(rows) {

    const body = $('#history-body').html('');

    let successCount = 0;
    let failedCount   = 0;

    rows.forEach(function(row) {

        if (row.status === 'success' || row.status === 'warning') successCount++;
        else failedCount++;

        const tr = $('<tr>').addClass('history-row').appendTo(body);

        $('<td>').text(formatDateTime(row.transferredAt)).appendTo(tr);

        const itemCell  = $('<td>').appendTo(tr);
        const itemLabel = (row.itemTitle || row.dmsId) + ' (WS ' + row.wsId + ')';
        $('<div>').addClass('history-item-link').text(itemLabel).attr('title', itemLabel)
            .appendTo(itemCell)
            .click(function(event) {
                event.stopPropagation(); // don't also trigger the row's "show transfer info" click
                markRowSelected(tr);
                selectItemByIds(row.wsId, row.dmsId, row.itemTitle);
                clickTab($('#tab-bom'));
            });
        $('<div>').addClass('transfer-trigger').text(TRIGGER_LABELS[row.trigger] || row.trigger).appendTo(itemCell);

        $('<td>').addClass('status-badge').addClass(statusClass(row.status)).text(STATUS_LABELS[row.status] || row.status).appendTo(tr);

        const bomCell = $('<td>').appendTo(tr);
        if (row.dolibarrUrl) {
            $('<a>').attr('href', row.dolibarrUrl).attr('target', '_blank').attr('rel', 'noopener').text('#' + row.dolibarrBomId)
                .appendTo(bomCell)
                .click(function(event) { event.stopPropagation(); });
        } else {
            bomCell.text(row.dolibarrBomId || '-');
        }

        const detailsCell = $('<td>').appendTo(tr);
        $('<div>').addClass('button icon icon-info details-transfer-button')
            .attr('title', 'View details').attr('aria-label', 'View details')
            .appendTo(detailsCell)
            .click(function(event) { event.stopPropagation(); showTransferDetails(row); });

        const retryCell = $('<td>').appendTo(tr);
        if (row.status === 'error' || row.status === 'failed' || row.status === 'rejected') {
            $('<div>').addClass('button icon icon-refresh retry-transfer-button')
                .attr('title', 'Retry transfer').attr('aria-label', 'Retry transfer')
                .appendTo(retryCell)
                .click(function(event) { event.stopPropagation(); retryTransfer(row.wsId, row.dmsId); });
        }

        // Clicking the row itself (anywhere but the item link / links / action buttons above,
        // which stop propagation): select the item AND jump straight to its transfer details.
        tr.click(function() {
            markRowSelected(tr);
            selectItemByIds(row.wsId, row.dmsId, row.itemTitle);
            showTransferDetails(row);
        });

    });

    $('#total-count').text(rows.length);
    $('#success-count').text(successCount);
    $('#failed-count').text(failedCount);

}

// Fills the "Transfer Info" tab of the right-hand side panel with one history record's full
// error message and the coarse step log recorded by erpTransferService.js - shown inline
// instead of a popup so it sits next to the item's own BOM/Details tabs.
function showTransferDetails(record) {

    const panel = $('#transfer-log').html('');

    function addDetailRow(label, valueBuilder) {
        const row = $('<div>').addClass('detail-row').appendTo(panel);
        $('<strong>').text(label + ':').appendTo(row);
        row.append(' ');
        valueBuilder(row);
    }

    addDetailRow('Item', function(row) {
        row.append(document.createTextNode((record.itemTitle || record.dmsId) + ' (WS ' + record.wsId + ') · '));
        $('<a>').attr('href', fusionManageItemUrl(record.wsId, record.dmsId)).attr('target', '_blank').attr('rel', 'noopener')
            .text('Open in Fusion Manage').appendTo(row);
    });
    addDetailRow('Trigger', function(row) { row.append(document.createTextNode(TRIGGER_LABELS[record.trigger] || record.trigger || '-')); });
    addDetailRow('Status', function(row) { row.append(document.createTextNode(STATUS_LABELS[record.status] || record.status)); });

    if (record.dolibarrUrl) {
        addDetailRow('Dolibarr BOM', function(row) {
            $('<a>').attr('href', record.dolibarrUrl).attr('target', '_blank').attr('rel', 'noopener').text('#' + record.dolibarrBomId).appendTo(row);
        });
    }

    if (record.errorMessage) {
        $('<div>').addClass('detail-row').append($('<strong>').text('Message:')).appendTo(panel);
        $('<pre>').addClass('detail-message').text(record.errorMessage).appendTo(panel);
    }

    if (Array.isArray(record.log) && record.log.length > 0) {
        $('<div>').addClass('detail-row').append($('<strong>').text('Log:')).appendTo(panel);
        const list = $('<ul>').addClass('detail-log').appendTo(panel);
        record.log.forEach(function(step) {
            $('<li>').text('[' + new Date(step.at).toLocaleTimeString('de-DE') + '] ' + step.message).appendTo(list);
        });
    }

    clickTab($('#tab-transfer'));

}
