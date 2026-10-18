# DeployMate Learning Journal

**Last updated:** 19 October 2026  
**Repository:** `C:\DeployMate`  
**Agent package:** `C:\DeployMate\agent`

## Evidence labels

- **Implemented:** code is present in the current project.
- **Tested:** a test/command result was shared.
- **Planned:** not yet implemented.
- **Unverified:** available evidence does not establish the claim.

## Working principles

DeployMate aims to support **Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**. Deterministic tools collect evidence; AI reasons from evidence; the developer retains control over consequential actions.

Development workflow requirements:
- Explain purpose, design, and trade-offs before code changes.
- Work incrementally, preserve working code, and test each meaningful change.
- Use Windows Command Prompt for terminal commands.
- Never claim a command or test succeeded without confirming output.
- Keep this journal cumulative and update the testing log, architecture, roadmap, security notes, and handover.
- Treat Docker as a risk-reduction layer, not a complete sandbox.

## 17 October 2026 — Read-only discovery baseline

The discovery/reporting milestone inspected project metadata without executing package scripts. It discovers packages/components, package managers and lockfiles, workspaces, recognized quality-check scripts, and operational `dev`/`start` scripts. The report labels discovered scripts `Execution status: NOT RUN`.

The developer reported 26 tests passing at that milestone. Manual command:

```cmd
npm run dev -- "C:\DevLink"
```

The report identified frontend and backend packages and their declared scripts. The root package manager was reported as unknown, with frontend/backend npm lockfiles detected. Discovery does not prove a script succeeds.

## 18–19 October 2026 — Execution layer

### Structured results — `result.js`

The shared result contract defines `not_run`, `passed`, `failed`, `timed_out`, `blocked`, and `skipped`, plus component/type, execution metadata, stdout/stderr, duration, exit code, and structured error. A passed result requires exit code zero; a failed result requires a non-null, non-zero exit code. The invariant avoids contradictory outcomes from different runners.

### Runner interface — `runner.js`

The runner interface validates the presence of `runCheck()`. A replaceable interface allows orchestration to use mocks and alternative execution backends.

### Policy versus sandbox — `policy.js`, `policyRunner.js`

Policy profiles include `restricted`, `standard`, and `custom`; decisions include `allowed`, `requires_approval`, and `blocked`. Policy considers trust, check types, operational scripts, requested capabilities, network/secrets access, and limits. Non-allowed decisions should not reach the runner. Policy is authorization logic; Docker supplies a separate execution boundary.

### Validation versus execution — `dockerRunner.js`

The validator checks the requested check type, script candidates, package metadata, script/command consistency, package manager, and component-path containment. It is deliberately separate from the module that spawns Docker, reducing the risk of metadata discovery triggering arbitrary commands.

### Disposable staging — `workspace.js`

The staging layer creates a filtered temporary copy rather than mounting the original project. Recorded exclusions include `.git`, `node_modules`, `.deploymate`, `.next`, `coverage`, common `.env` variants, private-key/certificate extensions, and common SSH key names. Symlinks and special entries are skipped. Reported limits are 20,000 files and 250 MiB; regular files receive restrictive permissions. Filename filtering cannot guarantee comprehensive secret detection.

### Docker lifecycle — `dockerProcess.js`

The implementation uses a pinned Node image and reports controls including disabled networking, non-root user, read-only root filesystem, dropped capabilities, no-new-privileges, PID/memory/CPU limits, temporary writable `/tmp`, timeout, bounded output, and cleanup. These controls reduce risk but do not prove an absolute sandbox boundary.

### Result adaptation and orchestration

`resultAdapter.js` maps raw Docker outcomes into the shared schema and avoids inventing exit codes for infrastructure failures. `dockerPolicyRunner.js` coordinates policy, validation, staging, Docker execution, cleanup, and result adaptation. Setup failures become structured `not_run` results.

**Open review issue:** the outer catch in `dockerPolicyRunner.js` may call workspace cleanup a second time if result adaptation throws after cleanup has already been attempted. This path needs a focused regression test.

## Test evidence shared on 19 October 2026

Focused command from `C:\DeployMate\agent`:

```cmd
node --test test/dockerPolicyRunner.test.js
```

Developer-shared result: **13 passed, 0 failed**, approximately 244 ms. Scenarios include policy denial/approval, staging, non-zero exits, timeout, Docker exception normalization, cleanup failures, limit forwarding, and setup validation.

Full suite:

```cmd
npm test
```

Developer-shared result: **113 passed, 0 failed**, 0 cancelled/skipped/todo, approximately 5.64 seconds. The output included discovery, policy, result validation, Docker validation/process lifecycle, reporting, result adaptation, workspace staging, integration tests, and the Docker timeout smoke test.

The smoke test intentionally timed out after about five seconds, reported `timed_out`, `SIGTERM`, successful cleanup and process closure, and printed `PASS: Docker timeout handling behaved as expected.` This is expected output from a passing test.

## Concepts reinforced

- Discovery is not execution.
- Authorization, validation, isolation, execution, normalization, and reporting have separate responsibilities.
- Do not fabricate exit codes for timeouts or infrastructure failures.
- Cleanup failure must not silently produce a clean-success claim.
- Passing tests support the scenarios exercised; they do not establish production readiness.

## Next session

1. Inspect current `dockerPolicyRunner.js` and `resultAdapter.js`.
2. Add a regression test for adapter failure after cleanup and verify whether double cleanup can occur.
3. Explain the smallest safe fix before changing code.
4. Run focused tests, then `npm test`.
5. Review staging permissions, partial-copy failures, secret exclusions, cleanup telemetry, and actual Docker restrictions.
6. Update the journal and testing/security/handover documents with actual outcomes.
