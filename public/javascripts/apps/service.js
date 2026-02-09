/* =================================================================================================
 *  SERVICE.JS (robust / cleaned)
 *  - works for EBOM selectedItems, SBOM bomPartsList, and custom requests (missing details)
 *  - avoids crashes on undefined strings
 *  - prevents duplicate cart items by root
 *  - idempotent stock rendering
 *  - fixes finishSparePartsList() icon typo (icong -> icon)
 *  - dedupes /plm/details calls for images (optional, but enabled)
 * ================================================================================================= */

/* ---------- Globals ---------- */

let fields, sections, bomViewIdItems;
let workspaceIds = {};
let links = {};
let urns  = {
  thumbnail     : '',
  partNumber    : '',
  title         : '',
  description   : '',
  spareWearPart : '',
  material      : '',
  mass          : '',
  dimensions    : ''
};

let listServiceItems      = { spareParts : [], kit : [], offering : [], wearParts : [] };
let wsProblemReports      = { id : '', sections : [], fields : [] };
let wsSparePartsRequests  = { id : '', sections : [], fields : [] };

let paramsItemDetails     = {};
let paramsItemAttachments = {};
let paramsDocumentation   = {};

let paramsProcesses = {
  hideHeader               : true,
  createWSID               : '',
  createHeaderLabel        : 'Create Problem Report',
  createContextItemFields  : ['AFFECTED_ITEM'],
  createViewerImageFields  : [],
  editable                 : true,
  fieldIdMarkup            : '',
  openInPLM                : true,
  reload                   : true,
  contentSize              : 'm',
  singleToolbar            : 'actions'
};


/* -------------------------------------------------------------------------------------------------
 *  Robust helpers
 * ------------------------------------------------------------------------------------------------- */

function s(v, fallback = '') {
  return (v === null || v === undefined) ? fallback : String(v);
}
function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function safeLower(v) {
  return s(v, '').toLowerCase();
}
function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

// normalize bomPart so insertSparePart can work with:
// - SBOM bomPart objects
// - EBOM selectedItems (node)
// - custom itemData
function normalizeBomPart(input) {

  // Case A: selectedItem from EBOM insertBOM callback
  // { node: { item: { link, title }, partNumber, totalQuantity, root?, details? } }
  if (input && input.node) {
    return {
      link          : input.node.item?.link || '',
      root          : input.node.root || input.node.item?.link || '',
      partNumber    : input.node.partNumber || '',
      title         : input.node.item?.title || '',
      quantity      : input.node.quantity || input.node.totalQuantity || 1,
      totalQuantity : input.node.totalQuantity || input.node.quantity || 1,
      details       : input.node.details || null
    };
  }

  // Case B: already bomPart-like
  return {
    link          : input?.link || '',
    root          : input?.root || input?.link || '',
    partNumber    : input?.partNumber || '',
    title         : input?.title || '',
    quantity      : input?.quantity || input?.totalQuantity || 1,
    totalQuantity : input?.totalQuantity || input?.quantity || 1,
    details       : input?.details || null
  };
}

function registerServiceItem(root, type) {
  if (isBlank(root)) return;

  if (type === 'kit') {
    if (listServiceItems.kit.indexOf(root) === -1) listServiceItems.kit.push(root);
  } else if (type === 'offering') {
    if (listServiceItems.offering.indexOf(root) === -1) listServiceItems.offering.push(root);
  } else {
    if (listServiceItems.spareParts.indexOf(root) === -1) listServiceItems.spareParts.push(root);
  }
}

// Dedupe /plm/details requests (prevents 100 parallel calls)
const __detailsRequestInFlight = {}; // link -> true
function loadDetailsOnce(link, cb) {
  if (isBlank(link)) return;
  if (__detailsRequestInFlight[link]) return;

  __detailsRequestInFlight[link] = true;

  $.get('/plm/details', { link }, function(response) {
    __detailsRequestInFlight[link] = false;
    if (cb) cb(response);
  }).fail(function() {
    __detailsRequestInFlight[link] = false;
  });
}


/* -------------------------------------------------------------------------------------------------
 *  Boot
 * ------------------------------------------------------------------------------------------------- */

$(document).ready(function() {

  appendProcessing('items');
  appendOverlay();
  insertMenu();

  paramsProcesses.createPerformTransition = config.problemReports.transitionOnCreate;

  workspaceIds = {
    products           : config.products.workspaceId           || common.workspaceIds.products,
    sparePartsRequests : config.sparePartsRequests.workspaceId || common.workspaceIds.sparePartsRequests,
    problemReports     : config.problemReports.workspaceId     || common.workspaceIds.problemReports,
    assets             : config.assets.workspaceId             || common.workspaceIds.assets,
    orderProjects      : config.orderProjects.workspaceId      || common.workspaceIds.orderProjects,
    assetServices      : config.assetServices.workspaceId      || common.workspaceIds.assetServices,
  };

  let requests = [
    $.get('/plm/me', { useCache : false }),
    $.get('/plm/sections', { wsId : workspaceIds.sparePartsRequests, useCache : true }),
    $.get('/plm/bom-view-by-name', { wsId : common.workspaceIds.items, name : config.items.bomViewName, useCache : true })
  ];

  getFeatureSettings('service', requests, function(responses) {

    let user = responses[0]?.data || {};
    bomViewIdItems = responses[2]?.data?.id;

    $('#request-name'    ).val(user.displayName  || '');
    $('#request-company' ).val(user.organization || '');
    $('#request-e-mail'  ).val(user.email        || '');
    $('#request-address' ).val(user.address1     || '');
    $('#request-city'    ).val(user.city         || '');
    $('#request-postal'  ).val(user.postal       || '');
    $('#request-country' ).val(user.country      || '');

    if (!isBlank(config.problemReports.fieldIdImage)) {
      paramsProcesses.createViewerImageFields.push(config.problemReports.fieldIdImage);
    }

    paramsProcesses.createWSID    = workspaceIds.problemReports;
    paramsProcesses.workspacesIn  = [String(workspaceIds.problemReports)];

    wsProblemReports.id           = workspaceIds.problemReports;

    wsSparePartsRequests.id       = workspaceIds.sparePartsRequests;
    wsSparePartsRequests.sections = responses[1]?.data || [];

    paramsItemDetails        = config.paramsItemDetails || {};
    paramsItemDetails.id     = 'details-top';

    paramsItemAttachments    = config.paramsItemAttachments || {};
    paramsItemAttachments.id = 'details-bottom';

    paramsDocumentation            = config.paramsDocumentation || {};
    paramsDocumentation.id         = 'documentation';
    paramsDocumentation.hideHeader = true;

    setUIElements();
    setLandingPage(user.displayName || '');
    setUIEvents();

    // Deep-link open
    if (!isBlank(urlParameters.link)) {

      if (String(urlParameters.wsidcontext) == String(workspaceIds.assets)) {
        let link = '/api/v3/workspaces/' + urlParameters.wsidcontext + '/items/' + urlParameters.dmsidcontext;
        openSelectedProductOrAsset(link, 'assets', config.assets.fieldIDs);
      } else if (String(urlParameters.wsidcontext) == String(workspaceIds.products)) {
        let link = '/api/v3/workspaces/' + urlParameters.wsidcontext + '/items/' + urlParameters.dmsidcontext;
        openSelectedProductOrAsset(link, 'products', config.products.fieldIDs);
      } else {
        links.ebom = urlParameters.link;
        openItem();
      }
    }

  });

});


/* -------------------------------------------------------------------------------------------------
 *  UI setup
 * ------------------------------------------------------------------------------------------------- */

function setUIElements() {

  if (!applicationFeatures.homeButton) {
    $('#home').remove();
    $('#landing').remove();
  }

  if (!applicationFeatures.itemAttachments) {
    $('#details-top').css('bottom', '0px');
    $('#details-bottom').remove();
  }

  if (!applicationFeatures.itemDetails) {
    $('#details').remove();
    $('#toggle-details').remove();
  }

  if (!applicationFeatures.contextDocumentation) {
    $('#documentation').remove();
    $('#tab-documentation').remove();
  }

  if (!applicationFeatures.manageProblemReports) {
    $('#processes').remove();
    $('#tab-processes').remove();
  }

  if (!applicationFeatures.showStock) {
    $('#color-stock').remove();
  }

  if (!applicationFeatures.requestWorkflowActions) {
    $('#workflow-actions').remove();
  }

  if (urlParameters.type === 'assets') {
    $('#products').remove();
  } else {
    $('#services').remove();
    $('#projects').remove();
    $('#assets').remove();
  }

  $('#tab-your-requests').html(config.labels.homeSparePartRequests);
  $('#tab-your-problems').html(config.labels.homeProblemReports);

  if (!applicationFeatures.manageSparePartRequests) {
    if (!applicationFeatures.manageProblemReports) {
      $('#your-processes').remove();
      $('body').addClass('no-your-processes');
    }
  }
}

function setLandingPage(userName) {

  if (applicationFeatures.homeButton || isBlank(urlParameters.dmsId)) {

    if (urlParameters.type !== 'assets') {

      if (!isBlank(workspaceIds.products)) {

        insertResults(workspaceIds.products, config.products.filter, {
          id           : 'products',
          headerLabel  : config.products.headerLabel,
          icon         : config.products.icon,
          groupBy      : config.products.groupBy,
          contentSize  : config.products.contentSize,
          tileImage    : config.products.tileImage,
          tileTitle    : config.products.tileTitle,
          tileSubtitle : config.products.tileSubtitle,
          search       : true,
          layout       : 'grid',
          groupLayout  : 'horizontal',
          onClickItem  : function(elemClicked) {
            openSelectedProductOrAsset(elemClicked.attr('data-link'), 'product', config.products.fieldIDs);
          }
        });

      }

    } else {

      let filterAssetServices = [{
        field      : config.assetServices.fieldIDs.assignee,
        type       : 0,
        comparator : 5,
        value      : userName
      }];

      for (let status of safeArr(config.assetServices.hideStates)) {
        filterAssetServices.push({
          field      : 'WF_CURRENT_STATE',
          type       : 1,
          comparator : 5,
          value      : status
        });
      }

      insertResults(workspaceIds.assetServices, filterAssetServices, {
        id          : 'services',
        headerLabel : config.assetServices.headerLabel,
        layout      : 'list',
        contentSize : 'xs',
        tileIcon    : 'icon-service',
        number      : false,
        reload      : true,
        useCache    : false,
        onClickItem : function(elemClicked) { openSelectedAssetService(elemClicked); }
      });

      let filterAssetProjects = [];

      for (let status of safeArr(config.orderProjects.hideStates)) {
        filterAssetProjects.push({
          field      : 'WF_CURRENT_STATE',
          type       : 1,
          comparator : 5,
          value      : status
        });
      }

      insertResults(workspaceIds.orderProjects, filterAssetProjects, {
        id             : 'projects',
        headerLabel    : config.orderProjects.headerLabel,
        layout         : 'grid',
        contentSize    : 'l',
        tileImage      : 'IMAGE',
        tileTitle      : 'TITLE',
        tileSubtitle   : config.orderProjects.tileSubtitle,
        tileDetails    : config.orderProjects.tileDetails,
        reload         : true,
        search         : true,
        useCache       : true,
        openInPLM      : applicationFeatures.openInPLM,
        openOnDblClick : applicationFeatures.openInPLM,
        onClickItem    : function(elemClicked) { selectProject(elemClicked); }
      });

    }

  }

  if (applicationFeatures.manageSparePartRequests) {

    let params = {
      id           : 'your-requests',
      headerLabel  : config.labels.homeSparePartRequests,
      layout       : 'list',
      contentSize  : 'xs',
      tileIcon     : 'icon-package',
      number       : false,
      search       : true,
      reload       : true,
      tileTitle    : 'DESCRIPTOR',
      tileSubtitle : 'REQUEST_DATE',
      stateColors  : config.sparePartsRequests.stateColors,
      onClickItem  : function(elemClicked) { openRequest(elemClicked); }
    };

    if (applicationFeatures.manageProblemReports) {
      params.hideHeader    = true;
      params.singleToolbar = 'actions';
    } else {
      params.id = 'your-processes';
    }

    insertResults(workspaceIds.sparePartsRequests, [{
      field      : 'OWNER_USERID',
      type       : 3,
      comparator : 15,
      value      : userName
    },{
      field      : 'WF_CURRENT_STATE',
      type       : 1,
      comparator : 5,
      value      : 'Completed'
    },{
      field      : 'WF_CURRENT_STATE',
      type       : 1,
      comparator : 5,
      value      : 'Deleted'
    }], params);

  } else {
    $('#tab-your-requests').remove();
  }

  if (applicationFeatures.manageProblemReports) {

    let params = {
      id             : 'your-problems',
      headerLabel    : config.labels.homeProblemReports,
      layout         : 'list',
      contentSizes   : ['l', 'm', 'xs', 'xxs'],
      search         : true,
      reload         : true,
      openInPLM      : applicationFeatures.openInPLM,
      openOnDblClick : applicationFeatures.openInPLM,
      tileTitle      : 'DESCRIPTOR',
      tileSubtitle   : 'DESCRIPTION',
      tileDetails    : [{
        icon    : 'icon-tag',
        fieldId : 'TYPE',
        prefix  : 'PR Type'
      },{
        icon    : 'icon-select',
        fieldId : 'SOURCE',
        prefix  : 'PR Source'
      }],
      stateColors : config.problemReports.stateColors,
      onClickItem : function(elemClicked) { openProblemReport(elemClicked); }
    };

    if (applicationFeatures.manageSparePartRequests) {
      params.hideHeader    = true;
      params.singleToolbar = 'actions';
    } else {
      params.id = 'your-processes';
    }

    insertResults(workspaceIds.problemReports, [{
      field      : 'OWNER_USERID',
      type       : 3,
      comparator : 15,
      value      : userName
    },{
      field      : 'WF_CURRENT_STATE',
      type       : 1,
      comparator : 5,
      value      : 'Completed'
    }], params);

  } else {
    $('#tab-your-problems').remove();
  }

  // direct open by wsid/dmsid (legacy)
  if (!isBlank(dmsId)) {

    $('body').addClass('screen-main').removeClass('screen-landing').removeClass('screen-request');

    let params = (document.location.href.split('?')[1] || '').split('&');
    let wsidcontext  = null;
    let dmsidcontext = null;

    for (let param of params) {
      if (param.toLowerCase().indexOf('wsidcontext=') === 0) wsidcontext  = param.split('=')[1];
      if (param.toLowerCase().indexOf('dmsidcontext=') === 0) dmsidcontext = param.split('=')[1];
    }

    if (!isBlank(wsidcontext) && !isBlank(dmsidcontext)) {
      links.context = '/api/v3/workspaces/' + wsidcontext + '/items/' + dmsidcontext;
    }

    openItem();

  } else {
    $('#landing').show();
  }

}

function setUIEvents() {

  if (applicationFeatures.homeButton) {
    $('#home').click(function() {
      viewerLeaveMarkupMode();
      viewerUnloadAllModels();
      $('body').addClass('screen-landing').removeClass('screen-main').removeClass('screen-request');
      document.title = documentTitle;

      let url = '/service?theme=' + theme;
      if (!isBlank(urlParameters.type)) url += '&type=' + urlParameters.type;

      window.history.replaceState(null, null, url);
    });
  }

  $('#toggle-service').click(function() {
    $('body').toggleClass('no-asset-service');
    viewerResize();
  });
  $('#toggle-bom').click(function() {
    $('body').toggleClass('no-bom');
    viewerResize();
  });
  $('#toggle-snl').click(function() {
    $('body').toggleClass('no-snl');
    viewerResize();
  });
  $('#toggle-panel').click(function() {
    $('body').toggleClass('no-panel');
    viewerResize();
  });

  if (applicationFeatures.itemDetails) {
    $('#toggle-details').click(function() {
      $('body').toggleClass('no-details');
      viewerResize();
    });
  }

  $('#filter-list').click(function() { filterBySparePartsList(); });
  $('#color-stock').click(function() { highlightSparePartStocks(); });
  $('#spare-parts-search-input').keyup(function() { filterSparePartsByInput(); });

  $('#cart-title').click(function() {
    $('#cart').toggleClass('collapsed');
    adjustCartHeight();
  });

  $('#filter-cart').click(function() {
    let partNumbers = [];
    $('#cart-list').children().each(function() {
      partNumbers.push($(this).attr('data-part-number'));
    });
    viewerSelectModels(partNumbers);
  });

  $('#clear-cart').click(function() {
    $('#cart-list').children().each(function() { removeCartItem($(this)); });
    adjustCartHeight();
  });

  $('#submit-request').click(function() {
    $('#request-creation').show();
    $('#overlay').show();
    setRequestList();
  });

  $('#request-creation-submit').click(function() { submitRequest(); });
  $('#request-creation-cancel').click(function() {
    $('#request-creation').hide();
    $('#overlay').hide();
    clearRequestList();
  });

  $('#close-item').click(function() {
    $('body').addClass('screen-landing')
      .removeClass('screen-main')
      .removeClass('screen-request');
  });

}


/* -------------------------------------------------------------------------------------------------
 *  Landing interactions
 * ------------------------------------------------------------------------------------------------- */

function selectProject(elemClicked) {

  let descriptor = elemClicked.attr('data-descriptor');
  let isSelected = elemClicked.hasClass('selected');

  if (!isSelected) {
    $('body').addClass('no-assets-list');
    return;
  }

  $('body').removeClass('no-assets-list');

  insertResults(workspaceIds.assets, [{
    field      : config.assets.fieldIDs.project,
    type       : 0,
    comparator : 15,
    value      : descriptor
  }], {
    id          : 'assets',
    headerLabel : 'Assets of ' + descriptor,
    layout      : 'table',
    contentSize : 'm',
    fields      : config.assets.tableColumns,
    useCache    : true,
    search      : true,
    openInPLM   : applicationFeatures.openInPLM,
    onClickItem : function(elemClicked) {
      openSelectedProductOrAsset(elemClicked.attr('data-link'), 'asset', config.assets.fieldIDs);
    }
  });

}

function openRequest(elemClicked) {

  let link = elemClicked.attr('data-link');

  insertItemSummary(link, {
    bookmark : false,
    contents : [
      { type : 'workflow-history', className : 'surface-level-1', params : { id : 'request-workflow-history' } },
      { type : 'details',          className : 'surface-level-1', params : { id : 'request-details', expandSections : config.sparePartsRequests.sectionsExpanded, suppressLinks : true, sectionsEx : config.sparePartsRequests.sectionsExcluded } },
      { type : 'grid',             className : 'surface-level-1', params : { id : 'request-grid', headerLabel : 'Part List', fieldsEx : config.sparePartsRequests.gridColumnsExcluded } },
      { type : 'attachments',      className : 'surface-level-1', params : { id : 'request-attachments', editable : true, layout : 'tiles', singleToolbar : 'controls' } },
    ],
    statesColors    : config.sparePartsRequests.stateColors,
    layout          : 'dashboard',
    reload          : false,
    openInPLM       : applicationFeatures.openInPLM,
    workflowActions : applicationFeatures.requestWorkflowActions
  });

}

function openProblemReport(elemClicked) {

  let link = elemClicked.attr('data-link');

  insertItemSummary(link, {
    bookmark : false,
    contents : [
      { type : 'workflow-history', className : 'surface-level-1', params : { id : 'request-workflow-history' } },
      { type : 'details',          className : 'surface-level-1', params : { id : 'request-details', expandSections : config.problemReports.sectionsExpanded, suppressLinks : true, sectionsEx : config.problemReports.sectionsExcluded } },
      { type : 'grid',             className : 'surface-level-1', params : { id : 'request-grid', headerLabel : 'Notes' } },
      { type : 'attachments',      className : 'surface-level-1', params : { id : 'request-attachments', editable : true, layout : 'tiles', singleToolbar : 'controls' } },
    ],
    statesColors    : config.problemReports.stateColors,
    layout          : 'dashboard',
    reload          : false,
    openInPLM       : applicationFeatures.openInPLM,
    workflowActions : applicationFeatures.problemWorkflowActions
  });

}

function openSelectedAssetService(elemClicked) {

  $('#overlay').show();
  $('#toggle-service').removeClass('hidden');
  $('body').addClass('no-panel');

  links.service = elemClicked.attr('data-link');

  $.get('/plm/details', { link : links.service }, function(response) {

    let linkAsset = getSectionFieldValue(response.data.sections, config.assetServices.fieldIDs.asset, '', 'link');
    let linkSNL   = getSectionFieldValue(response.data.sections, config.assetServices.fieldIDs.serialnrs, '', 'link');

    openSelectedProductOrAsset(linkAsset, 'asset', config.assets.fieldIDs, links.service, linkSNL);

    insertItemSummary(links.service, {
      contents : [{
        type : 'details',
        params : {
          id             : 'service-details',
          editable       : true,
          hideHeader     : true,
          expandSections : config.assetServices.detailsPanel.expandSections,
          sectionsEx     : config.assetServices.detailsPanel.excludeSections
        }
      },{
        type   : 'grid',
        params : {
          id         : 'service-grid',
          fieldsEx   : ['Comments', 'Required Tools'],
          hideHeader : true
        }
      },{
        type : 'attachments',
        params : {
          id            : 'service-attachments',
          editable      : true,
          layout        : 'list',
          contentSize   : 'm',
          singleToolbar : 'controls'
        }
      }],
      statesColors    : [
        { label : 'New',       color : 'red',    states : ['Received'] },
        { label : 'In Work',   color : 'yellow', states : ['Review', 'Quote Creation'] },
        { label : 'Waiting',   color : 'red',    states : ['Awaiting Response', 'Quote Submitted'] },
        { label : 'Delivery',  color : 'yellow', states : ['Order in process', 'Shipment'] },
        { label : 'Completed', color : 'green',  states : ['Completed'] }
      ],
      id              : 'service',
      hideCloseButton : true,
      layout          : 'tabs',
      openInPLM       : false,
      reload          : false,
      workflowActions : true
    });

  });

}

function openSelectedProductOrAsset(link, type, fieldIDs, linkService, linkSNL) {

  $('#overlay').show();
  links.context = link;

  if (isBlank(linkService)) {
    $('body').addClass('no-asset-service').removeClass('no-panel');
    $('#toggle-service').addClass('hidden');
  } else {
    $('body').removeClass('no-asset-service');
  }

  $.get('/plm/details', { link : links.context }, function(response) {

    links.ebom = getSectionFieldValue(response.data.sections, fieldIDs.ebom, '', 'link');
    links.sbom = getSectionFieldValue(response.data.sections, fieldIDs.sbom, '', 'link');
    links.snl  = linkSNL;

    if (isBlank(linkSNL) && type === 'asset') {
      links.snl = getSectionFieldValue(response.data.sections, fieldIDs.serialnrs, '', 'link');
    }

    if (isBlank(links.ebom)) {
      showErrorMessage('Invalid Product Data', 'BOM of the selected ' + type + ' is not availalbe, please contact your administrator');
      return;
    }

    $('body').addClass('screen-main').removeClass('screen-landing').removeClass('screen-request');

    let splitEBOM    = links.ebom.split('/');
    let splitContext = links.context.split('/');
    let url = '/service?wsid=' + splitEBOM[4] + '&dmsid=' + splitEBOM[6]
            + '&wsidcontext=' + splitContext[4] + '&dmsidcontext=' + splitContext[6]
            + '&theme=' + theme;

    if (!isBlank(urlParameters.type)) url += '&type=' + urlParameters.type;

    window.history.replaceState(null, null, url);

    openItem();

  });

}


/* -------------------------------------------------------------------------------------------------
 *  Open Item (BOM + Viewer + Panels)
 * ------------------------------------------------------------------------------------------------- */

function openItem() {

  listServiceItems = { spareParts : [], kit : [], offering : [], wearParts : [] };

  $('#header-subtitle').html('');
  $('#cart-list').html('');
  $('#items-content').html('');
  $('#items-processing').show();
  $('#overlay').hide();

  if (isBlank(links.snl)) $('#toggle-snl').addClass('hidden'); else $('#toggle-snl').removeClass('hidden');
  if (isBlank(links.context)) $('body').addClass('no-asset-service');

  adjustCartHeight();

  $.get('/plm/descriptor', { link : (links.context || links.ebom) }, function(response) {
    $('#header-subtitle').html(response.data);
    document.title = documentTitle + ': ' + response.data;
  });

  if (!isBlank(links.context)) {
    if (applicationFeatures.contextDocumentation) {
      $('#tab-documentation').show();
      insertAttachments(links.context, paramsDocumentation);
    }
  } else if ($('#tab-documentation').length > 0) {
    $('#tab-documentation').hide();
  }

  $('#tabs').children().first().click();

  let paramsBOM = {
    bomViewName      : config.items.bomViewName,
    collapseContents : true,
    contentSize      : 's',
    reset            : true,
    path             : true,
    hideDetails      : false,
    quantity         : true,
    counters         : true,
    getFlatBOM       : true,
    search           : true,
    showRestricted   : false,
    toggles          : true,
    openInPLM        : config.applicationFeatures.openInPLM,
    revisionBias     : config.items.bomRevisionBias,
    endItem          : config.items.endItemFilter,
    selectItems      : { fieldId : config.items.fieldIdSparePart, values : config.items.fieldValuesSparePart }
  };

  // merge override
  let keys = Object.keys(config.paramsBOM || {});
  for (let key of keys) paramsBOM[key] = config.paramsBOM[key];

  insertBOM(links.ebom, paramsBOM);
  insertViewer(links.ebom);
  updateRelatedPanels(links.ebom);

  if (!isBlank(links.sbom)) insertServiceBOM();

  if (isBlank(links.snl)) {

    $('body').addClass('no-snl');
    $('#toggle-snl').addClass('hidden');

  } else {

    $('body').removeClass('no-snl');
    $('#toggle-snl').removeClass('hidden');

    insertGrid(links.snl, {
      id            : 'snl',
      headerLabel   : 'Serial Numbers',
      singleToolbar : 'controls',
      fieldsIn      : config.serialNumbers.tableColumns,
      editable      : true,
      groupBy       : config.serialNumbers.fieldIDs.partNumber,
      sortBy        : config.serialNumbers.fieldIDs.instanceId,
      sortType      : 'integer',
      onClickItem   : function(elemClicked) { selectSerialNumber(elemClicked); }
    });

  }

}

function updateRelatedPanels(link) {

  paramsProcesses.createContextItems      = [link];
  paramsProcesses.createContextItemFields = ['AFFECTED_ITEM'];

  if (!isBlank(links.context)) {
    paramsProcesses.createContextItems.push(links.context);
    paramsProcesses.createContextItemFields.push('AFFECTED_PRODUCT');
  }

  if (applicationFeatures.itemDetails)          insertDetails(link, paramsItemDetails);
  if (applicationFeatures.itemAttachments)      insertAttachments(link, paramsItemAttachments);
  if (applicationFeatures.manageProblemReports) insertChangeProcesses(link, paramsProcesses);

}


/* -------------------------------------------------------------------------------------------------
 *  BOM parsing -> Spare Parts List (EBOM)
 * ------------------------------------------------------------------------------------------------- */

function changeBOMViewDone(id, settings, bom, selectedItems, flatBOM) {

  $('#bom-processing').hide();

  // When SBOM is present, we wait for insertServiceBOM() to finish list
  if (!isBlank(links.sbom)) {
    finishSparePartsList();
    return;
  }

  if (selectedItems.length > 15) $('#items-content').removeClass('l').addClass('m');

  let elemContent = $('#items-content');

  for (let selectedItem of safeArr(selectedItems)) {
    insertSparePart(elemContent, selectedItem, 'sparePart');
  }

  setSparePartStockStatus();
  insertNonSparePartMessage();
  finishSparePartsList();
}


/* -------------------------------------------------------------------------------------------------
 *  Service SBOM list (kits/offering/components)
 * ------------------------------------------------------------------------------------------------- */

function insertServiceBOM() {

  let elemContent = $('#items-content');
  elemContent.addClass('service-bom').removeClass('l').addClass('m');

  let params = {
    link            : links.sbom,
    depth           : 4,
    viewId          : bomViewIdItems,
    getBOMPartsList : true
  };

  $.get('/plm/bom', params, function(response) {

    let elemListGroup     = insertSparePartsGroup(elemContent, config.serviceBOMTypes.sparePart.groupLabel);
    let elemListParts     = insertSparePartsList(elemContent);

    let elemKitsGroup     = insertSparePartsGroup(elemContent, config.serviceBOMTypes.kit.groupLabel);
    let elemKitsParts     = insertSparePartsList(elemContent);

    let elemOfferingGroup = insertSparePartsGroup(elemContent, config.serviceBOMTypes.offering.groupLabel);
    let elemOfferingParts = insertSparePartsList(elemContent);

    let elemComponents = null;
    let type = '';

    for (let bomPart of safeArr(response.data?.bomPartsList)) {

      if (bomPart.level === 1 && bomPart.details?.TYPE === config.serviceBOMTypes.sparePart.fieldValue) {
        type = 'sparePart';
      } else if (bomPart.level === 1 && bomPart.details?.TYPE === config.serviceBOMTypes.kit.fieldValue) {
        type = 'kit';
        let elemKit = insertSparePart(elemKitsParts, bomPart, 'kit');
        elemComponents = insertSparePartComponents(elemKit);
      } else if (bomPart.level === 1 && bomPart.details?.TYPE === config.serviceBOMTypes.offering.fieldValue) {
        type = 'offering';
        let elemOffering = insertSparePart(elemOfferingParts, bomPart, 'offering');
        elemComponents = insertSparePartComponents(elemOffering);
      } else if (bomPart.level === 2) {
        if (type === 'sparePart') {
          insertSparePart(elemListParts, bomPart, 'sparePart');
        } else if (type === 'kit') {
          registerServiceItem(bomPart.root, 'kit');
          insertSparePartComponent(elemComponents, bomPart);
        }
      } else if (bomPart.level === 3) {
        if (type === 'offering') {
          registerServiceItem(bomPart.root, 'offering');
          insertSparePartComponent(elemComponents, bomPart);
        }
      }

    }

    setSparePartStockStatus();
    insertNonSparePartMessage();
    finishSparePartsList();

  });

}

function insertSparePartsGroup(elemTop, text) {

  let elemSparePartsGroup = $('<div></div>').appendTo(elemTop)
    .addClass('spare-parts-group')
    .click(function() {
      let elemToggle = $(this).children().first();
      elemToggle.toggleClass('icon-chevron-down').toggleClass('icon-chevron-right');
      $(this).next().toggle();
    });

  $('<div></div>').appendTo(elemSparePartsGroup)
    .addClass('spare-parts-group-icon icon icon-chevron-down');

  $('<div></div>').appendTo(elemSparePartsGroup)
    .addClass('spare-parts-group-text')
    .html(text);

  return elemSparePartsGroup;
}

function insertSparePartsList(elemParent) {

  return $('<div></div>').appendTo(elemParent)
    .addClass('spare-parts-list list tiles m surface-level-2');
}

function insertSparePartComponents(elemPrevious) {

  elemPrevious.addClass('has-components');

  let elemSparePartComponents = $('<div></div>').insertAfter(elemPrevious)
    .addClass('spare-part-components no-scrollbar list tiles surface-level-2');

  $('<div></div>').appendTo(elemSparePartComponents)
    .addClass('spare-part-components-toggle icon-toggle-collapse icon')
    .click(function() {
      $(this).toggleClass('icon-toggle-collapse').toggleClass('icon-toggle-expand');
      $(this).prevAll('.spare-part-component').toggleClass('hidden');
    });

  return elemSparePartComponents;
}

function insertSparePartComponent(elemParent, bomPartRaw) {

  if (!elemParent || elemParent.length === 0) return;

  const bomPart = normalizeBomPart(bomPartRaw);
  const elemToggle = elemParent.find('.spare-part-components-toggle');

  $('<div></div>').insertBefore(elemToggle)
    .attr('data-link', bomPart.link)
    .attr('data-root', bomPart.root)
    .attr('data-title', bomPart.title)
    .attr('data-part-number', bomPart.partNumber)
    .addClass('spare-part-component')
    .click(function() { clickSparePart($(this)); })
    .append($('<div></div>').addClass('spare-part-component-quantity').html(n(bomPartRaw.quantity, 1)))
    .append($('<div></div>').addClass('spare-part-component-title').html(s(bomPart.title)));

}


/* -------------------------------------------------------------------------------------------------
 *  Tile creation (ROBUST)
 * ------------------------------------------------------------------------------------------------- */

function insertSparePart(elemParent, bomPartRaw, type) {

  let bomPart = normalizeBomPart(bomPartRaw);

  if (isBlank(type) || !config.serviceBOMTypes[type]) type = 'sparePart';

  registerServiceItem(bomPart.root, type);

  let titleField    = config.items.sparePartTileTitle;
  let subtitleField = config.items.sparePartTileSubtitle;

  let tileNumber = '';
  let tileTitle  = '';

  if (bomPart.details && typeof bomPart.details === 'object') {
    tileNumber = s(bomPart.details[titleField], '');
    tileTitle  = s(bomPart.details[subtitleField], '');
  }

  if (isBlank(tileNumber)) tileNumber = s(bomPart.partNumber, '');
  if (isBlank(tileTitle))  tileTitle  = s(bomPart.title, '');

  if (isBlank(tileNumber) && !isBlank(tileTitle)) tileNumber = tileTitle;
  if (isBlank(tileTitle) && !isBlank(tileNumber)) tileTitle = tileNumber;

  let qty = n(bomPart.totalQuantity, 1);

  let elemSparePart = $('<div></div>').appendTo(elemParent)
    .addClass('tile spare-part')
    .attr('data-link', bomPart.link)
    .attr('data-root', bomPart.root)
    .attr('data-title', tileTitle)
    .attr('data-type', type)
    .attr('data-part-number', tileNumber)
    .attr('data-qty', qty)
    .click(function() { clickSparePart($(this)); });

  let elemSparePartImage = $('<div></div>').appendTo(elemSparePart)
    .addClass('spare-part-image tile-image');

  $('<span></span>').appendTo(elemSparePartImage)
    .addClass('icon filled')
    .addClass(config.serviceBOMTypes[type].icon || 'icon-package');

  // Load image (deduped)
  loadDetailsOnce(bomPart.link, function(response) {
    if (!response || response.error) return;

    let params = {
      replace   : true,
      icon      : config.serviceBOMTypes[type].icon || 'icon-package',
      imageLink : getFirstImageFieldValue(response.data.sections)
    };

    $('.spare-part').each(function() {
      if ($(this).attr('data-link') === response.params.link) {
        let elemImage = $(this).find('.spare-part-image').first();
        appendImageFromCache(elemImage, {}, params, function() {});
      }
    });
  });

  let elemSparePartDetails = $('<div></div>').appendTo(elemSparePart)
    .addClass('spare-part-details tile-details');

  let elemSparePartID = $('<div></div>').appendTo(elemSparePartDetails)
    .addClass('spare-part-identifier');

  $('<div></div>').appendTo(elemSparePartID)
    .addClass('spare-part-quantity')
    .html(qty);

  $('<div></div>').appendTo(elemSparePartID)
    .addClass('spare-part-number tile-title')
    .html(tileNumber);

  $('<div></div>').appendTo(elemSparePartDetails)
    .addClass('spare-part-title')
    .html(tileTitle);

  let elemSparePartSide = $('<div></div>').appendTo(elemSparePart)
    .addClass('spare-part-side');

  let elemCartAdd = $('<div></div>').appendTo(elemSparePartSide)
    .addClass('button cart-add')
    .click(function(e) {
      e.preventDefault();
      e.stopPropagation();
      addCartItem($(this));
    });

  $('<div></div>').appendTo(elemCartAdd).addClass('icon icon-cart-add');
  $('<div></div>').appendTo(elemCartAdd).html('Add to cart');

  if (applicationFeatures.showStock) {
    $('<div></div>').appendTo(elemSparePartSide).addClass('spare-part-stock');
  }

  return elemSparePart;
}

function insertNonSparePartMessage() {

  if (isBlank(applicationFeatures.enableCustomRequests)) return;
  if (!applicationFeatures.enableCustomRequests) return;

  if ($('#custom-message').length > 0) return;

  let elemMessage = $('<div></div>')
    .addClass('surface-level-3 custom-message')
    .attr('id', 'custom-message')
    .prependTo($('#items-content'));

  $('<div></div>').appendTo(elemMessage)
    .addClass('custom-message-text')
    .html("The selected item is not available as spare part. While availability is not guaranteed, you may submit a request for this item anyway. We will validate the given item's availability per each request.<br>Do you want to include this item in your request?");

  $('<div></div>').appendTo(elemMessage)
    .addClass('custom-message-button button default')
    .html('Confirm')
    .click(function() {

      $('#custom-message').hide();

      let link = $('#custom-message').attr('data-link');
      let root = $('#custom-message').attr('data-root');

      let itemData = {
        link          : link,
        root          : root || link,
        quantity      : 1,
        totalQuantity : 1,
        partNumber    : '',
        title         : '',
        details       : null
      };

      $('.bom-item').each(function() {
        if ($(this).attr('data-link') === itemData.link) {
          itemData.partNumber = $(this).attr('data-part-number') || '';
          itemData.title      = $(this).attr('data-title') || '';

          $(this).addClass('is-spare-part spare-part-custom');

          let elemCell = $(this).find('.bom-column-icon');
          $('<span></span>').appendTo(elemCell)
            .addClass('icon filled')
            .addClass(config.serviceBOMTypes.custom?.icon || 'icon-package')
            .attr('title', 'Custom spare part request');
        }
      });

      let elemSparePart = insertSparePart($('#items-content'), itemData, 'custom');
      elemSparePart.insertAfter($('#custom-message')).addClass('spare-part-custom');

      if (applicationFeatures.showStock) {
        let elemStock = elemSparePart.find('.spare-part-stock');
        elemStock.empty();

        let stockLabel = 'No spare part';
        let stockClass = 'custom';

        elemSparePart
          .removeClass('spare-part-stock-none spare-part-stock-low spare-part-stock-normal')
          .addClass('spare-part-stock-' + stockClass)
          .attr('data-stock', stockClass);

        elemStock.attr('title', stockLabel);
        $('<div></div>').appendTo(elemStock).addClass('spare-part-stock-icon');
        $('<div></div>').appendTo(elemStock).addClass('spare-part-stock-label').html(stockLabel);
      }

    });

}

function setSparePartStockStatus() {

  if (!applicationFeatures.showStock) return;

  $('#items-content').find('.spare-part').each(function() {

    let elemSparePart = $(this);

    // keep custom as-is
    if (elemSparePart.hasClass('spare-part-custom')) return;

    let elemStock = elemSparePart.find('.spare-part-stock');

    // idempotent
    elemStock.empty();
    elemSparePart.removeClass('spare-part-stock-none spare-part-stock-low spare-part-stock-normal');

    let stockLabel  = 'In stock';
    let stockClass  = 'normal';
    let stockRandom = Math.floor(Math.random() * 3) + 1;

    if (stockRandom === 2) { stockLabel = 'Low stock';    stockClass = 'low';  }
    if (stockRandom === 3) { stockLabel = 'Out of stock'; stockClass = 'none'; }

    elemSparePart.addClass('spare-part-stock-' + stockClass);
    elemSparePart.attr('data-stock', stockClass);
    elemStock.attr('title', stockLabel);

    $('<div></div>').appendTo(elemStock).addClass('spare-part-stock-icon');
    $('<div></div>').appendTo(elemStock).addClass('spare-part-stock-label').html(stockLabel);

  });

}

function finishSparePartsList() {

  $('#items-processing').hide();

  if ($('#bom-thead-row').length === 0) return;

  if ($('#bom-thead-row').find('.bom-column-spare-parts').length === 0) {
    $('<th></th>').addClass('bom-column-icon bom-column-spare-parts').appendTo($('#bom-thead-row'));
  }

  $('.bom-item').each(function() {

    let elemBOMItem = $(this);
    let rootLink    = elemBOMItem.attr('data-root-link');

    if (elemBOMItem.find('td.bom-column-spare-parts').length === 0) {
      $('<td></td>').addClass('bom-column-icon bom-column-spare-parts').appendTo(elemBOMItem);
    }

    let elemCell = elemBOMItem.find('td.bom-column-spare-parts').first();
    elemCell.empty();

    let icon  = null;
    let title = null;

    if (listServiceItems.spareParts.indexOf(rootLink) > -1) {
      icon  = config.serviceBOMTypes.sparePart.icon;
      title = 'Is Spare Part';
    } else if (listServiceItems.kit.indexOf(rootLink) > -1) {
      icon  = config.serviceBOMTypes.kit.icon;
      title = 'Contained in Kit';
    } else if (listServiceItems.offering.indexOf(rootLink) > -1) {
      icon  = config.serviceBOMTypes.offering.icon; // FIX (was icong)
      title = 'Included in offering';
    }

    if (icon) {
      elemBOMItem.addClass('is-spare-part');
      $('<span></span>').appendTo(elemCell)
        .addClass('icon filled')
        .addClass(icon)
        .attr('title', title);
    }

  });

}


/* -------------------------------------------------------------------------------------------------
 *  BOM User interactions
 * ------------------------------------------------------------------------------------------------- */

function clickBOMItem(elemClicked, e) {

  $('.bom-item').removeClass('selected-context');

  let link = elemClicked.attr('data-link');

  if (elemClicked.hasClass('selected')) {

    setSparePartsList(elemClicked);
    viewerSelectModel(elemClicked.attr('data-part-number'), { highlight : false });
    updateRelatedPanels(link);

  } else {

    elemClicked.addClass('selected-context');
    resetSparePartsList();

    viewerResetSelection({ fitToView : true });
    updateRelatedPanels(links.ebom);

  }

}

function panelResetDone(id, elemClicked) {
  resetSparePartsList();
  updateViewer();
  updateRelatedPanels(links.ebom);
}


/* -------------------------------------------------------------------------------------------------
 *  Manage Spare Parts panel list
 * ------------------------------------------------------------------------------------------------- */

function setSparePartsList(elemItem) {

  $('#items-processing').show();

  let listBOMItems = [];
  let level        = 0;
  let elemNext     = $('tr').closest().first();

  if (typeof elemItem !== 'undefined') {
    elemNext = elemItem;
    level    = n(elemItem.attr('data-level'), 0);
  }

  let levelNext = level - 1;

  $('.spare-part').addClass('hidden');
  $('.spare-part-components').addClass('hidden');
  $('.spare-part-component').removeClass('selected');

  do {

    if (elemNext.hasClass('is-spare-part')) {

      let root = elemNext.attr('data-root-link');

      if (listBOMItems.indexOf(root) === -1) {
        listBOMItems.push(root);
        unhideMatchingSpareParts(root);
      }
    }

    elemNext  = elemNext.next();
    levelNext = n(elemNext.attr('data-level'), -1);

  } while (levelNext > level);

  let elemCustomMessage = $('#custom-message');

  // If no spare part is present, validate parents
  if (listBOMItems.length === 0) {
    let parents = getBOMItemPath(elemItem);
    for (let parent of safeArr(parents.items)) {
      if (parent.hasClass('is-spare-part')) {
        let rootParent = parent.attr('data-root-link');
        listBOMItems.push(rootParent);
        unhideMatchingSpareParts(rootParent);
        break;
      }
    }
  }

  // Show custom request message
  if (elemCustomMessage.length > 0) {
    if (listBOMItems.length > 0) {
      elemCustomMessage.hide();
    } else {
      elemCustomMessage.attr('data-link', elemItem.attr('data-link')).show();
      elemCustomMessage.attr('data-root', elemItem.attr('data-root-link'));
    }
  }

  $('#items-processing').hide();
}

function unhideMatchingSpareParts(root) {

  $('.spare-part').each(function() {
    if ($(this).attr('data-root') === root) $(this).removeClass('hidden');
  });

  $('.spare-part-component').each(function() {
    if ($(this).attr('data-root') === root) {
      $(this).parent().removeClass('hidden');
      $(this).parent().prev().removeClass('hidden');
    }
  });

}

function resetSparePartsList() {

  $('#custom-message').hide();

  $('.spare-part').removeClass('hidden');
  $('.spare-part-components').removeClass('hidden');
  $('.spare-part-component').removeClass('selected');
}


/* -------------------------------------------------------------------------------------------------
 *  Above-list icons
 * ------------------------------------------------------------------------------------------------- */

function filterBySparePartsList() {

  let partNumbers = [];

  $('#items').find('.spare-part').each(function() {

    let elemSparePart = $(this);
    if (elemSparePart.hasClass('hidden')) return;

    partNumbers.push(elemSparePart.attr('data-part-number'));

    let elemNext = elemSparePart.next();
    if (elemNext.hasClass('spare-part-components')) {
      elemNext.find('.spare-part-component').each(function() {
        partNumbers.push($(this).attr('data-part-number'));
      });
    }
  });

  viewerSelectModels(partNumbers);
}

function highlightSparePartStocks() {

  // expects global colors.vectors.* like your existing code
  highlightSparePartStock('spare-part-stock-normal', colors.vectors.green,  true);
  highlightSparePartStock('spare-part-stock-low',    colors.vectors.yellow, false);
  highlightSparePartStock('spare-part-stock-none',   colors.vectors.red,    false);
  highlightSparePartStock('spare-part-stock-custom', colors.vectors.blue,   false);
}

function highlightSparePartStock(className, vector, reset) {

  let partNumbers = [];

  $('#items').find('.spare-part.' + className).each(function() {

    let elemSparePart = $(this);
    if (elemSparePart.hasClass('hidden')) return;

    partNumbers.push(elemSparePart.attr('data-part-number'));

    let elemNext = elemSparePart.next();
    if (elemNext.hasClass('spare-part-components')) {
      elemNext.find('.spare-part-component').each(function() {
        partNumbers.push($(this).attr('data-part-number'));
      });
    }
  });

  viewerSetColors(partNumbers, {
    color       : vector,
    resetColors : reset,
    isolate     : reset,
    unhide      : true
  });

}

function filterSparePartsByInput() {

  let value = safeLower($('#spare-parts-search-input').val());
  $('.no-match').removeClass('no-match');

  if (value === '') return;

  $('#items').find('.spare-part').each(function() {

    let elemSparePart = $(this);
    let elemNext      = elemSparePart.next();

    let title  = safeLower(elemSparePart.attr('data-title'));
    let number = safeLower(elemSparePart.attr('data-part-number'));

    let visible = (title.indexOf(value) > -1) || (number.indexOf(value) > -1);

    if (elemNext.hasClass('spare-part-components')) {
      elemNext.find('.spare-part-component').each(function() {
        let t = safeLower($(this).attr('data-title'));
        let n = safeLower($(this).attr('data-part-number'));
        if (t.indexOf(value) > -1 || n.indexOf(value) > -1) visible = true;
      });
    }

    if (!visible) {
      elemSparePart.addClass('no-match');
      if (elemNext.hasClass('spare-part-components')) elemNext.addClass('no-match');
    }

  });

}


/* -------------------------------------------------------------------------------------------------
 *  Serial Numbers
 * ------------------------------------------------------------------------------------------------- */

function selectSerialNumber(elemClicked) {

  let gridRow = {
    partNumber   : '',
    path         : '',
    instancePath : ''
  };

  let fieldIDs = config.serialNumbers.fieldIDs;

  elemClicked.children().each(function() {

    let elemCell = $(this);
    let fieldId  = elemCell.attr('data-id');
    if (isBlank(fieldId)) return;

    switch (fieldId) {
      case fieldIDs.partNumber:
        gridRow.partNumber = elemCell.children().first().val();
        break;
      case fieldIDs.path:
        gridRow.path = elemCell.children().first().val();
        break;
      case fieldIDs.instancePath:
        gridRow.instancePath = elemCell.children().first().val();
        break;
    }

  });

  bomDisplayItemByPath(gridRow.path);
  viewerHighlightInstances(gridRow.partNumber, [], [gridRow.instancePath], {});
}


/* -------------------------------------------------------------------------------------------------
 *  Spare part click
 * ------------------------------------------------------------------------------------------------- */

function clickSparePart(elemClicked) {

  let link       = elemClicked.attr('data-link');
  let partNumber = elemClicked.attr('data-part-number');

  if (applicationFeatures.itemDetails)      insertDetails(link, paramsItemDetails);
  if (applicationFeatures.itemAttachments)  insertAttachments(link, paramsItemAttachments);

  viewerSelectModel(partNumber, { highlight : false, isolate : true });
  bomDisplayItemByPartNumber(partNumber, true, true);

}


/* -------------------------------------------------------------------------------------------------
 *  Viewer events
 * ------------------------------------------------------------------------------------------------- */

function initViewerDone() {
  $('#viewer-markup-image').attr('data-field-id', 'IMAGE_1');
}

function viewerClickResetDone() {}

function onViewerSelectionChanged(event) {

  if (viewerHideSelected(event)) return;
  if (disableViewerSelectionEvent) return;

  if (event.dbIdArray.length === 1) {

    let proceed = true;
    let parents = getComponentParents(event.dbIdArray[0]);

    for (let parent of safeArr(parents)) {
      if (!proceed) break;

      let partNumber = parent.partNumber;
      if (isBlank(partNumber)) continue;

      $('.bom-item').removeClass('selected');
      $('.bom-item').each(function() {
        if (!proceed) return;

        if ($(this).attr('data-part-number') === partNumber) {
          proceed = false;

          let linkItem = $(this).attr('data-link');

          $(this).addClass('selected');
          bomDisplayItem($(this));
          setSparePartsList($(this));
          updateRelatedPanels(linkItem);
        }
      });
    }

  } else if (event.dbIdArray.length === 0) {

    let elemContext = $('.bom-item.selected-context');
    $('.bom-item').removeClass('selected');

    if (elemContext.length === 0) {
      resetSparePartsList();
      resetBOMPath('bom');
    } else {
      let linkItem = elemContext.attr('data-link');
      elemContext.addClass('selected');
      bomDisplayItem(elemContext);
      setSparePartsList(elemContext);
      updateBOMPath($(this));
      updateRelatedPanels(linkItem);
    }

  } else {
    resetSparePartsList();
  }

  updatePanelCalculations('bom');
}

function updateViewer(partNumber) {

  partNumber = s(partNumber, '');

  disableViewerSelectionEvent = true;

  let selectedBOMNode = $('.bom-item.selected').first();

  if (partNumber !== '') {
    viewerSelectModel(partNumber, { highlight : false, isolate : true });
  } else if (selectedBOMNode.length === 1) {
    partNumber = selectedBOMNode.attr('data-part-number');
    viewerSelectModel(partNumber, { highlight : false, isolate : true });
  } else {
    viewerResetSelection(true, false);
  }

  disableViewerSelectionEvent = false;
}


/* -------------------------------------------------------------------------------------------------
 *  Cart
 * ------------------------------------------------------------------------------------------------- */

function addCartItem(elemClicked) {

  let elemSparePart = elemClicked.closest('.spare-part');
  let root = elemSparePart.attr('data-root');

  // Prevent duplicate by root
  let alreadyInCart = false;
  $('#cart-list').children('.spare-part').each(function() {
    if ($(this).attr('data-root') === root) alreadyInCart = true;
  });
  if (alreadyInCart) {
    adjustCartHeight();
    return;
  }

  elemSparePart.addClass('in-cart');
  if (elemSparePart.hasClass('has-components')) elemSparePart.next().addClass('in-cart');

  let elemCartItem = $('<div></div>').appendTo($('#cart-list'))
    .addClass('tile spare-part')
    .attr('data-link', elemSparePart.attr('data-link'))
    .attr('data-root', root)
    .attr('data-title', elemSparePart.attr('data-title'))
    .attr('data-type', elemSparePart.attr('data-type'))
    .attr('data-part-number', elemSparePart.attr('data-part-number'))
    .attr('data-qty', elemSparePart.attr('data-qty'));

  elemSparePart.find('.spare-part-image').first().clone(true, true).appendTo(elemCartItem);
  elemSparePart.find('.spare-part-details').first().clone(true, true).appendTo(elemCartItem);

  let elemCartItemSide = $('<div></div>').appendTo(elemCartItem).addClass('spare-part-side');

  let elemCartItemQuantity = $('<div></div>').appendTo(elemCartItemSide)
    .addClass('cart-quantity')
    .click(function(e) { e.preventDefault(); e.stopPropagation(); });

  $('<div></div>').appendTo(elemCartItemQuantity).addClass('cart-quantity-label').html('Qty');
  $('<input></input>').appendTo(elemCartItemQuantity).addClass('cart-quantity-input').val('1');

  $('<div></div>').appendTo(elemCartItemSide)
    .addClass('button icon icon-delete cart-remove')
    .click(function(e) {
      e.preventDefault();
      e.stopPropagation();
      removeCartItem($(this));
    });

  if (applicationFeatures.showStock) {

    elemCartItem.removeClass('spare-part-stock-none spare-part-stock-low spare-part-stock-normal spare-part-stock-custom');

    let stockClass = elemSparePart.attr('data-stock') || '';
    if (!isBlank(stockClass)) elemCartItem.addClass('spare-part-stock-' + stockClass);

    let stockNode = elemSparePart.find('.spare-part-stock').first().clone(true, true);
    stockNode.appendTo(elemCartItemSide);
  }

  adjustCartHeight();
}

function removeCartItem(elemClicked) {

  let elemCartItem = elemClicked.closest('.spare-part');
  let root = elemCartItem.attr('data-root');

  $('#items').find('.spare-part').each(function() {
    if ($(this).attr('data-root') === root) {
      $(this).removeClass('in-cart');
      if ($(this).hasClass('has-components')) $(this).next().removeClass('in-cart');
    }
  });

  elemCartItem.remove();

  adjustCartHeight();
  filterSparePartsByInput();
}

function adjustCartHeight() {

  let elemCart         = $('#cart');
  let countInCart      = $('#cart-list').children().length;
  let topTabs          = 0;
  let heightCart       = 38;
  let heightCartList   = 0;
  let maxHeight        = ($('#main').height() - 50) * 0.5;
  let heightTiles      = 68;
  let isVisible        = elemCart.is(':visible');

  if (countInCart === 0) {

    if (isVisible) elemCart.hide();

  } else if (elemCart.hasClass('collapsed')) {

    if (!isVisible) setTimeout(function() { elemCart.fadeIn(); }, 300);
    topTabs = 100;

  } else {

    if (!isVisible) setTimeout(function() { elemCart.fadeIn(); }, 300);

    heightCart = 68 + (countInCart * heightTiles);

    if (heightCart > maxHeight) {
      heightCart     = maxHeight;
      heightCartList = heightCart - 70;
    } else {
      heightCartList = countInCart * heightTiles;
    }

    topTabs = heightCart + 70;

  }

  elemCart.css('height', heightCart + 'px');
  $('#cart-list').css('height', heightCartList + 'px');
  $('#tabs').css('top', topTabs + 'px');
  $('.tab-group-main').css('top', (56 + topTabs) + 'px');

  updateCartCounter();
}

function updateCartCounter() {

  let count = $('#cart-list').children().length;

  $('#cart-counter').html(count);

  if (count === 0) $('#cart-counter').hide();
  else $('#cart-counter').show();
}


/* -------------------------------------------------------------------------------------------------
 *  Request dialog move
 * ------------------------------------------------------------------------------------------------- */

function setRequestList() {

  $('#cart').addClass('collapsed');

  $('#cart-list').children().each(function() {
    $(this).appendTo($('#request-list'));
  });

  adjustCartHeight();
}

function clearRequestList() {

  $('#cart').removeClass('collapsed');

  $('#request-list').children().each(function() {
    $(this).appendTo($('#cart-list'));
  });

  adjustCartHeight();
}


/* -------------------------------------------------------------------------------------------------
 *  Submit Request
 * ------------------------------------------------------------------------------------------------- */

function submitRequest() {

  if ($('#request-creation-submit').hasClass('disabled')) return;

  $('#request-creation').hide();
  $('#overlay').show();
  $('#overlay-processing').show();

  let params = {
    wsId     : wsSparePartsRequests.id,
    sections : wsSparePartsRequests.sections,
    fields   : [
      { fieldId : 'LINKED_ITEM',              value : { link : links.ebom } },
      { fieldId : 'REQUESTOR_NAME',           value : $('#request-name').val() },
      { fieldId : 'REQUESTOR_COMPANY',        value : $('#request-company').val() },
      { fieldId : 'REQUESTOR_EMAIL',          value : $('#request-e-mail').val() },
      { fieldId : 'REQUESTOR_ADDRESS',        value : $('#request-address').val() },
      { fieldId : 'REQUESTOR_CITY',           value : $('#request-city').val() },
      { fieldId : 'REQUESTOR_POSTAL_CODE',    value : $('#request-postal').val() },
      { fieldId : 'REQUESTOR_COUNTRY_CODE',   value : $('#request-country').val() },
      { fieldId : 'REQUEST_SHIPPING_ADDRESS', value : $('#request-shipping-address').val() },
      { fieldId : 'REQUEST_COMMENTS',         value : $('#reqeust-comments').val() }
    ]
  };

  $.post({
    url         : '/plm/create',
    contentType : 'application/json',
    data        : JSON.stringify(params)
  }, function(response) {

    if (!response.error) {

      $('#request-list').children().each(function() {

        let link         = $(this).attr('data-link');
        let quantity     = $(this).find('.cart-quantity-input').val();
        let availability = $(this).find('.spare-part-stock-label').html();

        let paramsRow = {
          wsId : wsSparePartsRequests.id,
          link : response.data.split('.autodeskplm360.net')[1],
          data : [
            { fieldId : 'ITEM',                  value : { link : link } },
            { fieldId : 'QUANTITY',              value : quantity },
            { fieldId : 'AVAILABILITY_AT_REQUEST', value : availability }
          ]
        };

        $.post('/plm/add-grid-row', paramsRow, function() {});
      });

      $('#request-list').children().each(function() { $(this).prependTo($('#items-content')); });

      showSuccessMessage('Request has been created successfuly.');
    }

    $('#overlay').hide();
    $('.spare-part.selected').each(function() { $(this).click(); });

  });

}
