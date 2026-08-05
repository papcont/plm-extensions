// Tenant extension override template.
// Tenant: contelosuxdemo
// Copy needed blocks into settings/<tenant>.js after confirming workspace IDs in Fusion Manage.
// Do not commit secrets. Do not guess workspace IDs.

exports.applications = {

    installedBaseService : {

        workspaceIds : {
            assets                   : null, // default/common: 280
            assetItems               : null, // default/common: 282
            assetGroups              : null, // TODO confirm tenant workspace ID
            assetServices            : null, // default/common: 284
            serialNumbers            : null, // default/common: 277
            equipments               : null, // default/common: 280
            equipmentServices        : null, // default/common: 284
        }

    },

    supplierCenter : {

        workspaceIds : {
            supplierPackages         : null, // default/common: 147
            sparePartsRequests       : null, // default/common: 241
            items                    : null, // default/common: 57
            problemReports           : null, // default/common: 82
            nonConformances          : null, // default/common: 98
        }

    },

    releaseReadiness : {

        workspaceIds : {
            items                    : null, // default/common: 57
            viesFreigabe             : null, // TODO confirm tenant workspace ID
            changeRequests           : null, // default/common: 83
            changeOrders             : null, // default/common: 84
            changeTasks              : null, // default/common: 80
        }

    },

    qualityClosure : {

        workspaceIds : {
            problemReports           : null, // default/common: 82
            nonConformances          : null, // default/common: 98
            supplierPackages         : null, // default/common: 147
            items                    : null, // default/common: 57
            changeRequests           : null, // default/common: 83
            changeOrders             : null, // default/common: 84
        }

    },

    launchReadiness : {

        workspaceIds : {
            orderProjects            : null, // default/common: 283
            orderProjectDeliveries   : null, // default/common: 279
            orderProjectTasks        : null, // TODO confirm tenant workspace ID
            engineeringProjects      : null, // default/common: 213
            engineeringProjectActivities : null, // default/common: 211
            projectTasks             : null, // default/common: 90
        }

    },

    requirementsCoverage : {

        workspaceIds : {
            requirements             : null, // default/common: 143
            items                    : null, // default/common: 57
            designReviews            : null, // default/common: 76
            designReviewTasks        : null, // default/common: 77
            visiTest                 : null, // TODO confirm tenant workspace ID
            visiTestMeeting          : null, // TODO confirm tenant workspace ID
            changeRequests           : null, // default/common: 83
        }

    },

    dppReadiness : {

        workspaceIds : {
            items                    : null, // default/common: 57
            documents                : null, // TODO confirm tenant workspace ID
            products                 : null, // default/common: 95
            supplierPackages         : null, // default/common: 147
            requirements             : null, // default/common: 143
            changeRequests           : null, // default/common: 83
        }

    },

    productTraceability : {

        workspaceIds : {
            items                    : null, // default/common: 57
            documents                : null, // TODO confirm tenant workspace ID
            products                 : null, // default/common: 95
            changeRequests           : null, // default/common: 83
            changeOrders             : null, // default/common: 84
            requirements             : null, // default/common: 143
        }

    },

    variantGovernance : {

        workspaceIds : {
            itemVariants             : null, // TODO confirm tenant workspace ID
            konfiguratix             : null, // TODO confirm tenant workspace ID
            items                    : null, // default/common: 57
            changeRequests           : null, // default/common: 83
            documents                : null, // TODO confirm tenant workspace ID
        }

    },

    designReviewClosure : {

        workspaceIds : {
            designReviews            : null, // default/common: 76
            designReviewTasks        : null, // default/common: 77
        }

    },

    sparePartsDesk : {

        workspaceIds : {
            sparePartsRequests       : null, // default/common: 241
            service                  : null, // TODO confirm tenant workspace ID
            serialNumbers            : null, // default/common: 277
            items                    : null, // default/common: 57
            supplierPackages         : null, // default/common: 147
            problemReports           : null, // default/common: 82
        }

    },

    bomExportAttachmentStudio : {

        workspaceIds : {
            items                    : null, // default/common: 57
            documents                : null, // TODO confirm tenant workspace ID
        }

    },

    testValidationHub : {

        workspaceIds : {
            visiTest                 : null, // TODO confirm tenant workspace ID
            visiTestMeeting          : null, // TODO confirm tenant workspace ID
            items                    : null, // default/common: 57
            documents                : null, // TODO confirm tenant workspace ID
            designReviews            : null, // default/common: 76
            changeRequests           : null, // default/common: 83
        }

    },

};

exports.server = {
    servicesEnabled : {
        'installed-base-service' : false, // demo candidate; browser check needed
        'supplier-center' : false, // demo candidate; browser check needed
        'release-readiness' : false, // demo candidate; browser check needed
        'quality-closure' : false, // preview only; tenant evidence needed
        'launch-readiness' : false, // demo candidate; browser check needed
        'requirements-coverage' : false, // preview only; tenant evidence needed
        'dpp-readiness' : false, // preview only; tenant evidence needed
        'product-traceability' : false, // demo candidate; browser check needed
        'variant-governance' : false, // demo candidate; browser check needed
        'design-review-closure' : false, // demo candidate; browser check needed
        'spare-parts-desk' : false, // demo candidate; browser check needed
        'bom-export-attachment-studio' : false, // demo candidate; browser check needed
        'test-validation-hub' : false, // demo candidate; browser check needed
    }
};
