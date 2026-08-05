# Usecase Automation Index

Purpose: quick entrypoint for deriving new Fusion Manage extensions from repo evidence and tenant discovery.

## Start Here

1. Run the pipeline:

```powershell
npm run usecases -- docs/tenant-discovery/contelosuxdemo-initial.json
```

2. Check the last run:

```text
docs/USECASE-AUTOMATION-RUN.md
```

3. For the next browser pass, follow:

```text
docs/NEXT-BROWSER-MCP-HANDOFF.md
```

## Which File Answers What

| Question | File |
| --- | --- |
| What is the whole discovery loop? | `docs/USECASE-DISCOVERY-PIPELINE.md` |
| What is the current ranked build order? | `docs/EXTENSION-CANDIDATE-BACKLOG.md` |
| Which tenant workspace supports which extension idea? | `docs/TENANT-WORKSPACE-USECASE-MAP.md` |
| Which planned use case can be promoted after editor evidence? | `docs/USECASE-DECISION-GATES.md` |
| What is the machine-readable current state for tools/agents? | `docs/USECASE-AUTOMATION-MANIFEST.json` |
| What is complete, and what is still blocked by browser evidence? | `docs/GOAL-COMPLETION-AUDIT.md` |
| Which Workspace Editor details are still missing? | `docs/TENANT-DISCOVERY-COVERAGE.md` |
| What should the browser scan next? | `docs/BROWSER-TENANT-SCAN-QUEUE.md` |
| Which planned ideas can be promoted later? | `docs/EXTENSION-PROMOTION-QUEUE.md` |
| Which brainstormed ideas are outside the current archetype loop? | `docs/EXTENSION-WHITESPACE-RADAR.md` |
| Which existing panels should a new extension reuse? | `docs/EXTENSION-REUSE-MAP.md` |
| Which PLM market pains justify the candidates? | `docs/PLM-PAIN-TO-EXTENSION-MAP.md` |
| How do I collect Workspace Manager evidence? | `docs/BROWSER-WORKSPACE-EXTRACTOR.md` |
| How do I collect Workspace Editor details? | `docs/BROWSER-WORKSPACE-EDITOR-EXTRACTOR.md` |
| How do I onboard another tenant/project? | `docs/PROJECT-ONBOARDING.md` |

## Current State

- Implemented read-only shells: 12.
- Planned promotion candidates: 4.
- Current Contelos discovery: 24 Workspace Manager rows, 0 Workspace Editor detail rows.
- Browser gate: internal browser unavailable; Chrome requires explicit approval for the tenant scan.

## Promotion Rule

Do not add a planned candidate to `settings.applications.workspaceHealth.archetypes` until Workspace Editor evidence shows real fields, workflows, relationships, or reports that justify it.

## Write Boundary

No tenant writes from this process. Tenant setup automation starts only after the target tenant, object list, before-state export, expected action, and rollback path are named.
