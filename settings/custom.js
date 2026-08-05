// ---------------------------------------------------------------------------------------------------------------------------
//  INSTRUCTIONS
// ---------------------------------------------------------------------------------------------------------------------------
//  This template file should be used to adjust the configuration settings of the UX server
//  Instead of changing the given settings in settings.js, it is recommended to update then in here.
//  This default file contains the most frequently changed settings only
//  Anyway, you can copy/paste any setting to be overwritten from settings.js in here
//  All settings provided in this custom file will overwrite the matching settings in settings.js
//  This only works if the exact same structure of the settings is reused
//  So if exports.config.abom.bomLabel should be changed, you have to define this value as exports.config.abom.bomLabel in here.
//  This file contains the key configuration elements already (exports.config, exports.menu, exports.chrome)
//  Do not remove these elements but instead paste the settings to change into these elements
//  You can find some exmaples of frequently changed settings below as comments
//  Changes to this file only get applied when restarting the server
// ---------------------------------------------------------------------------------------------------------------------------



// ---------------------------------------------------------------------------------------------------------------------------
//  CUSTOM WORKSPACE DEFINITION
// ---------------------------------------------------------------------------------------------------------------------------
exports.common = {

    workspaceIds : {

        // Product Development Workspaces
        changeOrders                 : 84,
        changeRequests               : 83,
        changeTasks                  : 80,
        designReviews                : 76,
        designReviewTasks            : 77,
        documents                    : 71,
        engineeringProjects          : 573,
        engineeringProjectActivities : 571,
        items                        : 57,
        itemVariants                 : 241,
        konfiguratix                 : 637,
        nonConformances              : 98,
        problemReports               : 82,
        requirements                 : 143,
        viesFreigabe                 : 934,
        visiTest                     : 736,
        visiTestMeeting              : 737,

        // Products & Projects Workspaces
        products               : 95,
        projects               : 86,
        projectTasks           : 90,

        // Supplier Collaboration Workspaces
        sparePartsRequests     : 208,
        supplierPackages       : 147,
        service                : 1000,

        // Asset Management Workspaces
        orderProjects          : 908,
        orderProjectDeliveries : 903,
        orderProjectTasks      : 905,
        serialNumbers          : 901,
        serializedItems        : 282,
        assets                 : 904,
        assetItems             : 906,
        assetGroups            : 902,
        assetServices          : 907,

    },

    workspaces: {
        items : {
            defaultBOMView : 'Tree Navigator', // This BOM view should contain columns Descriptor, Number (see next setting) and BOM Quantity only
            fieldIdNumber  : 'NUMBER'
        }
    },

    viewer : {
        numberProperties   : ['Bauteilnummer','Part Number', 'Name', 'label', 'Artikelnummer'],
        suffixPrimaryFile  : ['.iam.dwf', '.iam.dwfx', '.ipt.dwf', '.ipt.dwfx'],
        extensionsIncluded : ['dwf', 'dwfx', 'nwd', 'ipt', 'stp', 'step', 'sldprt', 'pdf'],
        standardFeatures   : {}
    }

}



// ---------------------------------------------------------------------------------------------------------------------------
//  CUSTOM APPLICATION SETTINGS
// ---------------------------------------------------------------------------------------------------------------------------
exports.applications = {

    abom : {
        // bomLabel : 'Asset BOM',
        // assetItems : {
        //     workspaceId : 282
        // },
        // orderProjectDeliveries : {
        //     workspaceId : 279
        // },
    },
    classes        : {},
    compare        : {},
    configurator   : {},
    dashboard      : {},
    editor         : {},
    erp            : {
        // Freigabestatus-Gate (Plan A Phase 3) - unset = deaktiviert, heutiges Verhalten unveraendert
        // releasedLifecycleValues : ['Released'],

        // Lean Change Order -> automatischer BOM-Transfer, sobald Status "Approved" (1167) erreicht
        // ist. LIVE via Cloudflare Quick Tunnel (temporaer - URL aendert sich bei jedem Neustart
        // des Tunnels, dann hier aktualisieren + POST /erp/webhooks/register erneut aufrufen).
        leanChangeOrderWebhook : {
            workspaceId            : 1033,               // Lean Change Orders
            workflowId             : 1,
            transitionIds          : [1778, 1787, 1789], // alle 3 fuehren nach "Approved"
            approvedLifecycleTitle : 'Approved',
            callbackUrl            : 'https://inf-agreed-file-according.trycloudflare.com/erp/webhooks/lean-change-order',
            secret                 : 'acf0fcf4362a0cf8d753b545fe2f7ebf757624745219ed44'

            // Optional: nach 3 gescheiterten Versuchen (30s/2min/10min Backoff) einen Link+Fehlertext
            // in dieses Feld auf dem Change-Order-Item schreiben und danach dieses On-Demand-Script
            // ausloesen (das Script selbst - in Fusion Manage angelegt - verschickt die Mail).
            // Unset = deaktiviert, heutiges Verhalten unveraendert.
            // notifyOnFailure : {
            //     fieldId  : 'ERP_TRANSFER_ERROR', // Text-Feld auf Workspace 1033
            //     scriptId : 0                     // On-Demand-Script-ID auf Workspace 1033
            // }
        }
    },
    explorer       : {},
    impactanalysis : {},
    insights       : {},
    instances      : {
        // tabs : [{
        //     workspaceId : 308
        // }]
    },
    matrix         : {},
    mbom           : {
        // workspaceEBOM : {
        //     workspaceId : null, // uses common.workspaceIds.items per default
        // }, 
        // workspaceMBOM : {
        //     workspaceId : null, // uses common.workspaceIds.items per default
        // }
    },
    portal         : {
        // panels : {
        //     insertSearch      : {},
        //     insertRecentItems : {},
        //     insertBOM         : {},
        //     insertDetails     : {},
        //     insertDetails     : {},
        // },
        // viewerFeatures  : {
        //     contextMenu : false
        // }   
    },
    portfolio      : {},
    projects       : {},
    reports        : {},
    reviews        : {},
    sbom           : {},
    service        : {},
    variants       : {
        // workspaceItemVariants : {
            // workspaceId : 571,
        // }
    },
    worklist       : {},
    installedBaseService : {
        // "Equipment" is not a separate workspace in this tenant - it is covered by Asset Management (Assets/Asset Services)
        workspaces : [{
            key   : 'assets',
            label : 'Assets',
            role  : 'Installed assets'
        }, {
            key   : 'assetItems',
            label : 'Asset Items',
            role  : 'Asset master data'
        }, {
            key   : 'assetGroups',
            label : 'Asset Groups',
            role  : 'Asset grouping'
        }, {
            key   : 'assetServices',
            label : 'Asset Services',
            role  : 'Service events'
        }, {
            key   : 'serialNumbers',
            label : 'Serial Numbers',
            role  : 'Serialized instances'
        }]
    },
    addins : {}

}



// ---------------------------------------------------------------------------------------------------------------------------
//  CUSTOM MAIN MENU SETTINGS
// ---------------------------------------------------------------------------------------------------------------------------
exports.menu = []




// ---------------------------------------------------------------------------------------------------------------------------
//  SERVER ROUTING
// ---------------------------------------------------------------------------------------------------------------------------
exports.server = {
    landingPage     : '',  // Set the default URL to be opened if no app URL is provided (default is '')
    servicesEnabled : {}   // Defines the applications to enable. When an application is set to false, an error 404 page will be shown when users try accessing the given page.
}



// ---------------------------------------------------------------------------------------------------------------------------
//  CUSTOM CHOROME EXTENSION SETTINGS
// ---------------------------------------------------------------------------------------------------------------------------
exports.chrome = {
    customStyle : true
}