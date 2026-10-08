// Reproducible local demo data for the sourcing engine. Never written to Fusion Manage. Each scenario
// below is asserted by test/sourcing/demoData.test.js so the seed cannot drift from what the UI demos.
//
//   ITM-1001 Flange housing (qty 100, required in ~60 days):
//     SUP-A  obvious best (PASS, 3 clean purchases, fair price, on time)
//     SUP-B  cheapest, but tolerance class too coarse -> technical FAIL
//     SUP-C  PASS, shortest lead time, no history -> no fake confidence; wins when the date is urgent
//     SUP-D  PASS, but rising rejects -> poor quality trend
//     SUP-E  capability says material not offered, yet 2 past purchases exist -> CAPABILITY_HISTORY_CONFLICT
//     SUP-F  no capability record at all -> UNKNOWN
//     ITM-1001-STD standard-profile alternative, bought from SUP-G
//   ITM-2002 Shaft (family 'shaft'):
//     ITM-2001 (same family) was bought twice from SUP-C -> similarity evidence; price breaks flip A/C with quantity

const items = [
    { id: 'ITM-1001', title: 'Flange housing, machined', family: 'housing',
        requirements: { process: 'cnc_milling', material: 'aluminium_6082', toleranceClass: 'fine', maxDimensionMm: 320, certifications: ['ISO9001'] } },
    { id: 'ITM-1001-STD', title: 'Flange housing, standard profile (catalog)', family: 'housing', standardProfileOf: 'ITM-1001',
        requirements: { process: 'catalog', material: 'aluminium_6082' } },
    { id: 'ITM-2001', title: 'Shaft, turned, 42CrMo4, short', family: 'shaft',
        requirements: { process: 'cnc_turning', material: '42CrMo4', toleranceClass: 'fine', maxDimensionMm: 400 } },
    { id: 'ITM-2002', title: 'Shaft, turned, 42CrMo4, long', family: 'shaft',
        requirements: { process: 'cnc_turning', material: '42CrMo4', toleranceClass: 'fine', maxDimensionMm: 600 } },
];

const suppliers = [
    { id: 'SUP-A', name: 'Alpenmetall Praezision GmbH', country: 'AT', status: 'APPROVED' },
    { id: 'SUP-B', name: 'BudgetParts Asia Ltd.', country: 'VN', status: 'APPROVED' },
    { id: 'SUP-C', name: 'Castello Meccanica S.r.l.', country: 'IT', status: 'APPROVED' },
    { id: 'SUP-D', name: 'Donau Fertigung GmbH', country: 'DE', status: 'CONDITIONAL' },
    { id: 'SUP-E', name: 'Elbe Zerspanung GmbH', country: 'DE', status: 'APPROVED' },
    { id: 'SUP-F', name: 'Fjord Machining AS', country: 'NO', status: 'APPROVED' },
    { id: 'SUP-G', name: 'Gernot Normteile KG', country: 'DE', status: 'APPROVED' },
];

const capabilities = [
    { supplierId: 'SUP-A', source: 'quote', updatedAt: '2026-09-15', processes: ['cnc_milling', 'cnc_turning'], materials: ['aluminium_6082', '42CrMo4', 'S355'],
        toleranceClass: 'precision', maxDimensionMm: 800, certifications: ['ISO9001', 'ISO14001'], leadTimeDays: 21, capacityPerMonth: 2000,
        priceBreaks: [{ minQty: 1, unitPrice: 48 }, { minQty: 100, unitPrice: 44 }, { minQty: 500, unitPrice: 41 }] },
    { supplierId: 'SUP-B', source: 'quote', updatedAt: '2026-09-20', processes: ['cnc_milling'], materials: ['aluminium_6082'],
        toleranceClass: 'medium', maxDimensionMm: 500, certifications: ['ISO9001'], leadTimeDays: 45, capacityPerMonth: 5000,
        priceBreaks: [{ minQty: 1, unitPrice: 29 }, { minQty: 100, unitPrice: 26 }, { minQty: 500, unitPrice: 22 }] },
    { supplierId: 'SUP-C', source: 'profile', updatedAt: '2026-08-30', processes: ['cnc_milling', 'cnc_turning'], materials: ['aluminium_6082', '42CrMo4'],
        toleranceClass: 'fine', maxDimensionMm: 650, certifications: ['ISO9001'], leadTimeDays: 12, capacityPerMonth: 800,
        priceBreaks: [{ minQty: 1, unitPrice: 55 }, { minQty: 100, unitPrice: 52 }, { minQty: 500, unitPrice: 50 }] },
    { supplierId: 'SUP-D', source: 'profile', updatedAt: '2026-07-10', processes: ['cnc_milling'], materials: ['aluminium_6082'],
        toleranceClass: 'fine', maxDimensionMm: 400, certifications: ['ISO9001'], leadTimeDays: 25, capacityPerMonth: 1500,
        priceBreaks: [{ minQty: 1, unitPrice: 46 }, { minQty: 100, unitPrice: 43 }] },
    { supplierId: 'SUP-E', source: 'profile', updatedAt: '2026-01-05', processes: ['cnc_milling'], materials: ['S355', 'steel_c45'],
        toleranceClass: 'fine', maxDimensionMm: 350, certifications: ['ISO9001'], leadTimeDays: 20, capacityPerMonth: 1000,
        priceBreaks: [{ minQty: 1, unitPrice: 45 }] },
    // SUP-F: deliberately no capability record (UNKNOWN scenario)
    { supplierId: 'SUP-G', source: 'catalog', updatedAt: '2026-09-01', processes: ['catalog'], materials: ['aluminium_6082'],
        toleranceClass: 'medium', maxDimensionMm: 300, certifications: ['ISO9001'], leadTimeDays: 5, capacityPerMonth: 10000,
        priceBreaks: [{ minQty: 1, unitPrice: 19 }] },
];

// Dates are absolute so the seed is reproducible; `now` in tests is fixed to 2026-10-07.
const history = [
    { id: 'PO-24-011', supplierId: 'SUP-A', itemId: 'ITM-1001', date: '2025-11-03', quantity: 100, unitPrice: 45, currency: 'EUR', promisedDate: '2025-11-24', deliveredDate: '2025-11-22', rejectedQty: 0 },
    { id: 'PO-25-004', supplierId: 'SUP-A', itemId: 'ITM-1001', date: '2026-03-12', quantity: 150, unitPrice: 44, currency: 'EUR', promisedDate: '2026-04-02', deliveredDate: '2026-04-01', rejectedQty: 0 },
    { id: 'PO-25-019', supplierId: 'SUP-A', itemId: 'ITM-1001', date: '2026-07-08', quantity: 120, unitPrice: 44, currency: 'EUR', promisedDate: '2026-07-29', deliveredDate: '2026-07-29', rejectedQty: 1 },
    { id: 'PO-24-030', supplierId: 'SUP-D', itemId: 'ITM-1001', date: '2025-09-15', quantity: 100, unitPrice: 42, currency: 'EUR', promisedDate: '2025-10-10', deliveredDate: '2025-10-12', rejectedQty: 0 },
    { id: 'PO-25-002', supplierId: 'SUP-D', itemId: 'ITM-1001', date: '2026-01-20', quantity: 100, unitPrice: 42, currency: 'EUR', promisedDate: '2026-02-14', deliveredDate: '2026-02-20', rejectedQty: 2 },
    { id: 'PO-25-011', supplierId: 'SUP-D', itemId: 'ITM-1001', date: '2026-05-05', quantity: 100, unitPrice: 43, currency: 'EUR', promisedDate: '2026-05-30', deliveredDate: '2026-06-06', rejectedQty: 8 },
    { id: 'PO-25-022', supplierId: 'SUP-D', itemId: 'ITM-1001', date: '2026-08-18', quantity: 100, unitPrice: 43, currency: 'EUR', promisedDate: '2026-09-12', deliveredDate: '2026-09-20', rejectedQty: 15 },
    { id: 'PO-23-087', supplierId: 'SUP-E', itemId: 'ITM-1001', date: '2024-10-02', quantity: 80, unitPrice: 47, currency: 'EUR', promisedDate: '2024-10-22', deliveredDate: '2024-10-21', rejectedQty: 0 },
    { id: 'PO-24-003', supplierId: 'SUP-E', itemId: 'ITM-1001', date: '2025-02-11', quantity: 80, unitPrice: 47, currency: 'EUR', promisedDate: '2025-03-03', deliveredDate: '2025-03-05', rejectedQty: 1 },
    { id: 'PO-25-015', supplierId: 'SUP-G', itemId: 'ITM-1001-STD', date: '2026-06-02', quantity: 200, unitPrice: 19, currency: 'EUR', promisedDate: '2026-06-07', deliveredDate: '2026-06-06', rejectedQty: 0 },
    { id: 'PO-25-008', supplierId: 'SUP-C', itemId: 'ITM-2001', date: '2026-02-24', quantity: 60, unitPrice: 27, currency: 'EUR', promisedDate: '2026-03-10', deliveredDate: '2026-03-09', rejectedQty: 0 },
    { id: 'PO-25-020', supplierId: 'SUP-C', itemId: 'ITM-2001', date: '2026-07-15', quantity: 80, unitPrice: 26, currency: 'EUR', promisedDate: '2026-07-29', deliveredDate: '2026-07-28', rejectedQty: 0 },
];

// Shaft quotes (ITM-2002): A is cheaper at volume, C is cheaper for small lots -> quantity flips the ranking.
const shaftCapabilities = [
    { supplierId: 'SUP-A', source: 'quote', updatedAt: '2026-09-15', processes: ['cnc_milling', 'cnc_turning'], materials: ['aluminium_6082', '42CrMo4', 'S355'],
        toleranceClass: 'precision', maxDimensionMm: 800, certifications: ['ISO9001', 'ISO14001'], leadTimeDays: 21, capacityPerMonth: 2000,
        priceBreaks: [{ minQty: 1, unitPrice: 30 }, { minQty: 200, unitPrice: 21 }] },
    { supplierId: 'SUP-C', source: 'quote', updatedAt: '2026-09-18', processes: ['cnc_milling', 'cnc_turning'], materials: ['aluminium_6082', '42CrMo4'],
        toleranceClass: 'fine', maxDimensionMm: 650, certifications: ['ISO9001'], leadTimeDays: 12, capacityPerMonth: 800,
        priceBreaks: [{ minQty: 1, unitPrice: 26 }, { minQty: 200, unitPrice: 25 }] },
];

// Capabilities are per supplier AND per item family in a real tenant; the demo keeps one record per
// supplier for housings and a second quote set for shafts. capabilitiesFor(item) picks the right set.
function capabilitiesFor(item) {
    return item && item.family === 'shaft' ? shaftCapabilities : capabilities;
}

module.exports = { items, suppliers, capabilities, shaftCapabilities, history, capabilitiesFor };
