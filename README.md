# DeployMate

DeployMate is an evidence-driven software lifecycle and release-readiness agent. Its intended workflow is:

**Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

Deterministic tools collect evidence; AI reasons over that evidence; consequential modifications and deployments should require explicit user approval.

## Current status — 21 October 2026

- **Implemented:** repository/package/workspace discovery, package-manager and lockfile detection, check and operational-script inventory, terminal reporting, shared execution-result schema, policy decisions, check validation, disposable workspace staging, Docker process execution, result normalization, policy-aware orchestration, and foundational deterministic diagnostics.
- **Execution evidence:** the developer shared a full-suite run with **159 tests passed, 0 failed** before the latest Git merge/push. The run included a Docker timeout smoke test. The suite has not been independently rerun during this documentation update, and a post-merge rerun remains a next-session task.
- **End-to-end smoke tests:** a disposable Node project passed through the approved Docker path. A deliberately failing test was correctly reported as FAILED with exit code 1 and a CHECK_FAILED diagnostic.
- **Known CLI issue:** both the successful and deliberately failing smoke-test invocations returned process exit code 0. agent/src/index.js currently sets a non-zero exit code for orchestration/fatal errors but does not consistently propagate unsuccessful requested check outcomes. Fix this before relying on DeployMate in CI/CD.
- **Security boundary:** dependency installation is not a working end-to-end capability; it fails closed without a configured restricted-network mechanism. Docker controls reduce risk but do not prove complete isolation.
- **Open work:** fix and test CLI exit codes; rerun the full suite after the merge; finish staging/Docker/output/security edge-case review; then test a representative project. AI planning, approval-based repairs, UI, and deployment integrations remain future capabilities.
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
