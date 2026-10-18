# DeployMate Architecture

**Last updated:** 19 October 2026  
**Current milestone:** Policy-aware execution and isolation; edge-case and security review remain in progress.

## Product direction

DeployMate is an evidence-driven software lifecycle assistant intended to help developers assess and improve release readiness.

**Target workflow:** **Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

Deterministic tools collect evidence; AI reasons from that evidence; the user retains control over consequential actions. Planned capabilities should not be presented as implemented until verified.

## High-level architecture

1. **Discovery:** inspect project metadata, packages, workspaces, lockfiles, and declared scripts without executing them.
2. **Policy:** decide whether a requested check is permitted, needs approval, or is blocked.
3. **Validation:** confirm check type, script, package manager, component path, and command metadata.
4. **Staging:** create a filtered disposable copy of the target project.
5. **Execution:** run the selected supported check in a constrained Docker container.
6. **Normalization:** convert raw process outcomes into a validated shared result contract.
7. **Reporting:** present discovered capabilities separately from execution evidence.
8. **Future phases:** diagnostics, AI planning, approval-based repairs, verification, UI, documentation, and deployment.

## Discovery/reporting flow

1. `agent/src/index.js` receives the target repository path.
2. `discoverPackages()` identifies project components.
3. Package-manager and workspace discovery inspect lockfiles and workspace metadata.
4. `discoverChecks()` identifies recognized lint, test, build, and type-check scripts.
5. `discoverOperationalScripts()` identifies operational `dev` and `start` scripts.
6. `printReport()` displays package details, discovered scripts, and warnings.
7. Discovery labels scripts as not run; finding a script is not evidence that it succeeds.

## Module responsibilities

| File | Responsibility |
|---|---|
| `agent/src/index.js` | CLI orchestration |
| `agent/src/report.js` | Terminal report formatting |
| `agent/src/discovery/discoverPackages.js` | Package/component discovery |
| `agent/src/discovery/detectPackageManager.js` | Package-manager and lockfile detection |
| `agent/src/discovery/discoverWorkspaces.js` | Workspace discovery |
| `agent/src/checks/discoverChecks.js` | Quality-check inventory |
| `agent/src/checks/discoverOperationalScripts.js` | Operational-script inventory |
| `agent/src/execution/result.js` | Shared result schema and invariants |
| `agent/src/execution/runner.js` | Runner-interface validation |
| `agent/src/execution/policy.js` | Policy profiles and authorization decisions |
| `agent/src/execution/policyRunner.js` | Policy gate before delegating to a runner |
| `agent/src/execution/dockerRunner.js` | Check/script/path/package-manager validation |
| `agent/src/execution/dockerProcess.js` | Docker process lifecycle and execution limits |
| `agent/src/execution/resultAdapter.js` | Normalize raw execution outcomes |
| `agent/src/execution/workspace.js` | Filtered disposable workspace staging |
| `agent/src/execution/dockerPolicyRunner.js` | Orchestrate policy, validation, staging, execution, cleanup, and adaptation |
| `agent/test/` | Automated unit, integration, and smoke tests |

## Execution policy

The policy layer supports `restricted`, `standard`, and `custom` profiles, with decisions such as `allowed`, `requires_approval`, and `blocked`. It considers trust, check types, operational scripts, requested capabilities, network/secrets access, and limits. A non-allowed decision must prevent staging and execution. Approval must not override explicit security denials.

Policy is authorization logic, not OS-level isolation.

## Validation and staged execution

The Docker check validator confirms supported check types, script candidates, package metadata and script/command consistency, component path containment, and package-manager resolution from lockfiles. The process layer executes supported npm checks against the staged copy rather than mounting the original project.

The workspace copy excludes common dependency/build/cache directories and common environment/private-key filenames, skips symlinks and special entries, and enforces configured file-count and total-byte limits. These filters reduce exposure but cannot guarantee that every secret is found.

## Result contract

Statuses are `not_run`, `passed`, `failed`, `timed_out`, `blocked`, and `skipped`. Results include execution identity, component/type, script/command, runner, working directory, timestamps, exit code, stdout/stderr, duration, and structured error where available.

- `passed` requires exit code `0`.
- `failed` requires a non-null, non-zero exit code.
- A timeout or infrastructure failure may not have a meaningful process exit code; do not invent one.
- Setup failures are represented as `not_run` with structured error details.
- Cleanup failure must not be silently represented as clean success.

## Reported Docker controls

The local implementation uses the pinned Node image digest:

`node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`

The reported Docker configuration includes disabled networking, user `1000:1000`, read-only root filesystem, dropped capabilities, `no-new-privileges`, PID limit 128, memory limit 512 MiB, CPU limit 1, temporary writable `/tmp`, timeout handling, bounded output, and cleanup attempts. These settings reduce risk; they do not establish complete sandbox security.

## Current technical follow-up

Review the error path in `dockerPolicyRunner.js`: if result adaptation throws after the inner code has already attempted workspace cleanup, the outer catch may attempt cleanup again. Add a focused regression test and make the smallest safe fix after confirming the behavior.

## Roadmap boundary

Discovery and script inventory are complete. Policy-aware Docker execution and staging are implemented and covered by the reported tests, but security and edge-case review continue. Deterministic diagnostics, AI planning, approval-based repairs/verification, UI, and deployment remain future phases.
