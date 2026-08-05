let bomExportViews = [];
let bomExportRows = [];
let itemHeader = null;
let attachPending = false;
let relatedBOMs = [];

$(document).ready(function() {
    if(new URLSearchParams(window.location.search).get('embedded') === 'true') $('body').addClass('embedded');
    appendOverlay();
    insertMenu();
    setUIEvents();
    loadFromUrl();
    updateState();
});

function setUIEvents() {
    $('#refresh, #load-views').click(loadBOMViews);
    $('#toggle-details').click(function() {
        $('#details').toggleClass('hidden');
        $('body').toggleClass('with-details');
        viewerResize();
    });
    $('#toggle-attachments').click(function() {
        $('#attachments').toggleClass('hidden');
        $('body').toggleClass('with-attachments');
        viewerResize();
    });
    $('#preview-bom').click(previewBOM);
    $('#export-xlsx').click(exportExcel);
    $('#export-csv').click(exportCSV);
    $('#export-pdf').click(buildPDF);
    $('#export-zip').click(exportZip);
    $('#attach-pdf').click(attachPDFDirect);
    $('#download-pdf').click(downloadPDF);
    $('#close-pdf-preview').click(function() {
        $('#pdf-panel').addClass('hidden');
        $('#preview-panel').removeClass('hidden');
    });
    $('#attach-file').click(clickAttach);
    $('#select-file').change(submitAttach);
    $('#open-item-link').click(function() {
        if($(this).hasClass('disabled')) return;
        openItemByLink(getItemLink());
    });
    $('#frame-upload').on('load', function() {
        if(attachPending) {
            attachPending = false;
            alert('File attached to ' + getItemSummaryText());
        }
    });
    $('#item-link').on('input', updateState);
    $('#item-search').on('input', debounce(searchItems, 350));
    $('#search-workspace').change(function() {
        if($('#item-search').val().trim() !== '') searchItems();
    });
    $('#item-picker').change(function() {
        const link = $(this).val();
        if(link) { $('#item-link').val(link).trigger('input'); $('#load-views').click(); }
    });
    $('#related-boms').change(function() {
        const link = $(this).val();
        if(link) { $('#item-link').val(link).trigger('input'); $('#load-views').click(); }
    });
}

function debounce(fn, delay) {
    let timer = null;
    return function() {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
    };
}

const RELATED_BOM_TYPES = ['Single Selection', 'Multiple Selection'];
const RELATED_BOM_NAME_MATCH = /bom|variant|serial|motor|sensor|control element|service|supplier|package/i;

function getRelatedBOMs(sections) {
    const related = [];

    for(const section of sections || []) {
        for(const field of section.fields || []) {
            if(!RELATED_BOM_TYPES.includes(field.type.title)) continue;
            if(!RELATED_BOM_NAME_MATCH.test(field.title)) continue;
            if(isBlank(field.value)) continue;

            const entries = Array.isArray(field.value) ? field.value : [field.value];
            for(const entry of entries) {
                if(entry && entry.link && entry.title) {
                    related.push({ label : field.title + ': ' + entry.title, link : entry.link });
                }
            }
        }
    }

    return related;
}

function getSearchWorkspaces() {
    const scope = $('#search-workspace').val();
    const itemsWsId = config.workspaceId || common.workspaceIds.items;
    const assetsWsId = common.workspaceIds.assets;

    if(scope === 'items') return [itemsWsId];
    if(scope === 'assets' && !isBlank(assetsWsId)) return [assetsWsId];

    const workspaces = [itemsWsId];
    if(!isBlank(assetsWsId)) workspaces.push(assetsWsId);
    return workspaces;
}

let searchRequest = null;

function searchItems() {
    const query = $('#item-search').val().trim();
    const elemPicker = $('#item-picker').html('');

    if(searchRequest) searchRequest.abort();

    if(!query) {
        $('<option></option>').appendTo(elemPicker).attr('value', '').html('Search results appear here');
        return;
    }

    searchRequest = $.post('/plm/search-descriptor', { query : query, workspaces : getSearchWorkspaces(), limit : 25 }, function(response) {
        elemPicker.html('');
        const items = (response.data && response.data.items) || [];

        if(items.length === 0) {
            $('<option></option>').appendTo(elemPicker).attr('value', '').html('No matches found');
            return;
        }

        $('<option></option>').appendTo(elemPicker).attr('value', '').html(items.length + ' match(es) - select one');
        for(const item of items) {
            $('<option></option>').appendTo(elemPicker).attr('value', item.__self__).html('[' + item.workspaceLongName + '] ' + item.descriptor);
        }
    });
}

function loadFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const link = params.get('link');
    const wsId = params.get('wsId');
    const dmsId = params.get('dmsId');

    if(link) $('#item-link').val(link);
    else if(wsId && dmsId) $('#item-link').val('/api/v3/workspaces/' + wsId + '/items/' + dmsId);
    else return;

    loadBOMViews();
}

function getItemLink() {
    return String($('#item-link').val() || '').trim();
}

function getSelectedView() {
    return bomExportViews.find(function(view) {
        return String(view.id) === String($('#bom-view').val());
    });
}

function updateState() {
    const hasLink = getItemLink() !== '';
    const hasView = !!getSelectedView();
    const hasRows = bomExportRows.length > 0;

    $('#item-status').html(hasLink ? 'Ready' : 'Needed');
    $('#view-count').html(bomExportViews.length || '-');
    $('#row-count').html(hasRows ? bomExportRows.length : '-');
    $('#preview-bom').toggleClass('disabled', !hasLink || !hasView);
    $('#export-xlsx').toggleClass('disabled', !hasLink || !hasView);
    $('#export-csv').toggleClass('disabled', !hasRows);
    $('#export-pdf').toggleClass('disabled', !hasRows);
    $('#export-zip').toggleClass('disabled', !hasLink);
    $('#zip-pdf').prop('disabled', !pdfDoc).prop('checked', $('#zip-pdf').prop('checked') && !!pdfDoc);
    $('#attach-file').toggleClass('disabled', !hasLink);
    $('#open-item-link').toggleClass('disabled', !hasLink);
}

let pdfDoc = null;

function imageUrlToDataURL(url) {
    return fetch(url).then(function(res) { return res.blob(); }).then(function(blob) {
        return new Promise(function(resolve) {
            const reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.readAsDataURL(blob);
        });
    }).catch(function() { return null; });
}

async function buildPDF() {
    if($('#export-pdf').hasClass('disabled')) return;
    $('#overlay').show();

    const imageData = (itemHeader && itemHeader.imageUrl) ? await imageUrlToDataURL(itemHeader.imageUrl) : null;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation : 'landscape', unit : 'pt' });
    const view = getSelectedView();
    const textX = imageData ? 100 : 40;
    let y = 45;

    if(imageData) {
        try { doc.addImage(imageData, textX - 60, 25, 50, 50); } catch(e) {}
    }

    doc.setFontSize(14);
    doc.text((getItemSummaryText() || 'BOM Export') + ' - ' + (view?.name || ''), textX, y);
    y += 18;

    doc.setFontSize(9);
    if(itemHeader && itemHeader.basicFields.length > 0) {
        const fieldsText = itemHeader.basicFields.map(function(f) { return f.title + ': ' + f.value; }).join('   ');
        const lines = doc.splitTextToSize(fieldsText, 750);
        doc.text(lines, textX, y);
        y += lines.length * 11;
    }

    if(relatedBOMs.length > 0) {
        const relatedText = 'Related BOMs: ' + relatedBOMs.map(function(item) { return item.label; }).join('  |  ');
        const lines = doc.splitTextToSize(relatedText, 750);
        doc.text(lines, textX, y);
        y += lines.length * 11;
    }

    const fields = getPreviewFields();
    doc.autoTable({
        head      : [['Level'].concat(fields.map(getFieldLabel))],
        body      : bomExportRows.map(function(row) { return [row.level || ''].concat(fields.map(function(field) { return stripHTML(getFieldValue(row, field)); })); }),
        startY    : y + 15,
        styles    : { fontSize : 7 },
        headStyles: { fillColor : [42, 110, 224] }
    });

    pdfDoc = doc;
    $('#pdf-preview-frame').attr('src', doc.output('bloburl'));
    $('#preview-panel').addClass('hidden');
    $('#pdf-panel').removeClass('hidden');
    $('#overlay').hide();
}

function downloadPDF() {
    if(!pdfDoc) return;
    pdfDoc.save(exportFileName('pdf'));
}

function attachPDFDirect() {
    if(!pdfDoc) return;
    if(!confirm('Attach this PDF to ' + getItemSummaryText() + '? This writes to the tenant and cannot be undone from here.')) return;

    const link = getItemLink();
    const urlUpload = '/plm/upload/' + link.split('/')[4] + '/' + link.split('/')[6];
    const blob = pdfDoc.output('blob');
    const formData = new FormData();
    formData.append('newFiles', blob, exportFileName('pdf'));

    $('#overlay').show();
    $.ajax({
        url         : urlUpload,
        type        : 'POST',
        data        : formData,
        processData : false,
        contentType : false
    }).done(function() {
        $('#overlay').hide();
        alert('PDF attached to ' + getItemSummaryText());
    }).fail(function() {
        $('#overlay').hide();
        alert('Attach failed. Please try again.');
    });
}

function loadBOMViews() {
    const link = getItemLink();
    if(!link) return;

    $('#overlay').show();
    $.get('/plm/bom-views-and-fields', { link : link, useCache : true }, function(response) {
        bomExportViews = Array.isArray(response.data) ? response.data : [];
        renderBOMViews();
        $('#view-note').html((response.error && bomExportViews.length === 0) ? 'No direct BOM view on this workspace - check Related BOMs below.' : '');
        $('#overlay').hide();
        updateState();
    });
    loadItemHeader(link);
}

function loadViewerWithFallback(link, related) {
    $.post('/plm/get-viewables', { link : link }, function(response) {
        const hasViewable = Array.isArray(response.data) && response.data.length > 0;
        if(hasViewable) { insertViewer(link); return; }

        const fallback = related.find(function(item) { return /engineering bom/i.test(item.label); });
        insertViewer(fallback ? fallback.link : link);
    });
}

const BASIC_FIELD_SKIP = ['Icon', 'Image', 'DMS_ID', 'WS_ID', 'QR-Code', 'Barcode', 'MBOM Multi Editor'];

function loadItemHeader(link) {
    $.get('/plm/details', { link : link, useCache : true }, function(response) {
        const data = response.data || {};
        const basicSection = (data.sections || []).find(function(s) { return s.title === 'Basic'; });
        const basicFields = basicSection ? basicSection.fields.filter(function(f) {
            return !BASIC_FIELD_SKIP.includes(f.title) && !isBlank(f.value) && (typeof f.value === 'string' || typeof f.value === 'number');
        }) : [];
        const imageField = basicSection ? basicSection.fields.find(function(f) { return f.title === 'Image'; }) : null;

        itemHeader = {
            title       : data.title || '',
            revision    : data.version || '',
            lifecycle   : (data.lifecycle && data.lifecycle.title) || '',
            workspace   : (data.workspace && data.workspace.title) || '',
            basicFields : basicFields.map(function(f) { return { title : f.title, value : stripHTML(f.value) }; }),
            imageUrl    : ''
        };
        renderItemHeader();
        const related = getRelatedBOMs(data.sections);
        renderRelatedBOMs(related);
        loadItemImage(imageField);
        loadViewerWithFallback(link, related);
        insertDetails(link, { useCache : true, toggles : true, expandSections : ['Basic'] }, {});
        insertAttachments(link, { editable : false }, {});
    });
}

function renderRelatedBOMs(related) {
    relatedBOMs = related;
    const elemRow = $('#related-boms-row');
    const elemSelect = $('#related-boms').html('<option value="">Select a related item...</option>');

    if(related.length === 0) { elemRow.addClass('hidden'); return; }

    elemRow.removeClass('hidden');
    for(const item of related) {
        $('<option></option>').appendTo(elemSelect).attr('value', item.link).html(item.label);
    }
}

function loadItemImage(imageField) {
    if(isBlank(imageField) || isBlank(imageField.value)) return;
    const value = imageField.value;

    if(value.imageFile) {
        itemHeader.imageUrl = '/storage/cache/' + value.imageFile;
        renderItemHeader();
        return;
    }

    $.get('/plm/image-cache', { imageLink : value.link }, function(response) {
        itemHeader.imageUrl = response.data.url;
        renderItemHeader();
    });
}

function renderItemHeader() {
    if(!itemHeader) return;
    const elem = $('#item-header-line').html('');

    if(itemHeader.imageUrl) $('<img></img>').appendTo(elem).attr('id', 'item-header-image').attr('src', itemHeader.imageUrl);

    const elemText = $('<div></div>').appendTo(elem).attr('id', 'item-header-text');
    $('<div></div>').appendTo(elemText).attr('id', 'item-header-title').html(
        itemHeader.title + ' ' + itemHeader.revision +
        (itemHeader.lifecycle ? ' &middot; ' + itemHeader.lifecycle : '') +
        (itemHeader.workspace ? ' &middot; ' + itemHeader.workspace : '')
    );

    if(itemHeader.basicFields.length > 0) {
        const elemFields = $('<div></div>').appendTo(elemText).attr('id', 'item-header-fields');
        for(const field of itemHeader.basicFields) {
            $('<span></span>').appendTo(elemFields).addClass('item-header-field')
                .html('<b>' + field.title + ':</b> ' + field.value);
        }
    }
}

function getItemSummaryText() {
    if(!itemHeader) return '';
    return [itemHeader.title, itemHeader.revision, itemHeader.lifecycle, itemHeader.workspace]
        .filter(Boolean).join(' | ');
}

function renderBOMViews() {
    const elemSelect = $('#bom-view').html('');
    bomExportViews.sort(function(left, right) {
        return String(left.name).localeCompare(String(right.name));
    });

    for(const view of bomExportViews) {
        $('<option></option>').appendTo(elemSelect)
            .attr('value', view.id)
            .html(view.name);
    }

    const defaultName = config.defaultBOMView || common.workspaces?.items?.defaultBOMView || '';
    const defaultView = bomExportViews.find(function(view) {
        return view.name === defaultName;
    });
    if(defaultView) elemSelect.val(defaultView.id);
}

function previewBOM() {
    if($('#preview-bom').hasClass('disabled')) return;

    const view = getSelectedView();
    $('#overlay').show();

    $.get('/plm/bom', {
        link            : getItemLink(),
        depth           : $('#depth').val(),
        revisionBias    : $('#revision-bias').val(),
        viewId          : view.id,
        getBOMPartsList : true,
        hideRoot        : false,
        useCache        : true,
        requestor       : 'bom-export-attachment-studio'
    }, function(response) {
        bomExportRows = response.data?.bomPartsList || [];
        renderPreview();
        $('#overlay').hide();
        updateState();
    });
}

function getPreviewFields() {
    const view = getSelectedView();
    return (view && view.fields) || [];
}

function getFieldLabel(field) {
    return field.displayName || field.name || field.fieldId;
}

function getFieldValue(row, field) {
    const value = row.details ? row.details[field.fieldId] : undefined;
    if(!isBlank(value)) return value;
    if(field.fieldId === 'NUMBER') return row.partNumber || row.number || '';
    if(field.fieldId === 'QUANTITY') return row.quantity || row.totalQuantity || '';
    return '';
}

function renderPreview() {
    const fields = getPreviewFields();
    const elemHead = $('#bom-preview-head').html('');
    const elemBody = $('#bom-preview-body').html('');
    const rows = bomExportRows;

    const elemHeadRow = $('<tr></tr>').appendTo(elemHead);
    $('<th></th>').appendTo(elemHeadRow).html('Level');
    for(const field of fields) $('<th></th>').appendTo(elemHeadRow).html(getFieldLabel(field));

    if(rows.length === 0) {
        $('<tr><td></td></tr>').appendTo(elemBody).find('td').attr('colspan', fields.length + 1).html('No BOM rows returned for this view.');
        return;
    }

    for(const row of rows) {
        const elemRow = $('<tr></tr>').appendTo(elemBody);
        $('<td></td>').appendTo(elemRow).html(row.level || '');
        for(const field of fields) $('<td></td>').appendTo(elemRow).html(stripHTML(getFieldValue(row, field)));
    }
}

function exportExcel() {
    if($('#export-xlsx').hasClass('disabled')) return;

    const view = getSelectedView();
    $('#overlay').show();

    $.post('/plm/excel-export', {
        fileName : exportFileName('xlsx'),
        sheets   : [{
            type         : 'bom',
            link         : getItemLink(),
            name         : 'BOM',
            bomView      : view.name,
            depth        : $('#depth').val(),
            revisionBias : $('#revision-bias').val(),
            hideRoot     : false,
            fieldsIn     : config.exportFieldsIn || [],
            fieldsEx     : config.exportFieldsEx || [],
            itemSummary  : getItemSummaryText()
        }]
    }, function(response) {
        $('#overlay').hide();
        document.getElementById('frame-download').src = document.location.origin + '/' + response.data.fileUrl;
    });
}

function exportZip() {
    if($('#export-zip').hasClass('disabled')) return;

    const includeAttachments = $('#zip-attachments').prop('checked');
    const includeExcel       = $('#zip-excel').prop('checked') && !!getSelectedView();
    const includePdf         = $('#zip-pdf').prop('checked') && !!pdfDoc;

    if(!includeAttachments && !includeExcel && !includePdf) {
        alert('Select at least one item to include in the ZIP (Attachments, Excel BOM, or PDF).');
        return;
    }

    $('#overlay').show();

    const sendZip = function(excelPath) {
        const formData = new FormData();
        formData.append('link', getItemLink());
        formData.append('fileName', exportFileName('zip'));
        formData.append('includeAttachments', includeAttachments);
        if(excelPath) formData.append('excelPath', excelPath);
        if(includePdf) formData.append('pdfFile', pdfDoc.output('blob'), exportFileName('pdf'));

        fetch('/plm/zip-export', { method : 'POST', body : formData })
            .then(function(response) { return response.json(); })
            .then(function(response) {
                $('#overlay').hide();
                document.getElementById('frame-download').src = document.location.origin + '/' + response.data.fileUrl;
            });
    };

    if(includeExcel) {
        const view = getSelectedView();
        $.post('/plm/excel-export', {
            fileName : exportFileName('xlsx'),
            sheets   : [{
                type         : 'bom',
                link         : getItemLink(),
                name         : 'BOM',
                bomView      : view.name,
                depth        : $('#depth').val(),
                revisionBias : $('#revision-bias').val(),
                hideRoot     : false,
                fieldsIn     : config.exportFieldsIn || [],
                fieldsEx     : config.exportFieldsEx || [],
                itemSummary  : getItemSummaryText()
            }]
        }, function(response) { sendZip(response.data.fileUrl); });
    } else {
        sendZip(null);
    }
}

function stripHTML(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value);
    const decoded = textarea.value;
    return decoded.replace(/</g, ' <').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function exportCSV() {
    if($('#export-csv').hasClass('disabled')) return;

    const fields = getPreviewFields();
    const header = ['Level'].concat(fields.map(getFieldLabel));
    const summaryRow = [getItemSummaryText()];
    const rows = [summaryRow, [], header].concat(bomExportRows.map(function(row) {
        return [row.level || ''].concat(fields.map(function(field) { return stripHTML(getFieldValue(row, field)); }));
    }));
    const csv = rows.map(function(row) {
        return row.map(csvValue).join(';');
    }).join('\r\n');
    const link = document.createElement('a');
    const utf8BOM = '﻿';
    link.href = URL.createObjectURL(new Blob([utf8BOM + csv], { type : 'text/csv;charset=utf-8' }));
    link.download = exportFileName('csv');
    link.click();
    URL.revokeObjectURL(link.href);
}

function csvValue(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function exportFileName(extension) {
    const view = getSelectedView();
    const dmsId = getItemLink().split('/items/')[1] || 'item';
    return 'BOM ' + dmsId.replace(/[^a-zA-Z0-9_-]+/g, '-') + ' ' + (view?.name || 'view').replace(/[^a-zA-Z0-9_-]+/g, '-') + '.' + extension;
}

function clickAttach() {
    if($('#attach-file').hasClass('disabled')) return;
    if(!confirm('Attach a file to ' + getItemSummaryText() + '? This writes to the tenant and cannot be undone from here.')) return;

    const link = getItemLink();
    const urlUpload = '/plm/upload/' + link.split('/')[4] + '/' + link.split('/')[6];

    $('#uploadForm').attr('action', urlUpload);
    $('#select-file').val('');
    $('#select-file').click();
}

function submitAttach() {
    if($('#select-file').val() === '') return;
    attachPending = true;
    $('#uploadForm').submit();
}

function showWriteGate() {
    alert('This action is gated. It is a tenant write and needs explicit approval, before-state attachment list, target folder, and rollback/export path.');
}
