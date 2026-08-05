// Transforms Fusion Manage item data into an ERP-neutral shape (ref/label/description only -
// no Dolibarr-specific fields here, those live in erpDolibarrClient.js's ensureProduct/ensureBOM).
// Item Number is a tenant-defined custom field (see CLAUDE.md), so it is looked up by fieldId.
// The item/field JSON has no flat `.fieldId` string - the id is the last path segment of the
// field's `__self__` link (e.g. ".../views/1/fields/NUMBER" -> "NUMBER").

function extractFieldValue(itemData, fieldId) {

    if (!itemData || !Array.isArray(itemData.sections)) return null;

    for (const section of itemData.sections) {
        for (const field of section.fields || []) {
            const currentFieldId = field.__self__ ? field.__self__.split('/').pop() : field.fieldId;
            if (currentFieldId === fieldId && field.value !== null && field.value !== undefined) {
                return (typeof field.value === 'object') ? (field.value.title || field.value.value) : field.value;
            }
        }
    }

    return null;
}

function extractItemRef(itemData, itemNumberFieldId) {
    return extractFieldValue(itemData, itemNumberFieldId) || itemData.dmsId || `FM-${itemData.urn}`;
}

// Same section/field traversal as extractFieldValue, but returns the field's own __self__ link -
// needed to PATCH a field's value without guessing which view it lives on (used by the Lean
// Change Order failure notification to write a status/link into a tenant-defined field).
function findFieldSelf(itemData, fieldId) {

    if (!itemData || !Array.isArray(itemData.sections)) return null;

    for (const section of itemData.sections) {
        for (const field of section.fields || []) {
            const currentFieldId = field.__self__ ? field.__self__.split('/').pop() : field.fieldId;
            if (currentFieldId === fieldId) return field.__self__;
        }
    }

    return null;
}

function extractLifecycleTitle(itemData) {
    return (itemData && itemData.lifecycle && itemData.lifecycle.title) || null;
}

function transformItem(itemData, itemNumberFieldId) {
    return {
        ref         : extractItemRef(itemData, itemNumberFieldId),
        label       : itemData.title || 'Untitled',
        description : itemData.description || ''
    };
}

function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

// Required-field check always runs (harmless - real data never has a blank ref/label). The
// max-length rule (e.g. TimeLine's 40-char field limit) only runs when maxTextLength is passed
// in explicitly - defaults to off so today's Dolibarr transfers can't regress from a rule that
// exists for a different, not-yet-connected ERP. Too long is rejected, never silently truncated.
function validateNeutralItem(item, context, options) {

    const maxTextLength = (options && options.maxTextLength) || 0;
    const violations    = [];

    if (isBlank(item.ref))   violations.push({ field: context + '.ref', value: item.ref, rule: 'required' });
    if (isBlank(item.label)) violations.push({ field: context + '.label', value: item.label, rule: 'required' });

    if (maxTextLength > 0) {
        ['ref', 'label', 'description'].forEach(function(field) {
            const value = item[field];
            if (typeof value === 'string' && value.length > maxTextLength) {
                violations.push({ field: context + '.' + field, value: value, rule: 'max' + maxTextLength + 'chars' });
            }
        });
    }

    return violations;
}

// Thrown instead of a plain Error so callers can tell "data was rejected by validation" apart
// from "the ERP/PLM call itself failed" (see erpTransferService.js / status 'rejected' vs 'error').
class ValidationError extends Error {
    constructor(violations) {
        super('Validation failed: ' + violations.map(function(v) { return v.field + ' (' + v.rule + ')'; }).join('; '));
        this.violations  = violations;
        this.isRejection = true;
    }
}

module.exports = { transformItem, extractItemRef, extractLifecycleTitle, findFieldSelf, validateNeutralItem, ValidationError };
