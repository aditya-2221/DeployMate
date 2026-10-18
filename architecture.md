# DeployMate Architecture

**Last documented:** 18 October 2026  
**Current milestone:** Read-only repository discovery; Phase 1.1 execution contract and result model added on a feature branch  
**Next milestone:** Test the model locally, then design controlled execution and isolation

## Product direction

DeployMate is an evidence-driven software lifecycle assistant intended to help make applications release-ready. The planned workflow is:

**Inspect → Exercise/diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

The current CLI implementation remains limited to repository discovery and reporting. The Phase 1.1 additions define an execution result contract and runner shape only; they do not execute project commands.

## Current module flow

1. `index.js` reads the target repository path from command-line arguments.
2. `discoverPackages()` discovers project components.
3. `discoverChecks()` identifies recognized lint, test, build, and type-check scripts.
4. `discoverOperationalScripts()` identifies `dev` and `start` scripts.
5. `printReport()` prints package details, check inventory, operational scripts, and warnings.
6. Errors are caught and reported with a nonzero process exit code.

The new `src/execution/` directory is not wired into the CLI.

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
| `agent/src/execution/result.js` | Execution statuses, schema, result factory and validation |
| `agent/src/execution/runner.js` | Shape-check for the replaceable runner contract; does not invoke it |
| `agent/test/` | Automated tests |

## Current data and classifications

Recognized quality checks:
- Lint: `lint`, `lint:check`, `eslint`
- Test: `test`, `test:unit`, `test:ci`
- Build: `build`, `build:prod`
- Type-check: `typecheck`, `type-check`, `check:types`

Recognized operational scripts: `dev`, `start`.

Recognition only means a matching non-empty script declaration was found. It does not mean the command was executed or that the application works.

## Phase 1.1 execution result contract

The proposed schema includes:
- `executionId`: nullable execution identifier.
- `component`, `type`: required component and check classification.
- `script`, `command`: nullable selected script and declared command.
- `status`: one of `not_run`, `passed`, `failed`, `timed_out`, `blocked`, `skipped`.
- `runner`, `workingDirectory`: nullable runner identity and working directory.
- `startedAt`, `finishedAt`: nullable ISO date-time strings; both must be set together.
- `exitCode`: nullable integer process exit code.
- `stdout`, `stderr`: captured output strings (empty by default).
- `durationMs`: nullable, non-negative duration.
- `error`: nullable structured object with `code`, `message`, and optional `details`.

The schema enforces that `passed` requires exit code 0 and `failed` requires a non-zero exit code. A process-start failure, policy block, or timeout can have a null exit code. The schema is data validation, not proof that an execution really occurred.

`createExecutionResult()` creates and validates a complete record. `validateExecutionResult()` returns Zod's `safeParse` result. `assertRunner()` checks only that a runner object exposes a `runCheck` function; it never calls that function.

## Runner contract

A future runner is expected to implement:

```js
runCheck(check, options) -> executionResult
```

The execution engine is not implemented yet. The runner must later enforce validated working directories, explicit execution policy, timeout and resource limits, safe output handling, and cleanup. Docker is the intended isolation backend, but no Docker integration is implemented by this change.

## Planned roadmap

1. Repository and package discovery — completed.
2. Quality-check and operational-script inventory — completed.
3. Execution interface and result model — implemented on feature branch; local tests still need to be run.
4. Controlled execution and evidence collection — after model tests and isolation design.
5. Failure diagnosis and repair planning — later.
6. Approval-based repair and regression verification — later.
7. API, dashboard, deployment workflow, and handover evidence — later.

## Important limitation

The execution model and runner shape are not wired into the CLI and do not run project scripts. No execution engine, evidence-backed diagnosis, repair planner, or deployment workflow has been implemented. Do not claim that an inspected project is release-ready based only on package metadata.
