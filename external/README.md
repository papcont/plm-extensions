# external/ — intake zone for existing customer material

Drop **existing, already-partially-adapted customer material** here first — old code, a scattered
project, a folder someone sent you — before deciding what to do with it. Never build against it
in place; it's a waiting room, not a runtime location.

## `external/incoming/<source-name>/`

Temporary. Copy the raw material in as-is. Then, per the Extension Intake Process in
`docs/DEVELOPMENT-ENVIRONMENT-PLAN.md`, decide for each piece:

- **shared extension** → move into the normal seven-piece app shape (`routes/landing.js` entry,
  Pug view, app JS/CSS, `settings.js` block, `server.servicesEnabled` flag) so every tenant can
  opt in.
- **customer-specific extension** → same app shape, but the customer-only bits (workspace IDs,
  field IDs, labels, enabled state) live in `settings/<tenant>.js`, not in shared code.
- **genuinely customer-only code** (per `docs/PROJECT-ONBOARDING.md`: only when the difference
  truly can't be a tenant setting) → `public/javascripts/custom/` or `views/custom/`, referenced
  by that customer's `<customer-slug>.config.json` under `customFiles` (see
  `docs/CUSTOMER-EXTENSIONS-PLAN.md`).
- **reference-only** → don't move any code; just add a one-line pointer to `external/archived/`.

Once triaged, delete the folder from `incoming/` — it's not meant to accumulate. Gitignored
(`external/incoming/*`) since it's throwaway staging, not source of truth.

## `external/archived/<source-name>.txt`

A short pointer file only — original path or repo URL, one or two lines on what it was and why it
wasn't imported as runtime code. Tracked in git (small, useful history of "we looked at this and
decided X"), unlike `incoming/` which never is.
