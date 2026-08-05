---
name: fm-mcp-maintenance
description: Maintain the local Fusion Manage MCP server in tools/fm-mcp without bloating it.
---

# FM MCP maintenance

Use this when the task touches `tools/fm-mcp/`.

## Constraints

- Keep the server dependency-free.
- Use Node's built-in `fetch`; do not add an SDK unless the user explicitly wants one.
- Keep write operations gated behind `FM_ALLOW_WRITE=1`.
- Preserve the current tool model unless there is a clear need to change it.

## Files

- `tools/fm-mcp/server.mjs` - MCP server
- `tools/fm-mcp/test.mjs` - smoke test
- `tools/fm-mcp/tenants.example.json` - config template (real aliases go in `tools/fm-mcp/tenants.json`, gitignored)
- `docs/tenant-discovery/snapshots/` - `fm_snapshot` output, one subfolder per project/customer slug

## Existing behavior worth keeping

- Tenant alias config is external (`tenants.json`, gitignored, never committed).
- Token caching is per alias.
- Diffing matches arrays by natural keys instead of raw index.
- The test should stay runnable without live credentials (`tenants.example.json` only).

## Change checklist

1. Inspect `server.mjs` before adding any new helper.
2. Prefer extending one existing tool over adding several wrappers.
3. Run `node tools/fm-mcp/test.mjs`.
4. If behavior changes, note it in this file's "Existing behavior worth keeping" section.
