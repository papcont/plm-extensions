let installedBaseWorkspaces = [];

$(document).ready(function() {
    appendOverlay(false);
    insertMenu();
    setUIEvents();
    loadInstalledBase();
});

function setUIEvents() {
    $('#refresh').click(loadInstalledBase);
}

function loadInstalledBase() {
    $('#overlay').show();

    installedBaseWorkspaces = getConfiguredWorkspaces();
    renderWorkspaces();
    loadCounters();
}

function getConfiguredWorkspaces() {
    let items = config.workspaces || [{
        key : 'assets',
        label : 'Assets',
        role : 'Installed assets'
    }, {
        key : 'assetItems',
        label : 'Asset Items',
        role : 'Asset master data'
    }, {
        key : 'assetGroups',
        label : 'Asset Groups',
        role : 'Asset grouping'
    }, {
        key : 'assetServices',
        label : 'Asset Services',
        role : 'Service events'
    }, {
        key : 'serialNumbers',
        label : 'Serial Numbers',
        role : 'Serialized instances'
    }, {
        key : 'equipments',
        label : 'Equipment',
        role : 'Equipment records'
    }, {
        key : 'equipmentServices',
        label : 'Equipment Services',
        role : 'Maintenance history'
    }];

    return items.map(function(item) {
        item.wsId = item.wsId || config.workspaceIds?.[item.key] || common.workspaceIds?.[item.key] || '';
        item.count = null;
        return item;
    });
}

function renderWorkspaces() {
    let elemGrid = $('#workspace-grid').html('');

    $('#workspace-count').html(installedBaseWorkspaces.length);
    $('#record-count').html('-');
    $('#readiness').html('Scanning');

    for(let item of installedBaseWorkspaces) {
        let elemCard = $('<div></div>').appendTo(elemGrid).addClass('workspace-card surface-level-2');

        $('<div></div>').appendTo(elemCard).addClass('workspace-role').html(item.role);
        $('<div></div>').appendTo(elemCard).addClass('workspace-title').html(item.label);
        $('<div></div>').appendTo(elemCard).addClass('workspace-meta').html(item.wsId ? 'Workspace ' + item.wsId : 'Workspace ID needed');
        $('<div></div>').appendTo(elemCard).addClass('workspace-count').html(item.wsId ? '...' : 'not configured');

        let elemActions = $('<div></div>').appendTo(elemCard).addClass('workspace-actions');
        if(item.wsId) {
            $('<a></a>').appendTo(elemActions)
                .addClass('button')
                .attr('href', '/navigator?wsId=' + item.wsId)
                .html('Navigator');
            $('<a></a>').appendTo(elemActions)
                .addClass('button')
                .attr('href', tenantLink + '/plm/workspaces/' + item.wsId)
                .attr('target', '_blank')
                .html('Fusion Manage');
        }
    }
}

function loadCounters() {
    let configuredWorkspaces = installedBaseWorkspaces.filter(item => item.wsId);
    let requests = configuredWorkspaces.map(item => $.get('/plm/workspace-counter', { wsId : item.wsId, useCache : true }));

    Promise.allSettled(requests).then(function(responses) {
        let total = 0;

        for(let index = 0; index < configuredWorkspaces.length; index++) {
            let response = responses[index];
            let data = response.status === 'fulfilled' ? response.value.data : null;
            let count = getCounter(data);
            configuredWorkspaces[index].count = count;
            total += count;
        }

        updateCounters(total);
        $('#overlay').hide();
    });
}

function getCounter(data) {
    if(typeof data?.totalCount === 'number') return data.totalCount;
    if(typeof data?.count      === 'number') return data.count;
    if(Array.isArray(data?.items)) return data.items.length;
    return 0;
}

function updateCounters(total) {
    $('#record-count').html(total);
    $('#readiness').html(total > 0 ? 'Ready' : 'Needs tenant data');

    $('#workspace-grid .workspace-card').each(function(index) {
        let count = installedBaseWorkspaces[index].count;
        $(this).find('.workspace-count').html(count === null ? 'not configured' : count + ' records');
    });
}
