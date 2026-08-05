#!/usr/bin/env node
// Fusion Manage MCP server - stdio JSON-RPC, no dependencies (node >= 18 fetch).
// ponytail: 7 generic tools instead of mirroring all ~200 routes of routes/plm.js.
// fm_get/fm_post are the escape hatch for every endpoint we did not name explicitly.
// Adopted from a customer deployment's ai/mcp/fm-mcp - see external/README.md intake process.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CONFIG = process.env.FM_TENANTS ?? path.join(HERE, 'tenants.json');
const ALLOW_WRITE = process.env.FM_ALLOW_WRITE === '1';

const tenants = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const tokens = new Map(); // alias -> { value, expires }

function cfg(alias) {
    const c = tenants[alias];
    if (!c) throw new Error(`unknown tenant alias '${alias}'. known: ${Object.keys(tenants).join(', ')}`);
    return c;
}

async function token(alias) {
    const c = cfg(alias);
    const cached = tokens.get(alias);
    if (cached && cached.expires > Date.now()) return cached.value;

    const res = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
        method: 'POST',
        headers: {
            accept: 'application/json',
            authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
            'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: c.scope ?? 'data:read' })
    });
    if (!res.ok) throw new Error(`auth failed for '${alias}': ${res.status} ${await res.text()}`);
    const data = await res.json();
    tokens.set(alias, { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 });
    return data.access_token;
}

async function call(alias, method, urlPath, body) {
    const c = cfg(alias);
    const base = c.baseUrl ?? `https://${c.tenant}.autodeskplm360.net`;
    const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tenant': c.tenant,
        Authorization: 'Bearer ' + (await token(alias))
    };
    if (c.userId) headers['x-user-id'] = c.userId;

    const res = await fetch(base + (urlPath.startsWith('/') ? urlPath : '/' + urlPath), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 800)}`);
    try { return JSON.parse(text); } catch { return text; }
}

// ---- diff -------------------------------------------------------------------
const KEYS = ['name', 'title', 'fieldId', 'id', 'urn', 'link'];

function keyOf(o, i) {
    for (const k of KEYS) if (o && typeof o === 'object' && o[k] != null) return String(o[k]);
    return `#${i}`;
}

// Structural diff. Arrays of objects are matched by a natural key, not by index,
// so a reordered field list does not read as a change.
export function diff(a, b, at = '') {
    const out = [];
    if (Array.isArray(a) && Array.isArray(b)) {
        const ma = new Map(a.map((v, i) => [keyOf(v, i), v]));
        const mb = new Map(b.map((v, i) => [keyOf(v, i), v]));
        for (const [k, v] of ma) {
            if (!mb.has(k)) out.push({ path: `${at}[${k}]`, only_in: 'a', a: v });
            else out.push(...diff(v, mb.get(k), `${at}[${k}]`));
        }
        for (const [k, v] of mb) if (!ma.has(k)) out.push({ path: `${at}[${k}]`, only_in: 'b', b: v });
        return out;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (!(k in a)) out.push({ path: `${at}.${k}`, only_in: 'b', b: b[k] });
            else if (!(k in b)) out.push({ path: `${at}.${k}`, only_in: 'a', a: a[k] });
            else out.push(...diff(a[k], b[k], `${at}.${k}`));
        }
        return out;
    }
    if (a !== b) out.push({ path: at || '/', a, b });
    return out;
}

// ---- tools ------------------------------------------------------------------
const S = (props, required) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });

const TOOLS = {
    fm_tenants: {
        description: 'List configured tenant aliases usable as the "alias" argument of the other tools.',
        schema: S({}, []),
        run: () => Object.fromEntries(Object.entries(tenants).map(([k, v]) => [k, { tenant: v.tenant, note: v.note ?? '' }]))
    },
    fm_get: {
        description: 'Raw authenticated GET against a tenant, e.g. path "/api/v3/workspaces/57/sections". Covers every read endpoint of the Fusion Manage REST API.',
        schema: S({ alias: str('tenant alias'), path: str('API path starting with /api/') }, ['alias', 'path']),
        run: ({ alias, path: p }) => call(alias, 'GET', p)
    },
    fm_post: {
        description: 'Raw authenticated POST against a tenant. Disabled unless the server runs with FM_ALLOW_WRITE=1.',
        schema: S({ alias: str('tenant alias'), path: str('API path'), body: { type: 'object', description: 'JSON payload' } }, ['alias', 'path', 'body']),
        run: ({ alias, path: p, body }) => {
            if (!ALLOW_WRITE) throw new Error('writes disabled: start the server with FM_ALLOW_WRITE=1');
            return call(alias, 'POST', p, body);
        }
    },
    fm_workspaces: {
        description: 'List all workspaces of a tenant (id, name).',
        schema: S({ alias: str('tenant alias'), limit: { type: 'number', description: 'default 250' } }, ['alias']),
        run: async ({ alias, limit = 250 }) => {
            const r = await call(alias, 'GET', `/api/v3/workspaces?offset=0&limit=${limit}`);
            const items = r.items ?? r.workspaces ?? r;
            return Array.isArray(items)
                ? items.map((w) => ({ id: w.id ?? w.link?.split('/').pop(), name: w.name ?? w.title })).sort((x, y) => String(x.name).localeCompare(String(y.name)))
                : r;
        }
    },
    fm_fields: {
        description: 'List the field definitions of one workspace (the metadata you compare when checking two tenants for config drift).',
        schema: S({ alias: str('tenant alias'), wsId: str('workspace id'), view: str('view id, default 1') }, ['alias', 'wsId']),
        run: ({ alias, wsId, view = '1' }) => call(alias, 'GET', `/api/v3/workspaces/${wsId}/views/${view}/fields`)
    },
    fm_diff: {
        description: 'Fetch the same API path from two tenants and return the structural differences. Use for workspace/field/picklist config drift between e.g. sandbox and production.',
        schema: S({ aliasA: str('first tenant alias'), aliasB: str('second tenant alias'), path: str('API path to compare on both') }, ['aliasA', 'aliasB', 'path']),
        run: async ({ aliasA, aliasB, path: p }) => {
            const [a, b] = await Promise.all([call(aliasA, 'GET', p), call(aliasB, 'GET', p)]);
            const d = diff(a, b);
            return { a: aliasA, b: aliasB, path: p, differences: d.length, changes: d.slice(0, 500) };
        }
    },
    fm_snapshot: {
        description: 'Write a tenant metadata snapshot (workspaces + fields) to docs/tenant-discovery/snapshots/. Snapshots are the corpus for later diffing and comparison.',
        schema: S({ alias: str('tenant alias'), project: str('project/customer folder, e.g. a customer slug'), wsIds: { type: 'array', items: { type: 'string' }, description: 'omit for all workspaces' } }, ['alias', 'project']),
        run: async ({ alias, project, wsIds }) => {
            const stamp = new Date().toISOString().slice(0, 10);
            const dir = path.join(ROOT, 'docs', 'tenant-discovery', 'snapshots', project, `${alias}-${stamp}`);
            fs.mkdirSync(dir, { recursive: true });

            const workspaces = await TOOLS.fm_workspaces.run({ alias });
            fs.writeFileSync(path.join(dir, 'workspaces.json'), JSON.stringify(workspaces, null, 2));

            const targets = wsIds ?? workspaces.map((w) => String(w.id));
            const written = [];
            for (const id of targets) {
                try {
                    const fields = await call(alias, 'GET', `/api/v3/workspaces/${id}/views/1/fields`);
                    fs.writeFileSync(path.join(dir, `fields-${id}.json`), JSON.stringify(fields, null, 2));
                    written.push(id);
                } catch (e) {
                    written.push(`${id}:ERROR ${e.message.slice(0, 120)}`);
                }
            }
            return { dir, workspaces: workspaces.length, fields: written };
        }
    }
};

// ---- MCP stdio --------------------------------------------------------------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(req) {
    if (req.method === 'initialize') {
        return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fm-mcp', version: '0.1.0' } };
    }
    if (req.method === 'tools/list') {
        return { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })) };
    }
    if (req.method === 'tools/call') {
        const tool = TOOLS[req.params?.name];
        if (!tool) throw new Error(`unknown tool ${req.params?.name}`);
        const result = await tool.run(req.params.arguments ?? {});
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    }
    throw new Error(`unsupported method ${req.method}`);
}

let buffer = '';
process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try { req = JSON.parse(line); } catch { continue; }
        if (req.id === undefined) continue; // notification
        try {
            send({ jsonrpc: '2.0', id: req.id, result: await handle(req) });
        } catch (e) {
            send({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: e.message } });
        }
    }
});
