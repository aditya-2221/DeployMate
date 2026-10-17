# DeployMate Architecture

**Last documented:** 17 October 2026  
**Current milestone:** Read-only repository discovery and script inventory  
**Next milestone:** Controlled check execution and evidence collection

## Product direction

DeployMate is an evidence-driven software lifecycle assistant intended to help make applications release-ready. The planned workflow is:

**Inspect → Exercise/diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

The current implementation is limited to repository discovery and reporting. Later capabilities are planned, not yet implemented.

## Current module flow

1. `index.js` reads the target repository path from command-line arguments.
2. `discoverPackages()` discovers project components.
3. `discoverChecks()` identifies recognized lint, test, build, and type-check scripts.
4. `discoverOperationalScripts()` identifies `dev` and `start` scripts.
5. `printReport()` prints package details, check inventory, operational scripts, and warnings.
6. Errors are caught and reported with a nonzero process exit code.

## Current files

| File | Responsibility |
|---|---|
| `agent/src/index.js` | CLI orchestration |
| `agent/src/report.js` | Report formatting |
| `agent/src/discovery/discoverPackages.js` | Package discovery |
| `agent/src/discovery/detectPackageManager.js` | Package manager and lockfile detection |
| `agent/src/discovery/discoverWorkspaces.js` | Workspace discovery |
| `agent/src/checks/discoverChecks.js` | Recognized quality-check inventory |
| `agent/src/checks/discoverOperationalScripts.js` | Operational script inventory |
| `agent/test/` | Automated tests |

## Current data and classifications

Recognized quality checks:
- Lint: `lint`, `lint:check`, `eslint`
- Test: `test`, `test:unit`, `test:ci`
- Build: `build`, `build:prod`
- Type-check: `typecheck`, `type-check`, `check:types`

Recognized operational scripts: `dev`, `start`.

Recognition only means a matching non-empty script declaration was found. It does not mean the command was executed or that the application works.

## Confirmed inspected repository: `C:\DevLink`

### Frontend
- Package manager: npm
- Recognized operational script: `dev: vite`
- Recognized checks: `build: vite build`, `lint: eslint .`
- Other declared script observed: `preview: vite preview`
- No recognized test or type-check script was found.

### Backend
- Package manager: npm
- Recognized operational scripts:
  - `dev: nodemon -r dotenv/config --experimental-json-modules src/index.js`
  - `start: node src/index.js`
- No recognized lint, test, build, or type-check script was found.

The root package manager was reported as `unknown`; separate frontend and backend npm lockfiles were detected, but no root lockfile was found.

## Next architecture milestone: execution layer

The runner should be separate from discovery and reporting. Proposed responsibilities:

- Accept an explicitly selected check and a validated working directory.
- Apply an execution policy before starting a process.
- Execute through a replaceable backend, initially intended to use Docker isolation.
- Apply timeouts and resource controls.
- Capture stdout, stderr, exit code, duration, and errors.
- Return structured results for reporting and future diagnosis.

Proposed result shape (design example, not implemented):

```js
{
  component: "frontend",
  type: "build",
  script: "build",
  command: "vite build",
  status: "not_run",
  exitCode: null,
  stdout: "",
  stderr: "",
  durationMs: null,
  error: null
}
```

Potential terminal statuses include `passed`, `failed`, `timed_out`, `blocked`, `skipped`, and `not_run`. Final status definitions should be decided during implementation.

## Planned roadmap

1. Repository and package discovery — completed.
2. Quality-check and operational-script inventory — completed.
3. Execution interface and result model — next.
4. Controlled execution and evidence collection — after isolation is available.
5. Failure diagnosis and repair planning — later.
6. Approval-based repair and regression verification — later.
7. API, dashboard, deployment workflow, and handover evidence — later.

## Important limitation

No execution engine, evidence-backed diagnosis, repair planner, or deployment workflow has been implemented in this documented session. Do not claim that an inspected project is release-ready based only on package metadata.
