// Smoke test - no tenant credentials needed. Run: node tools/fm-mcp/test.mjs
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = path.join(here, 'tenants.example.json');
process.env.FM_TENANTS = config;

const { diff } = await import('./server.mjs');

// order-independent matching by natural key, value changes, adds and removes
assert.deepStrictEqual(diff([{ name: 'A', v: 1 }, { name: 'B', v: 2 }], [{ name: 'B', v: 2 }, { name: 'A', v: 1 }]), []);
assert.strictEqual(diff([{ name: 'A', v: 1 }], [{ name: 'A', v: 9 }]).length, 1);
assert.strictEqual(diff([{ name: 'A' }], [{ name: 'A' }, { name: 'B' }])[0].only_in, 'b');
assert.strictEqual(diff({ a: { b: 1 } }, { a: { b: 1 } }).length, 0);
console.log('ok  diff');

const server = spawn(process.execPath, [path.join(here, 'server.mjs')], { env: { ...process.env, FM_TENANTS: config } });
const replies = [];
let buf = '';
server.stdout.on('data', (c) => {
    buf += c;
    const lines = buf.split('\n');
    buf = lines.pop();
    lines.filter((l) => l.trim()).forEach((l) => replies.push(JSON.parse(l)));
});
server.stderr.on('data', (c) => console.error(String(c)));

const say = (id, method, params) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
say(1, 'initialize', {});
say(2, 'tools/list', {});
say(3, 'tools/call', { name: 'fm_tenants', arguments: {} });

await new Promise((r) => setTimeout(r, 800));
server.kill();

assert.strictEqual(replies.length, 3, `expected 3 replies, got ${JSON.stringify(replies)}`);
assert.strictEqual(replies[0].result.serverInfo.name, 'fm-mcp');
assert.strictEqual(replies[1].result.tools.length, 7);
assert.ok(JSON.parse(replies[2].result.content[0].text)['example-tenant']);
console.log('ok  mcp protocol (7 tools)');
process.exit(0);
