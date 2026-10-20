# DeployMate — Product Roadmap

**Last updated:** 21 October 2026

DeployMate's goal is an evidence-driven release-readiness workflow: **Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**. Deterministic tools collect evidence; AI reasons over evidence; consequential actions remain under user control.

## Phase 0: Read-Only Repository Discovery — Completed

**Goal:** Understand project structure without modifying files or executing discovered scripts.

- Detect project packages/components and frontend/backend packages.
- Detect package managers and lockfiles.
- Discover workspace package structure.
- Inventory recognized lint, test, build, and type-check scripts.
- Identify operational scripts such as `dev` and `start`.
- Generate a structured terminal report.
- Distinguish declared capabilities from verified results.

**Evidence:** The developer previously reported 26 passing tests and a manual discovery report for DevLink. Available scripts were labelled `Execution status: NOT RUN`.

## Phase 1: Execution Engine and Isolation — Implemented; review ongoing

**Goal:** Execute explicitly selected checks under constraints and collect structured evidence.

Implemented modules:
- Runner interface and shared result schema.
- Execution policy and policy-aware wrapper.
- Check/script/path/package-manager validation.
- Filtered disposable workspace staging.
- Docker process execution with timeout, bounded output, and resource restrictions.
- Raw-result adapter and policy-aware orchestration.

**Latest full-suite evidence shared by the developer:** 159/159 tests passed before the latest Git merge/push. The suite included CLI argument/discovery tests, diagnostic validation cases, Docker execution/cleanup tests, and an intentional timeout smoke test. A post-merge rerun remains outstanding.

**Remaining work before this phase is considered mature:**
- Review cleanup/error handling if result adaptation throws after cleanup has already been attempted.
- Add a regression test for that exact path.
- Review staging permissions, partial-copy failure cleanup, sensitive-file exclusions, and cleanup telemetry.
- Verify the actual Docker invocation enforces the intended restrictions.

## Phase 2: Deterministic Diagnostics — Partially Implemented; Expansion Planned

- Parse lint/build/test/type-check output.
- Identify common configuration and dependency issues.
- Group related errors and avoid duplicate findings.
- Capture file paths, line numbers, messages, and supporting logs when available.
- Classify findings by severity/category.
- Separate confirmed failures from warnings and uncertain diagnoses.
- Produce a prioritized issue list.

**Implemented foundation:** agent/src/diagnostics/diagnose.js generates structured findings for discovery warnings, unavailable checks, policy/approval decisions, malformed evidence, execution-result inconsistencies, conflicting results, and failed/timed-out checks. The CLI invokes diagnostics after discovery and any requested execution; tests cover these deterministic cases.

**Still planned:** richer parsing of arbitrary lint/build/test/type-check output, deeper error grouping/root-cause analysis, and broader source-location extraction. Do not mark the entire phase complete just because the foundational diagnostic engine exists.

**Deliverable:** A structured diagnostic report with evidence for each finding.

## Phase 3: AI-Powered Analysis and Planning — Planned

- Integrate an LLM through a configurable provider interface.
- Supply repository metadata, command results, logs, and diagnostic findings.
- Explain failures and distinguish likely root causes from symptoms.
- Propose prioritized minimal fixes and identify dependencies.
- Explain impact, risks, and verification steps.
- Reference evidence and mark conclusions as hypotheses until verified.

**Deliverable:** An evidence-grounded AI release-readiness plan.

## Phase 4: Approval-Based Repairs and Verification — Planned

- Generate minimal patches/diffs.
- Explain rationale, expected impact, and risk.
- Present before/after changes for review.
- Require explicit approval before applying modifications.
- Preserve originals and support rollback.
- Rerun relevant checks and compare before/after evidence.
- Mark fixes verified only when execution evidence supports the claim.
- Detect regressions and report unresolved issues.

**Deliverable:** Diagnose → plan → approve → modify → verify.

## Phase 5: DeployMate User Interface — Planned

- Projects and project overview.
- Checks, statuses, and logs.
- Evidence-backed findings.
- AI plan and risk explanations.
- Diff review and approval.
- Run history and comparisons.
- Settings for providers, limits, and preferences.

The architecture must provide a safe way for a UI to access local repositories; a browser alone cannot freely inspect a local filesystem.

## Phase 6: Documentation and Release Readiness — Planned expansion

- Repository and architecture summary.
- Detected technologies and check inventory.
- Latest check results and unresolved issues.
- Release-readiness checklist and technical handover.
- Exportable reports.
- Clear separation of verified facts, recommendations, and unknowns.

## Phase 7: Deployment Integration — Planned

- Start with one deployment platform.
- Validate prerequisites and configuration without exposing secret values.
- Generate a deployment plan before action.
- Require approval before deployment.
- Capture deployment logs/status.
- Run post-deployment health checks and provide rollback guidance where supported.

## Phase 8: Reliability, Security, and Production Readiness — Ongoing

- Strengthen isolation and resource controls.
- Protect secrets in logs/reports.
- Validate paths and command inputs.
- Improve structured logs, errors, cancellation, and cleanup.
- Test malicious/malformed repositories and failure scenarios.
- Track execution history and audit consequential actions.
- Improve monorepo support.
- Document supported environments and limitations.
- Measure diagnostic accuracy and repair success.

## Recommended order

1. Discovery and reporting — complete.
2. Execution and evidence — implemented; security/edge-case review ongoing.
3. Deterministic diagnostics.
4. AI analysis and planning.
5. Approval-based repairs and verification.
6. UI and documentation workflow.
7. Deployment integration.
8. Continuous reliability/security hardening.

**Core principle:** build a trustworthy execution/evidence layer before relying on AI to diagnose or repair code. Passing tests are necessary evidence, not proof of production readiness.


## Current cross-phase blocker — CLI exit status

A successful approved Docker smoke test returned exit code 0. A deliberately failing smoke test was correctly reported as FAILED with exit code 1 and CHECK_FAILED, but the DeployMate CLI process also returned exit code 0. This is a confirmed integration defect in agent/src/index.js.

Before relying on DeployMate from CI/CD or treating the execution milestone as mature:
1. Add CLI regression tests for successful and failed requested execution.
2. Make failed, timed-out, policy-blocked, and otherwise unsuccessful requested execution return non-zero.
3. Preserve successful discovery-only behavior.
4. Test timeout and missing-approval behavior.
5. Run the focused CLI tests and full suite.
6. Re-run the full suite after the latest merge/push.

## Repository hygiene follow-up

The inspected GitHub tree contains cli-smoke-test/, docker-smoke-test/, and test-malformed/ fixture directories, plus zero-byte files agent/agent@1.0.0, agent/cd, agent/git, agent/node, and agent/npm. Their intent is unconfirmed; review before removing them. Do not combine unreviewed cleanup with the CLI behavior fix.
