let scannedWorkspaces = [];
let archetypes = [{
    name : 'Installed Base Service Cockpit',
    url  : '/installed-base-service',
    keys : ['asset', 'serial', 'equipment', 'service', 'motor', 'sensor', 'control']
}, {
    name : 'Supplier Command Center',
    url  : '/supplier-center',
    keys : ['supplier', 'spare', 'vendor', 'source', 'quote', 'package']
}, {
    name : 'Product Release Readiness Cockpit',
    url  : '/release-readiness',
    keys : ['change', 'release', 'freigabe']
}, {
    name : 'Quality Closure Cockpit',
    url  : '/quality-closure',
    keys : ['quality', 'nonconformance', 'problem', 'inspection', 'report']
}, {
    name : 'NPI Launch Readiness Board',
    url  : '/launch-readiness',
    keys : ['project', 'activity', 'deliverable', 'milestone']
}, {
    name : 'Requirements Coverage Matrix',
    url  : '/requirements-coverage',
    keys : ['requirement', 'specification', 'designreview']
}, {
    name : 'Digital Product Passport Readiness',
    url  : '/dpp-readiness',
    keys : ['carbon', 'reach', 'rohs', 'material', 'compliance', 'classification']
}, {
    name : 'Variant Governance Cockpit',
    url  : '/variant-governance',
    keys : ['variant', 'variants', 'configuration', 'option', 'konfig']
}, {
    name : 'Design Review Closure Cockpit',
    url  : '/design-review-closure',
    keys : ['design review', 'designreview', 'review task', 'markup']
}, {
    name : 'Spare Parts Request Desk',
    url  : '/spare-parts-desk',
    keys : ['spare', 'spare part', 'parts request', 'service part']
}, {
    name : 'Test And Validation Evidence Hub',
    url  : '/test-validation-hub',
    keys : ['test', 'validation', 'visi', 'meeting']
}];

$(document).ready(function() {
    appendOverlay(false);
    insertMenu();
    if(Array.isArray(config.archetypes) && config.archetypes.length > 0) archetypes = config.archetypes;
    setUIEvents();
    scanWorkspaces();
});

function setUIEvents() {
    $('#search').on('keyup', filterWorkspaces);
    $('#category').on('change', filterWorkspaces);
    $('#scan-visible').click(scanVisibleWorkspaces);
    $('#export').click(exportMarkdown);
}

function scanWorkspaces() {
    $('#overlay').show();

    $.get('/plm/workspaces', { limit : config.limit || 1000, useCache : true }, function(response) {
        scannedWorkspaces = response.data.items || [];
        for(let workspace of scannedWorkspaces) workspace.health = null;
        sortArray(scannedWorkspaces, 'title');
        renderWorkspaces();
        renderArchetypes();
        $('#overlay').hide();
    });
}

function renderWorkspaces() {
    let categories = [];
    let elemList = $('#workspace-list').html('');

    $('#workspace-count').html(scannedWorkspaces.length + ' workspace(s)');

    for(let workspace of scannedWorkspaces) {
        let category = workspace.category?.name || '';
        let workspaceId = getWorkspaceId(workspace);
        let matches = getMatches(workspace);

        if(!categories.includes(category)) categories.push(category);

        let elemTile = $('<div></div>').appendTo(elemList)
            .addClass('tile')
            .addClass('workspace')
            .attr('data-category', category)
            .attr('data-search', (workspace.title + ' ' + category + ' ' + workspace.systemName).toLowerCase())
            .click(function() {
                $(this).siblings().removeClass('selected');
                $(this).addClass('selected');
                renderDetails(workspace, matches);
                scanWorkspaceDetails(workspace);
            });

        $('<div></div>').appendTo(elemTile).addClass('tile-icon icon icon-folder');
        $('<div></div>').appendTo(elemTile).addClass('tile-title').html(workspace.title);
        $('<div></div>').appendTo(elemTile).addClass('tile-subtitle').html(category);
        $('<div></div>').appendTo(elemTile).addClass('tile-counter').html(matches.length);
        $('<div></div>').appendTo(elemTile).addClass('tile-workspace-id').html(workspaceId);
    }

    categories.sort();
    for(let category of categories) {
        $('<option></option>').appendTo($('#category')).attr('value', category).html(category);
    }

    $('#workspace-list .workspace').first().click();
}

function renderDetails(workspace, matches) {
    let elem = $('#candidate-details').html('');
    let workspaceId = getWorkspaceId(workspace);

    $('<div></div>').appendTo(elem).addClass('detail-title').html(workspace.title);
    $('<div></div>').appendTo(elem).addClass('detail-line').html('Category: ' + (workspace.category?.name || ''));
    $('<div></div>').appendTo(elem).addClass('detail-line').html('Workspace ID: ' + workspaceId);
    $('<div></div>').appendTo(elem).addClass('detail-line').html('System Name: ' + (workspace.systemName || ''));

    renderHealthSignals(elem, workspace);

    $('<div></div>').appendTo(elem).addClass('detail-section').html('Extension candidates');

    if(matches.length === 0) {
        $('<div></div>').appendTo(elem).addClass('detail-empty').html('No local archetype match yet.');
        return;
    }

    for(let match of matches) {
        $('<div></div>').appendTo(elem)
            .addClass('candidate-row')
            .html(match.name + ' [' + match.score + ']');
    }
}

function scanWorkspaceDetails(workspace) {
    if(workspace.health !== null) {
        renderDetails(workspace, getMatches(workspace));
        return;
    }

    let workspaceId = getWorkspaceId(workspace);
    let requests = [
        $.get('/plm/workspace-counter'              , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-scripts'              , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-all-relationships'    , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-workflow-states'      , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-workflow-transitions' , { wsId : workspaceId, useCache : true })
    ];

    Promise.allSettled(requests).then(function(results) {
        workspace.health = getHealthFromResults(results);

        updateWorkspaceTile(workspace);
        renderDetails(workspace, getMatches(workspace));
        renderArchetypes();
    });
}

function scanVisibleWorkspaces() {
    let visibleIds = $('#workspace-list .workspace:not(.hidden)').map(function() {
        return $(this).find('.tile-workspace-id').html();
    }).get();

    let queue = scannedWorkspaces.filter(function(workspace) {
        return visibleIds.includes(getWorkspaceId(workspace)) && workspace.health === null;
    });

    if(queue.length === 0) return;

    scanNextWorkspace(queue, 0);
}

function scanNextWorkspace(queue, index) {
    if(index >= queue.length) {
        $('#scan-visible').removeClass('disabled').html('Scan Visible');
        renderArchetypes();
        return;
    }

    $('#scan-visible').addClass('disabled').html((index + 1) + ' / ' + queue.length);

    let workspace = queue[index];
    let workspaceId = getWorkspaceId(workspace);
    let requests = [
        $.get('/plm/workspace-counter'              , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-scripts'              , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-all-relationships'    , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-workflow-states'      , { wsId : workspaceId, useCache : true }),
        $.get('/plm/workspace-workflow-transitions' , { wsId : workspaceId, useCache : true })
    ];

    Promise.allSettled(requests).then(function(results) {
        workspace.health = getHealthFromResults(results);
        updateWorkspaceTile(workspace);
        scanNextWorkspace(queue, index + 1);
    });
}

function renderHealthSignals(elem, workspace) {
    $('<div></div>').appendTo(elem).addClass('detail-section').html('Read-only signals');

    if(workspace.health === null) {
        $('<div></div>').appendTo(elem).addClass('detail-empty').html('Loading workspace signals...');
        return;
    }

    let signals = [
        ['Items', workspace.health.itemCount],
        ['Scripts', workspace.health.scripts.length],
        ['Relationships', workspace.health.relationships],
        ['Workflow states', workspace.health.states.length],
        ['Workflow transitions', workspace.health.transitions.length]
    ];

    for(let signal of signals) {
        $('<div></div>').appendTo(elem)
            .addClass('signal-row')
            .html('<span>' + signal[0] + '</span><strong>' + signal[1] + '</strong>');
    }
}

function renderArchetypes() {
    let rows = archetypes.map(archetype => {
        let matches = scannedWorkspaces.filter(workspace => getScore(workspace, archetype) > 0);
        let score = matches.reduce(function(total, workspace) {
            return total + getScore(workspace, archetype);
        }, 0);
        return { archetype, matches, score };
    }).sort((a, b) => b.score - a.score);

    let elem = $('#archetype-list').html('');

    for(let row of rows) {
        let line = $('<div></div>').appendTo(elem).addClass('archetype-row');
        $('<div></div>').appendTo(line).addClass('archetype-title').html(row.archetype.name);
        $('<div></div>').appendTo(line).addClass('archetype-score').html(row.score);
        $('<div></div>').appendTo(line).addClass('archetype-workspaces').html(row.matches.map(workspace => workspace.title).join(', ') || '-');
    }
}

function getMatches(workspace) {
    return archetypes
        .map(archetype => ({ name : archetype.name, score : getScore(workspace, archetype) }))
        .filter(match => match.score > 0)
        .sort((a, b) => b.score - a.score);
}

function getScore(workspace, archetype) {
    let text = getWorkspaceText(workspace);
    let score = archetype.keys.filter(key => text.indexOf(key) >= 0).length;

    if(workspace.health !== null) {
        if(workspace.health.itemCount     > 0) score++;
        if(workspace.health.states.length > 0) score++;
        if(workspace.health.relationships > 0) score++;
    }

    return score;
}

function getWorkspaceText(workspace) {
    return [
        workspace.title,
        workspace.systemName,
        workspace.description,
        workspace.category?.name
    ].join(' ').toLowerCase();
}

function getWorkspaceId(workspace) {
    if(!isBlank(workspace.link)) return workspace.link.split('/').pop();
    if(!isBlank(workspace.urn)) return workspace.urn.split('.').pop();
    return '';
}

function filterWorkspaces() {
    let search = $('#search').val().toLowerCase();
    let category = $('#category').val();

    $('#workspace-list .workspace').each(function() {
        let matchesSearch = isBlank(search) || $(this).attr('data-search').indexOf(search) >= 0;
        let matchesCategory = category === '---' || $(this).attr('data-category') === category;
        $(this).toggleClass('hidden', !matchesSearch || !matchesCategory);
    });
}

function exportMarkdown() {
    let lines = ['# Workspace Health Scan', '', 'Tenant: ' + tenant, ''];

    for(let workspace of scannedWorkspaces) {
        let matches = getMatches(workspace).map(match => match.name + ' [' + match.score + ']').join(', ') || '-';
        lines.push('- ' + workspace.title + ': ' + matches);
        if(workspace.health !== null) {
            lines.push('  - items: ' + workspace.health.itemCount);
            lines.push('  - scripts: ' + workspace.health.scripts.length);
            lines.push('  - relationships: ' + workspace.health.relationships);
            lines.push('  - states: ' + workspace.health.states.length);
            lines.push('  - transitions: ' + workspace.health.transitions.length);
        }
    }

    let blob = new Blob([lines.join('\n')], { type : 'text/markdown' });
    let link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'workspace-health-' + tenant + '.md';
        link.click();
}

function getResponseData(result) {
    if(result.status !== 'fulfilled') return null;
    return result.value.data;
}

function getRelationshipCount(data) {
    if(data === null) return 0;
    if(Array.isArray(data)) return data.length;
    if(Array.isArray(data.workspaces)) return data.workspaces.length;
    return Object.keys(data).reduce(function(total, key) {
        return total + (Array.isArray(data[key]) ? data[key].length : 0);
    }, 0);
}

function getHealthFromResults(results) {
    return {
        itemCount     : getResponseData(results[0])?.totalCount || 0,
        scripts       : getResponseData(results[1])?.scripts || [],
        relationships : getRelationshipCount(getResponseData(results[2])),
        states        : getResponseData(results[3])?.states || [],
        transitions   : getResponseData(results[4]) || []
    };
}

function updateWorkspaceTile(workspace) {
    let workspaceId = getWorkspaceId(workspace);

    $('#workspace-list .workspace').each(function() {
        if($(this).find('.tile-workspace-id').html() === workspaceId) {
            $(this).find('.tile-counter').html(getMatches(workspace).length);
        }
    });
}
