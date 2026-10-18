# DeployMate

DeployMate is an evidence-driven software lifecycle and release-readiness agent. Its intended workflow is:

**Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

Deterministic tools collect evidence; AI reasons over that evidence; consequential modifications and deployments should require explicit user approval.

## Current status — 19 October 2026

- **Implemented:** repository/package discovery, workspace and package-manager detection, check inventory, operational-script inventory, terminal reporting, execution-result schema, execution policy, Docker check validation/process execution, disposable workspace staging, result normalization, and policy-aware orchestration.
- **Test evidence:** the developer shared local terminal output showing 13/13 focused integration tests and 113/113 full-suite tests passing. The Docker timeout smoke test also passed after intentionally timing out and verifying cleanup/process closure.
- **Open work:** cleanup/error-handling edge-case review, further security validation, deterministic diagnostics, AI analysis/planning, approval-based repair/verification, UI, and deployment integration.
- Passing tests do not establish production readiness or complete sandbox security.

## Documentation

- [Architecture](architecture.md) — module boundaries and execution data flow.
- [Roadmap](roadmap.md) — completed, in-progress, and planned phases.
- [Learning journal](learning-journal.md) — cumulative implementation details and concepts.
- [Testing log](testing-log.md) — test evidence, scope, and gaps.
- [Security notes](security.md) — threat model, safeguards, limitations, and review queue.
- [Session handover](session-handover.md) — next steps for continuing development.

## Local development

The agent package is in `agent/`. From Windows Command Prompt:

```cmd
cd C:\DeployMate\agent
npm test
```

The discovery CLI has previously been run as:

```cmd
npm run dev -- "C:\DevLink"
```

Discovery identifies declared scripts; it does not by itself execute those scripts or prove that a project is healthy.

## Development principles

- Verify claims against code and actual command output.
- Keep discovery, policy, validation, isolation, execution, normalization, and reporting separate.
- Treat repository scripts and dependencies as untrusted unless explicitly authorized.
- Prefer small changes with focused tests, followed by the full suite.
- Require approval for consequential repairs and deployments.
- Treat Docker as a risk-reduction layer, not an absolute security boundary.
