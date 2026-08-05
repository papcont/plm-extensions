# Project Onboarding

Use this when another customer/project should reuse this extension environment.

## Rule

Do not copy this repo per customer. Keep one main extension workspace and isolate customers with:

- `environments/<tenant>.js`
- `settings/<tenant>.js`
- generated discovery evidence in `docs/tenant-discovery/`

## Project Model

Other projects do not become parallel full repos inside this repo. Treat them as source material, then decide:

- shared extension: move into the normal seven-piece app shape and enable per tenant with `server.servicesEnabled.<endpoint>`.
- customer-specific extension: keep the same app shape, but put workspace IDs, field IDs, labels, and enabled state in `settings/<tenant>.js`.
- reference-only project: keep only a short pointer/intake note; do not make it runtime code.

The difference between "main" and customer work is configuration first, code second. Fork the code only when the customer behavior cannot be expressed as a tenant setting or a small custom hook.

## Steps

1. Create or copy `environments/<tenant>.js`.
2. Set `exports.tenant`, `exports.redirectUri`, and `exports.settings`.
3. Run the usecase pipeline:

```powershell
npm run usecases -- docs/tenant-discovery/<tenant>-initial.json
```

4. Review:

- `docs/EXTENSION-PORTFOLIO-BRIEF.md`
- `docs/TENANT-EXTENSION-ADOPTION-MATRIX.md`
- `docs/tenant-discovery/<tenant>-extension-overrides.template.js`

5. Copy only confirmed overrides into `settings/<tenant>.js`.
6. Set `server.servicesEnabled.<endpoint>` to `true` only for selected extensions after workspace IDs and browser checks are confirmed.
7. Start the tenant:

```powershell
npm start <tenant>
```

8. Browser-verify the selected endpoints before any tenant write automation.

## Extension Selection

Enable an extension for a customer when:

- it has tenant workspace evidence,
- required workspace IDs are confirmed,
- the read-only shell renders,
- console/network checks are clean enough for a first demo.

Keep unused extensions disabled only through `server.servicesEnabled` in the customer settings delta.

## No-Guess Boundary

If the adoption matrix says `ID needed`, do not fill the value from memory. Confirm it in Fusion Manage first.
