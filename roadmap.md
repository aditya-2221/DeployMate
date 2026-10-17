# DeployMate — Product Roadmap

## Phase 0: Read-Only Repository Discovery — Completed

**Goal:** Understand a project's structure without modifying files or executing its scripts.

- Detect project packages and components.
- Identify frontend and backend packages.
- Detect package managers.
- Discover available scripts for linting, testing, building, and type-checking.
- Identify operational scripts such as `dev` and `start`.
- Generate a structured terminal report.
- Clearly distinguish discovered capabilities from verified results.

**Current status:** Implemented and tested with 26 passing tests. Tested against DevLink, including its frontend and backend.

## Phase 1: Execution Engine and Isolation

**Goal:** Execute project checks safely and collect verifiable evidence.

- Build a reusable command-execution interface.
- Introduce Docker-based isolation for running project commands.
- Capture command, working directory, exit code, standard output, standard error, and duration.
- Apply timeouts and resource limits.
- Distinguish between checks that are unavailable, not run, passed, failed, or timed out.
- Prevent untrusted project scripts from running directly on the host.
- Store structured execution results for later analysis.

**Deliverable:** DeployMate can run selected checks in an isolated environment and produce reproducible execution evidence.

## Phase 2: Deterministic Diagnostics

**Goal:** Turn raw execution results into useful, evidence-backed findings.

- Parse lint, build, test, and type-check output.
- Identify common configuration and dependency problems.
- Group related errors and avoid duplicate findings.
- Record file paths, line numbers, error messages, and supporting logs where available.
- Classify findings by severity and category.
- Distinguish confirmed failures from warnings and uncertain diagnoses.
- Generate a prioritized list of issues.

**Deliverable:** A structured diagnostic report that explains what failed and provides evidence for each finding.

## Phase 3: AI-Powered Analysis and Planning

**Goal:** Use AI to interpret evidence and produce actionable remediation plans.

- Integrate an LLM through a configurable provider interface.
- Supply the model with repository metadata, command results, logs, and diagnostic findings.
- Generate concise explanations of failures.
- Identify likely root causes and distinguish them from symptoms.
- Propose prioritized, minimal fixes.
- Identify dependencies between fixes.
- Explain expected impact, risks, and verification steps.
- Reference available evidence instead of inventing errors or claiming unverified success.

**Important design principle:** Deterministic tools collect evidence; AI reasons over that evidence. AI-generated conclusions remain hypotheses until verified.

**Deliverable:** An evidence-grounded AI release-readiness plan.

## Phase 4: Approval-Based Repairs and Verification

**Goal:** Allow DeployMate to propose changes and verify their outcomes without making uncontrolled modifications.

- Generate minimal patches or diffs.
- Explain each proposed change and why it is needed.
- Display before-and-after changes for review.
- Require explicit user approval before applying modifications.
- Preserve the original files and support rollback.
- Rerun relevant checks after an approved repair.
- Compare results before and after the change.
- Mark fixes as verified only when supported by execution evidence.
- Detect regressions and report unresolved issues.

**Deliverable:** A controlled repair loop: diagnose, plan, approve, modify, verify.

## Phase 5: DeployMate User Interface

**Goal:** Make the workflow accessible without relying entirely on terminal output.

Core interface areas:

- **Projects:** Add and manage local repositories.
- **Project Overview:** Show repository structure and overall readiness.
- **Checks:** Display discovered and executed checks, statuses, and logs.
- **Findings:** Present prioritized issues with supporting evidence.
- **AI Plan:** Show proposed fixes, rationale, risks, and verification steps.
- **Diff Review:** Review and approve proposed changes.
- **Run History:** Compare executions and track changes over time.
- **Settings:** Configure execution limits, AI providers, and project preferences.

The architecture must account for access to local repositories. A browser-based UI alone cannot freely inspect a user's local filesystem, so DeployMate will need an appropriate local agent, CLI, or desktop integration.

**Deliverable:** A usable end-to-end workflow from repository inspection to verified fixes.

## Phase 6: Documentation and Release Readiness

**Goal:** Produce reliable handover material from actual project evidence.

- Generate a repository summary.
- Document architecture and detected technologies.
- Summarize available checks and their latest results.
- Report unresolved issues and known limitations.
- Generate a release-readiness checklist.
- Produce a technical handover document.
- Export reports in convenient formats.
- Separate verified facts from recommendations and unknowns.

**Deliverable:** An evidence-based report that helps developers understand what is ready, what is broken, and what remains to be done.

## Phase 7: Deployment Integration

**Goal:** Extend DeployMate from local verification to a controlled deployment workflow.

- Select one deployment platform for the initial integration.
- Validate deployment prerequisites and required configuration.
- Check for missing environment variables without exposing their values.
- Verify build output and deployment configuration.
- Generate a deployment plan before taking action.
- Require approval before deployment.
- Capture deployment logs and status.
- Run post-deployment health checks.
- Provide rollback guidance where supported.

**Deliverable:** One reliable deployment workflow rather than several incomplete integrations.

## Phase 8: Reliability, Security, and Production Readiness

**Goal:** Make DeployMate safer, more predictable, and suitable for real projects.

- Strengthen execution isolation and resource controls.
- Protect secrets in logs and reports.
- Validate paths and command inputs.
- Implement structured logging and actionable error handling.
- Add tests for failure scenarios and malicious or malformed repositories.
- Track execution history and audit consequential actions.
- Add configurable timeouts, cancellation, and cleanup.
- Improve support for monorepos and different project structures.
- Document limitations and supported environments.
- Evaluate diagnostic accuracy and repair success rates.

**Deliverable:** A more robust product with measurable reliability and clearly defined safety boundaries.

---

## Recommended Implementation Order

1. **Repository discovery — completed:** Packages, scripts, checks, and reports.
2. **Execution and evidence — next:** Isolated command execution and structured results.
3. **Diagnostics:** Convert execution output into reliable findings.
4. **AI analysis and planning:** Explain failures and recommend evidence-grounded fixes.
5. **Approved repairs and verification:** Review changes, apply them with permission, and rerun checks.
6. **UI, documentation, and deployment:** Turn the core workflow into a usable, demonstrable product.

## Core Product Principle

Build a reliable execution and evidence layer before trusting AI to diagnose or repair code. Deterministic tools collect evidence; AI reasons over that evidence; the user controls consequential changes. This creates a stronger foundation for accurate recommendations, safe changes, and a convincing hackathon demonstration.
