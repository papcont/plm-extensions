// Variant BOM Editor - Phase 1 skeleton.
// Loads config, resolves the working workspace/BOM view, opens the launched item.
// Variant logic (swap node, upward propagation, fingerprint dedup) lands in phases 2-4.

let vb = {
    ws        : { id : '', bomView : '' },   // resolved item workspace + BOM view name
    fieldIds  : {},                          // NUMBER / VARIANT_ALLOWED / BOM_FINGERPRINT
    itemLink  : '',                          // '/api/v3/workspaces/<wsId>/items/<dmsId>'
    root      : null,                        // launched assembly { link, number, variantAllowed }
    selected  : null,                        // BOM node currently being replaced
    materials : null,                        // cached material picklist labels (Phase 8)
    flagged   : null,                        // { dmsId: true } of VARIANT_ALLOWED items (gates node selection)
    swaps     : {}                           // edgeId -> { mode, fromLink, fromTitle, toLink/material, row }
};


$(document).ready(function() {

    vb.ws.id     = config.workspaceItems.workspaceId || common.workspaceIds.items;
    vb.ws.bomView = config.workspaceItems.bomViewName || common.workspaces.items.defaultBOMView;
    vb.fieldIds  = config.fieldIds;

    appendOverlay(true);
    setUIEvents();

    loadMaterials();

    getFeatureSettings('variants-bom', [], function() {

        if(isBlank(dmsId)) {
            $('#header-subtitle').html('Open an assembly to start editing variants.');
        } else {
            vb.itemLink = '/api/v3/workspaces/' + wsId + '/items/' + dmsId;
            openAssembly(vb.itemLink);
        }

    });

});


function setUIEvents() {

    $('#button-save').click(function() {
        if($(this).hasClass('disabled')) return;
        saveVariant();
    });

    $('#button-toggle-details').click(function() {
        $('body').toggleClass('no-details');
        $(this).toggleClass('filled');
    });

    $('#button-filter-variants').click(function() {
        let on = !$('body').hasClass('variant-filter');
        $('body').toggleClass('variant-filter', on);
        $(this).toggleClass('filled', on);
        if(on) ensureVariantFlags();
    });

}


// Tag every BOM row whose item is VARIANT_ALLOWED with class .variant-allowed.
// Used by the filter (CSS hides the rest) and by the fingerprint tree builder.
// One indexed /plm/search (comparator 13 = boolean-is-true) returns the flagged dmsIds for
// the whole workspace; we intersect by data-dmsid. Scales to thousand-row BOMs (Trancheur).
// ponytail: matches by dmsId (the exact item version the BOM references). Ceiling: if a flag
// lives on a different revision than the one in the BOM, match by NUMBER instead.
function ensureVariantFlags(callback) {

    $.post('/plm/search', {
        wsId   : vb.ws.id,
        fields : [ vb.fieldIds.number ],
        filter : [{ field : vb.fieldIds.variantAllowed, type : 0, comparator : 13, value : 'true' }]
    }).done(function(r) {
        let flagged = {};
        let rows = (r.data && r.data.row) ? r.data.row : [];
        for(let row of rows) flagged[row.dmsId] = true;

        vb.flagged = flagged;   // cached for the selection gate (selectNodeForSwap)

        $('#bom tr[data-dmsid]').each(function() {
            if(flagged[$(this).attr('data-dmsid')]) $(this).addClass('variant-allowed');
        });

        if(callback) callback();
    }).fail(function() { if(callback) callback(); });

}


// Load the launched assembly: render its BOM tree, show item details on node click.
// Node swapping + upward propagation + fingerprint dedup land in phases 2b-4.
function openAssembly(link) {

    $.get('/plm/details', { link : link }, function(response) {

        $('#header-subtitle').html(response.data.title);
        document.title = documentTitle + ': ' + response.data.title;

        let rootAllowed = getSectionFieldValue(response.data.sections, vb.fieldIds.variantAllowed);
        vb.root = {
            link           : link,
            number         : getSectionFieldValue(response.data.sections, vb.fieldIds.number),
            variantAllowed : (rootAllowed === true || rootAllowed === 'true'),
            fingerprint    : getSectionFieldValue(response.data.sections, vb.fieldIds.bomFingerprint)   // '' if none yet
        };

        insertBOM(link, {
            id               : 'bom',
            headerLabel      : 'BOM',
            bomViewName      : vb.ws.bomView,
            depth            : config.maxBOMLevels,
            quantity         : true,
            search           : true,
            toggles          : true,
            path             : true,
            hideDetails      : false,
            collapseContents : true,
            onClickItem      : function(elemClicked) { selectNodeForSwap(elemClicked); },
            afterCompletion  : function(id, data) { onBOMLoaded(id, data); }
        });

        insertViewer(link, { features : config.viewerFeatures });

        $('#overlay').hide();

    });

}


// Load the material picklist once (labels only) and cache on vb.materials.
// Live values from CUSTOM_LOOKUP_MATERIAL - no hard-coded presets. Shape per Tenant Comparison:
// response.data.picklist.values[].label.
function loadMaterials(callback) {
    if(vb.materials !== null) { if(callback) callback(); return; }   // cached (incl. empty picklist)
    $.get('/plm/picklist-setup', { id : config.materialPicklistId, useCache : true }).done(function(r) {
        let values    = (r.data && r.data.picklist && r.data.picklist.values) ? r.data.picklist.values : [];
        vb.materials  = values.map(v => v.label);
        if(callback) callback();
    }).fail(function() { vb.materials = null; if(callback) callback(); });   // leave null -> retry on next select
}


// A BOM node was clicked: remember it, then offer BOTH ways to vary it -
//   (a) change its MATERIAL -> a material-variant leaf (Phase 8), or
//   (b) replace it with an existing part (the original swap picker).
function selectNodeForSwap(elemClicked) {

    let link = elemClicked.attr('data-link');
    if(isBlank(link)) return;

    // Selection gate: only VARIANT_ALLOWED items are variation points. Fail-open while the flag
    // search is still in flight (vb.flagged === null) - the gate is UX guidance, not a hard lock.
    let dmsId = elemClicked.attr('data-dmsid');
    if(vb.flagged !== null && !vb.flagged[dmsId]) {
        $('#bom tr.swap-selected').removeClass('swap-selected');
        elemClicked.addClass('swap-selected');
        let elem = $('#item').removeClass().addClass('surface-level-3').html('');
        $('<div></div>').appendTo(elem).css({ padding : '16px', opacity : 0.75 })
            .html('"' + (elemClicked.attr('data-part-number') || 'This item') + '" is not marked variant-eligible ' +
                  '(VARIANT_ALLOWED). Flag it to vary it.');
        return;
    }

    vb.selected = {
        row         : elemClicked,
        link        : link,
        edgeId      : elemClicked.attr('data-edgeid'),
        partNumber  : elemClicked.attr('data-part-number'),
        title       : elemClicked.attr('data-title'),
        materialart : ''   // filled from the part's details below (part of the leaf identity)
    };

    $('#bom tr.swap-selected').removeClass('swap-selected');
    elemClicked.addClass('swap-selected');

    // Rebuild #item: material selector on top, existing-part picker mounted in #vb-replace below.
    let elem = $('#item').removeClass().addClass('surface-level-3').html('');
    let box  = $('<div></div>').appendTo(elem).addClass('vb-material-box').css({ padding : '12px' });
    $('<div></div>').appendTo(box).css({ marginBottom : '6px', fontWeight : 'bold' })
        .html('Change material of "' + vb.selected.partNumber + '"');
    let select = $('<select></select>').appendTo(box).attr('id', 'vb-material').css({ width : '100%' });
    $('<option></option>').appendTo(select).val('').html('- select material -');
    for(let label of (vb.materials || [])) $('<option></option>').appendTo(select).val(label).html(label);
    $('<div></div>').appendTo(box).addClass('button').addClass('default').css({ marginTop : '8px' })
        .html('Apply material')
        .click(function() { recordMaterialSwap($('#vb-material').val()); });

    $('<div></div>').appendTo(elem).attr('id', 'vb-replace');

    // Prefill the current material and grab MATERIALART (identity component). Best-effort.
    $.get('/plm/details', { link : link, useCache : true }).done(function(r) {
        vb.selected.materialart = getSectionFieldValue(r.data.sections, vb.fieldIds.materialart) || '';
        let current = getSectionFieldValue(r.data.sections, vb.fieldIds.material) || '';
        if(current) $('#vb-material').val(current);
    });

    // Component picker scoped to the item workspace; click a result to record a replace swap.
    insertWorkspaceSearch(vb.ws.id, {
        id             : 'vb-replace',
        headerLabel    : 'or replace "' + vb.selected.partNumber + '" with',
        searchInFields : ['DESCRIPTOR'],
        tileTitle      : 'DESCRIPTOR',
        tileSubtitle   : vb.fieldIds.number,
        onClickItem    : function(picked) { recordSwap(picked); }
    });

}


// Record a MATERIAL variation on the selected node and mark the row dirty (mode 'material').
function recordMaterialSwap(material) {

    if(vb.selected === null) return;
    if(isBlank(material)) return;

    vb.swaps[vb.selected.edgeId] = {
        mode        : 'material',
        fromLink    : vb.selected.link,
        fromNumber  : vb.selected.partNumber,   // same source computeFingerprint() uses for the leaf
        fromTitle   : vb.selected.title,
        materialart : vb.selected.materialart || '',
        material    : material,
        row         : vb.selected.row
    };

    let row = vb.selected.row;
    row.addClass('swapped');
    row.find('.swap-badge').remove();
    $('<span></span>').addClass('swap-badge').html(' → Material: ' + material).appendTo(row.find('.tree-descriptor'));

    $('#button-save').removeClass('disabled');
}


// Record the chosen replacement for the selected node and mark the row dirty (mode 'replace').
function recordSwap(picked) {

    if(vb.selected === null) return;

    let toLink = picked.attr('data-link');
    if(isBlank(toLink)) return;

    let toTitle = picked.attr('data-descriptor') || picked.attr('data-title') || toLink;

    // Same part picked -> nothing to swap; clear any prior swap on this node.
    if(toLink === vb.selected.link) { clearSwap(vb.selected.edgeId); return; }

    vb.swaps[vb.selected.edgeId] = {
        mode      : 'replace',
        fromLink  : vb.selected.link,
        fromTitle : vb.selected.title,
        toLink    : toLink,
        toTitle   : toTitle,
        row       : vb.selected.row
    };

    let row = vb.selected.row;
    row.addClass('swapped');
    row.find('.swap-badge').remove();
    $('<span></span>').addClass('swap-badge').html(' → ' + toTitle).appendTo(row.find('.tree-descriptor'));

    $('#button-save').removeClass('disabled');
}


function clearSwap(edgeId) {
    let swap = vb.swaps[edgeId];
    if(swap) {
        swap.row.removeClass('swapped').find('.swap-badge').remove();
        delete vb.swaps[edgeId];
    }
    if(Object.keys(vb.swaps).length === 0) $('#button-save').addClass('disabled');
}


// =====================================================================================
// Phase 3 - Fingerprint engine (pure functions + DOM tree builder)
// =====================================================================================

// Stable 64-bit FNV-1a as 16 hex chars.
// ponytail: not cryptographic. If fingerprint collisions ever matter, swap for SHA-256
// via crypto.subtle (async). At this scale FNV-1a is more than enough.
function fpHash(str) {
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask  = 0xffffffffffffffffn;
    for(let i = 0; i < str.length; i++) {
        h ^= BigInt(str.charCodeAt(i));
        h = (h * prime) & mask;
    }
    return h.toString(16).padStart(16, '0');
}

function normalizeQty(q) {
    let n = parseFloat(q);
    return isNaN(n) ? String(q) : String(n);   // "1.0" and "1" collapse to "1"
}

// Recursive structural fingerprint.
//   leaf     -> its NUMBER (identity)
//   assembly -> hash of sorted (childFingerprint "x" quantity)
// Order-independent, quantity-sensitive, fully recursive: one differing screw deep down
// changes its leaf fingerprint and therefore every ancestor's fingerprint. The assembly's
// OWN number is intentionally ignored - that is what lets two structurally identical
// assemblies dedup regardless of their own item numbers.
function computeFingerprint(node) {
    if(!node.children || node.children.length === 0) return node.number;
    let parts = node.children.map(c => computeFingerprint(c) + '×' + normalizeQty(c.quantity));
    parts.sort();
    return fpHash(parts.join('|'));
}

// Path root..node whose incoming edge == edgeId (root.edgeId is null).
function findPathByEdge(node, edgeId, acc) {
    acc = acc.concat([node]);
    if(node.edgeId === edgeId) return acc;
    for(let c of (node.children || [])) {
        let r = findPathByEdge(c, edgeId, acc);
        if(r) return r;
    }
    return null;
}

// Bottom-up list of assemblies that become new variants after a swap at edgeId: the swapped
// node's parent up to the opened root. Every ancestor is taken along automatically - the flag
// lives on the varied PART, not on the assemblies, so there is no per-assembly gate here.
function affectedChain(tree, edgeId) {
    let path = findPathByEdge(tree, edgeId, []);
    if(!path) return { chain : [], warning : 'Swapped node not found in the BOM tree.' };
    return { chain : path.slice(0, -1).reverse(), warning : null };   // nearest parent first, up to root
}

// Build the fingerprint tree from the rendered BOM rows. Structure/qty/number come from the
// DOM (data-*), VARIANT_ALLOWED from the .variant-allowed class (run ensureVariantFlags first).
// Root node is synthesised from the launched assembly (vb.root); its children are the top-level rows.
// ponytail: hierarchy keyed by data-number-path (part-number chain). Ceiling: breaks only if the
// exact same part appears twice under the SAME parent - switch to edgeId-based nesting if that happens.
function buildTreeFromDOM() {
    let byPath = {};

    $('#bom tr[data-link]').each(function() {
        let row  = $(this);
        let path = row.attr('data-number-path');
        byPath[path] = {
            number         : row.attr('data-part-number'),
            quantity       : row.attr('data-quantity'),
            edgeId         : parseInt(row.attr('data-edgeid'), 10),
            link           : row.attr('data-link'),
            variantAllowed : row.hasClass('variant-allowed'),
            children       : []
        };
    });

    let root = {
        number         : vb.root ? vb.root.number : null,
        quantity       : '1',
        edgeId         : null,
        link           : vb.root ? vb.root.link : null,
        variantAllowed : vb.root ? vb.root.variantAllowed : false,
        children       : []
    };

    for(let path in byPath) {
        let segs       = path.split('|');
        let parentPath = segs.slice(0, -1).join('|');
        if(byPath[parentPath]) byPath[parentPath].children.push(byPath[path]);
        else                   root.children.push(byPath[path]);   // top-level: parent is the launched root
    }

    return root;
}

// Runnable self-check. Call variantsBomSelfTest() from the console; throws on failure.
function variantsBomSelfTest() {
    let leaf = (num) => ({ number : num, children : [] });
    let asm  = (children) => ({ number : 'ASM', children : children });
    let qc   = (n, q) => Object.assign(leaf(n), { quantity : q });

    // identical structure -> identical fingerprint (order-independent)
    let a = asm([ qc('P1', '1'), qc('P2', '2'), qc('SCREW', '12') ]);
    let b = asm([ qc('SCREW', '12'), qc('P2', '2'), qc('P1', '1') ]);
    console.assert(computeFingerprint(a) === computeFingerprint(b), 'FAIL: order should not matter');

    // one screw different -> different fingerprint
    let c = asm([ qc('P1', '1'), qc('P2', '2'), qc('SCREW_STEEL', '12') ]);
    console.assert(computeFingerprint(a) !== computeFingerprint(c), 'FAIL: differing child must change fingerprint');

    // quantity change -> different fingerprint
    let d = asm([ qc('P1', '1'), qc('P2', '2'), qc('SCREW', '11') ]);
    console.assert(computeFingerprint(a) !== computeFingerprint(d), 'FAIL: differing quantity must change fingerprint');

    // "1.0" and "1" are the same quantity
    let e = asm([ qc('P1', '1.0'), qc('P2', '2'), qc('SCREW', '12') ]);
    console.assert(computeFingerprint(a) === computeFingerprint(e), 'FAIL: 1.0 and 1 must be equal');

    // nested: deep leaf change bubbles up
    let sub1 = { number : 'SUB', quantity : '1', children : [ qc('X', '1') ] };
    let sub2 = { number : 'SUB', quantity : '1', children : [ qc('Y', '1') ] };
    let n1 = asm([ sub1, qc('P1', '1') ]);
    let n2 = asm([ sub2, qc('P1', '1') ]);
    console.assert(computeFingerprint(n1) !== computeFingerprint(n2), 'FAIL: nested change must bubble up');

    // Phase 8: material identity is deterministic per (number|material|materialart) and material-sensitive.
    let steel = { mode : 'material', fromNumber : 'PIPE', material : 'Stahl', materialart : 'Rohr' };
    let alu   = { mode : 'material', fromNumber : 'PIPE', material : 'Aluminium', materialart : 'Rohr' };
    console.assert(vbSwapIdentity(steel) === vbSwapIdentity({ mode : 'material', fromNumber : 'PIPE', material : 'Stahl', materialart : 'Rohr' }), 'FAIL: material identity must be deterministic');
    console.assert(vbSwapIdentity(steel) !== vbSwapIdentity(alu), 'FAIL: different material must change identity');
    console.assert(vbSwapIdentity(steel) !== 'PIPE', 'FAIL: material variant must differ from the base leaf number');

    console.log('variantsBomSelfTest: all assertions passed');
    return true;
}


// =====================================================================================
// Phase 4 - Dedup + bottom-up variant creation (writes to the tenant)
// =====================================================================================

// PLM helpers -------------------------------------------------------------------------

function vbGetItemNumber(link) {
    return $.get('/plm/details', { link : link, useCache : true }).then(function(r) {
        return getSectionFieldValue(r.data.sections, vb.fieldIds.number);
    });
}

// Find an existing item carrying this exact BOM fingerprint. Returns { link, number } or null.
function vbFindByFingerprint(fp) {
    return $.post('/plm/search', {
        wsId   : vb.ws.id,
        fields : [ vb.fieldIds.number, vb.fieldIds.bomFingerprint ],
        filter : [{ field : vb.fieldIds.bomFingerprint, type : 0, comparator : 15, value : fp }]
    }).then(function(r) {
        let rows = (r.data && r.data.row) ? r.data.row : [];
        if(rows.length === 0) return null;
        return {
            link   : '/api/v3/workspaces/' + vb.ws.id + '/items/' + rows[0].dmsId,
            number : getSearchResultFieldValue(rows[0], vb.fieldIds.number, '')
        };
    });
}

// Shallow clone (item + direct BOM edges, NUMBER reset for auto-numbering). Returns new item link.
// Posts JSON, not urlencoded: the shared cloneItems() sends form-encoded, and qs turns any section
// with >20 fields into an object, which the /plm/clone handler's `for...of` then throws on (HTML 500).
// ponytail: self-contained JSON clone avoids that; leave the shared helper untouched.
function vbCloneAssembly(link) {
    return $.get('/plm/details', { link : link }).then(function(d) {

        let params = { link : link, options : ['ITEM_DETAILS', 'BOM_LIST'], sections : [] };

        for(let section of d.data.sections) {
            let linkBase    = section.link.split('/items/')[0];
            let linkSection = linkBase + section.link.split('/views/1')[1];
            let sect        = { link : linkSection, fields : [] };

            if(section.hasOwnProperty('classificationId')) sect.classificationId = section.classificationId;

            for(let field of section.fields) {
                let fieldId = field.__self__.split('/')[10];
                if(fieldId === vb.fieldIds.number) field.value = '';   // blank -> new auto-number
                sect.fields.push({
                    fieldId       : fieldId,
                    fieldMetadata : null,
                    title         : field.title,
                    typeId        : Number(field.type.link.split('/')[4]),
                    value         : field.value
                });
            }

            params.sections.push(sect);
        }

        return $.ajax({ url : '/plm/clone', method : 'POST', contentType : 'application/json', data : JSON.stringify(params) });

    }).then(function(r) {
        if(isBlank(r.data)) throw 'clone failed for ' + link;
        return r.data.split('.autodeskplm360.net')[1];
    });
}

// Write a set of fields on an item in one /plm/edit. fields: [{ id, value }].
function vbEditFields(link, fields) {
    let payload = { link : link, sections : [] };
    for(let f of fields) addFieldToPayload(payload.sections, vb.wsSections, null, f.id, f.value);
    return $.post('/plm/edit', payload);
}

// Stamp the canonical fingerprint AND mark the item as a variant (IS_VARIANT=true).
// Used for both generated leaves and generated assemblies.
function vbStampFingerprint(link, fp) {
    return vbEditFields(link, [
        { id : vb.fieldIds.bomFingerprint, value : fp   },
        { id : vb.fieldIds.isVariant,      value : true }
    ]);
}

// Identity a swapped child contributes to its parent's fingerprint.
//   replace  -> the replacement part's NUMBER
//   material -> a synthetic leaf id over (baseNumber | material | materialart), so a material
//               change alters every ancestor fingerprint just like a structural swap does.
function vbSwapIdentity(swap) {
    if(swap.mode === 'material') return 'MAT:' + fpHash(swap.fromNumber + '|' + swap.material + '|' + swap.materialart);
    return swap.toNumber;
}

// The BOM_FINGERPRINT stored on a material-variant leaf (also the leaf-dedup search key).
function vbLeafFingerprint(swap) {
    return fpHash(swap.fromNumber + '|' + swap.material + '|' + swap.materialart);
}


// Planning (read-only) ----------------------------------------------------------------

// Annotate each node with _changed and _fp. A node is changed if a direct child edge is
// swapped or any descendant changed. _fp is the fingerprint of the post-swap composition.
function vbPlanFingerprints(node) {
    let changed = false;
    let entries = [];

    for(let c of node.children) {
        let cfp;
        if(vb.swaps[c.edgeId]) {
            cfp = vbSwapIdentity(vb.swaps[c.edgeId]);   // replace -> NUMBER; material -> synthetic leaf id
            changed = true;
        } else if(c.children && c.children.length) {
            let r = vbPlanFingerprints(c);
            cfp = r.fp;
            if(r.changed) changed = true;
        } else {
            cfp = c.number;
        }
        entries.push(cfp + '×' + normalizeQty(c.quantity));
    }

    node._changed = changed;
    node._fp      = changed ? fpHash(entries.slice().sort().join('|')) : computeFingerprint(node);
    return { changed : changed, fp : node._fp };
}

// Bottom-up list of changed assemblies (post-order).
function vbCollectChanged(node, acc) {
    for(let c of node.children) vbCollectChanged(c, acc);
    if(node._changed) acc.push(node);
    return acc;
}


// Orchestration -----------------------------------------------------------------------

async function saveVariant() {

    appendOverlay(false);

    try {

        await new Promise(res => ensureVariantFlags(res));

        vb.wsSections = (await $.get('/plm/sections', { wsId : vb.ws.id, useCache : true })).data;

        let tree = buildTreeFromDOM();

        // Resolve each swap so its parent fingerprint can be computed.
        //   replace  -> read the replacement's NUMBER
        //   material -> compute the leaf fingerprint and look for an existing identical leaf (dedup)
        for(let edgeId in vb.swaps) {
            let s = vb.swaps[edgeId];
            if(s.mode === 'material') {
                s._leafFp       = vbLeafFingerprint(s);
                s._leafExisting = await vbFindByFingerprint(s._leafFp);
            } else {
                s.toNumber = await vbGetItemNumber(s.toLink);
            }
        }

        vbPlanFingerprints(tree);

        let changed = vbCollectChanged(tree, []);

        if(changed.length === 0) { $('#overlay').hide(); return; }

        // Model: VARIANT_ALLOWED marks the variation-point PARTS (what may be varied). Every assembly
        // from a varied part up to the opened root is taken along automatically (new variant + marker) -
        // no per-assembly flag, no block. `changed` already holds exactly that chain (structural).

        // Dedup search per changed assembly.
        for(let n of changed) n._existing = await vbFindByFingerprint(n._fp);

        $('#overlay').hide();
        vbShowPlan(tree, changed);

    } catch(e) {
        $('#overlay').hide();
        console.log('variants-bom saveVariant error', e);
        showErrorMessage('Save failed', 'Could not prepare the variant. Details are in the browser console.');
    }
}

// Render the plan into #item with a confirm button. No writes yet.
function vbShowPlan(tree, changed) {

    let elem = $('#item').removeClass().addClass('surface-level-3').html('');

    $('<div></div>').appendTo(elem).addClass('panel-header').html('Variant Plan');

    let body = $('<div></div>').appendTo(elem).addClass('panel-content').css({ padding : '16px', overflow : 'auto' });

    // Material-variant leaves (Phase 8): created/reused before the assemblies that use them.
    for(let edgeId in vb.swaps) {
        let s = vb.swaps[edgeId];
        if(s.mode !== 'material') continue;
        let line = $('<div></div>').appendTo(body).css({ margin : '6px 0' });
        if(s._leafExisting) line.html('↻ Reuse <b>' + s._leafExisting.number + '</b> as ' + s.material + ' variant of "' + s.fromNumber + '"');
        else                line.html('＋ Create ' + s.material + ' variant of <b>' + s.fromNumber + '</b>');
    }

    for(let n of changed) {
        let line = $('<div></div>').appendTo(body).css({ margin : '6px 0' });
        if(n._existing) {
            line.html('↻ Reuse existing <b>' + n._existing.number + '</b> for "' + n.number + '" (identical BOM)');
        } else {
            line.html('＋ Create new variant of <b>' + n.number + '</b>');
        }
    }

    let reuseCount  = changed.filter(n => n._existing).length;
    let createCount = changed.length - reuseCount;

    $('<div></div>').appendTo(body).css({ margin : '12px 0', opacity : 0.7 })
        .html(createCount + ' to create, ' + reuseCount + ' to reuse.');

    $('<div></div>').appendTo(body)
        .addClass('button').addClass('default').addClass('with-icon').addClass('icon-create')
        .html('Confirm & Create')
        .click(function() { vbExecutePlan(tree, changed); });
}

// Execute the plan bottom-up: clone/replace/stamp for creates, thread resolved links upward.
async function vbExecutePlan(tree, changed) {

    appendOverlay(false);

    let resolved = {};   // original item link -> resolved variant/existing link

    try {

        // Resolve material swaps to a concrete leaf link first (reuse or clone->set MATERIAL->stamp).
        // The assembly loop below then treats swap.toLink uniformly, exactly like a replace swap.
        for(let edgeId in vb.swaps) {
            let s = vb.swaps[edgeId];
            if(s.mode !== 'material') continue;

            if(s._leafExisting) { s.toLink = s._leafExisting.link; continue; }

            let leaf   = await vbCloneAssembly(s.fromLink);   // works for leaves too (shallow clone)
            let fields = [{ id : vb.fieldIds.material, value : s.material }];
            // ponytail: 'keep' (same NUMBER, only MATERIAL differs) resets the number but does NOT make
            // regular leaves carry material in their identity -> cross-assembly dedup stays number-only.
            // That is the documented O(n) ceiling; 'new' is primary. Upgrade: add material to leaf identity.
            if(config.materialVariantNumbering === 'keep') fields.push({ id : vb.fieldIds.number, value : s.fromNumber });
            await vbEditFields(leaf, fields);
            await vbStampFingerprint(leaf, s._leafFp);   // BOM_FINGERPRINT = leaf fp + IS_VARIANT=true
            s.toLink = leaf;
        }

        for(let n of changed) {

            if(n._existing) { resolved[n.link] = n._existing.link; continue; }

            let cloneLink = await vbCloneAssembly(n.link);

            let prev = [], next = [];
            for(let c of n.children) {
                let newLink = null;
                if(vb.swaps[c.edgeId])      newLink = vb.swaps[c.edgeId].toLink;
                else if(resolved[c.link])   newLink = resolved[c.link];
                if(newLink && newLink !== c.link) { prev.push(c.link); next.push(newLink); }
            }

            if(prev.length) await new Promise(res => replaceBOMItems(cloneLink, prev, next, res));

            await vbStampFingerprint(cloneLink, n._fp);

            resolved[n.link] = cloneLink;
        }

        let topLink = resolved[tree.link];

        $('#overlay').hide();

        showSuccessMessage('Variant created',
            'Done. Created ' + changed.filter(n => !n._existing).length + ' new item(s), reused ' +
            changed.filter(n => n._existing).length + '. New top assembly: ' + (topLink || '(unchanged)'));

        vb.swaps = {};
        $('#button-save').addClass('disabled');
        if(topLink) openItemByLink(topLink);

    } catch(e) {
        $('#overlay').hide();
        console.log('variants-bom execute error', e);
        showErrorMessage('Creation failed', 'Some items may have been created. Details are in the browser console.');
    }
}


// BOM fully rendered (also fires on view change / reload). Always resolve the VARIANT_ALLOWED
// flags (one indexed search) so the selection gate knows which nodes are variation points -
// not just when the filter is on.
function onBOMLoaded(id, data) {
    ensureVariantFlags();
    lazyStampOriginal();
}


// Lazy fingerprint backfill. The first time an un-fingerprinted assembly is opened, stamp its
// BOM_FINGERPRINT (NOT IS_VARIANT - an opened original is not a generated variant) so later dedup
// searches can also match hand-built originals, not just tool-created variants. One edit per
// assembly, only when the field is empty - no bulk backfill, grows through normal use.
async function lazyStampOriginal() {
    if(!vb.root || isBlank(vb.root.link)) return;
    if(!isBlank(vb.root.fingerprint)) return;                   // already fingerprinted (or a tool variant)

    let tree = buildTreeFromDOM();
    if(!tree.children || tree.children.length === 0) return;    // a leaf has no assembly fingerprint

    let fp = computeFingerprint(tree);
    vb.root.fingerprint = fp;                                   // optimistic: blocks re-entry on view reloads

    try {
        if(!vb.wsSections) vb.wsSections = (await $.get('/plm/sections', { wsId : vb.ws.id, useCache : true })).data;
        await vbEditFields(vb.root.link, [{ id : vb.fieldIds.bomFingerprint, value : fp }]);
    } catch(e) {
        vb.root.fingerprint = '';                               // failed -> allow a later retry
        console.log('variants-bom lazy-stamp skipped', e);
    }
}
