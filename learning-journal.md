# DeployMate Learning Journal — Technical Revision Handbook

**Last updated:** 19 October 2026  
**Repository:** `C:\DeployMate`  
**Agent package:** `C:\DeployMate\agent`

> **Purpose of this journal:** This is the developer's long-term learning and interview-revision record, not just a changelog. For each session, record what was asked, what was implemented or investigated, what the developer learned, how the relevant code works, why the design was chosen, errors and fixes, test evidence, limitations, and likely interview questions. Expand abbreviations and explain concepts so the notes remain useful after months away from the project.

## How to use this handbook

When returning to DeployMate after a break:

1. Read **Project mental model** to recall the overall design.
2. Read the relevant dated session to understand what was built and why.
3. Review **Interview revision questions** and try answering before reading the answer.
4. Use the test log to distinguish verified behavior from assumptions.
5. Check the **Open questions** section before continuing development.

## Evidence labels

- **Implemented:** code is present in the working/reported project state.
- **Tested:** a test or command result was shared and its outcome recorded.
- **Planned:** not yet implemented.
- **Unverified:** available evidence does not establish the claim.
- **Design intent:** the intended behavior; confirm the current source before assuming implementation details have not changed.

---

# 1. Project mental model

## What is DeployMate?

DeployMate is intended to be an evidence-driven software lifecycle and release-readiness assistant. Given a software repository, it should help answer questions such as:

- What components and technologies does this project contain?
- Which lint, test, build, and type-check commands are available?
- Which checks actually run and what did they return?
- What failed, and what evidence supports the diagnosis?
- What is the smallest reasonable fix?
- Should a change be applied, and has it been approved?
- Did the fix pass verification?
- What is still needed before release or deployment?

The intended workflow is:

**Inspect → Execute checks safely → Diagnose → Plan → Request approval → Repair → Verify → Document/deploy/handover**

The critical principle is that AI should reason from concrete evidence, not invent repository facts. Deterministic code gathers facts and executes approved operations; AI can explain findings and propose plans. Consequential changes and deployments should remain under explicit user control.

## Core distinction: discovery is not execution

A package can declare a script such as `"test": "node --test"`. Discovery can report that the script exists, but that does **not** establish that tests pass. A successful execution requires evidence such as the actual command, exit code, output, duration, and execution status.

Keep these states separate:

- **Available/discovered:** metadata says a command exists.
- **Not run:** no execution evidence exists.
- **Passed:** execution completed successfully under the defined result contract.
- **Failed:** execution returned a failure outcome.
- **Timed out:** the configured time limit was reached.
- **Blocked:** policy did not authorize execution.
- **Skipped:** the check was intentionally not performed.

## Architecture in one line

**Discovery → Policy decision → Input validation → Disposable workspace staging → Isolated process execution → Result normalization → Report**

Each stage has one responsibility. Separation makes it easier to test a stage independently, prevent unsafe commands from running too early, and replace a runner without rewriting discovery or reporting.

---

# 2. Session: 17 October 2026 — Read-only discovery baseline

## What the task was

Build the first useful version of DeployMate that can inspect a repository and report its components and declared quality/operational scripts without running those scripts.

## What was implemented / observed

- Package and component discovery.
- Package-manager and lockfile detection.
- Workspace discovery.
- Inventory of recognized lint, test, build, and type-check scripts.
- Inventory of operational `dev` and `start` scripts.
- Terminal report generation.
- Clear `Execution status: NOT RUN` messaging for discovered scripts.

Manual command shared for a DevLink inspection:

```cmd
npm run dev -- "C:\DevLink"
```

The reported output identified frontend and backend components and their declared scripts. The root package manager was reported as unknown while frontend/backend npm lockfiles were detected.

The developer reported **26 tests passing** at that stage. The complete names and coverage of all 26 tests were not preserved, so do not invent them.

## Concepts learned / revision notes

### Why return structured objects rather than print inside every discovery function?

A discovery function should collect and return data; a report function should decide how to display it. This separation allows the same data to support a terminal interface now and potentially an API, web UI, JSON export, or AI analysis later. It also makes unit tests easier because tests can inspect returned values without parsing terminal output.

### Why inventory known scripts instead of running every script found?

A package script is executable code and can do much more than its label suggests. Running arbitrary scripts during initial inspection could modify files, read environment variables, start subprocesses, or access the network. Discovery should therefore be a read-only inventory step.

### What does `for...of` do?

```js
for (const script of componentScripts) {
  // Process the current script.
}
```

The loop processes each array element in sequence. `script` refers to the current element during that iteration. `const` prevents reassignment of that loop variable; it does not mean the loop runs only once.

### What does `===` do?

```js
if (script.status === "available") {
  // Report available-script details.
} else {
  // Report that the script is unavailable.
}
```

Strict equality compares both value and type. Here it chooses the report branch based on the discovered status string.

---

# 3. Session: 18–19 October 2026 — Controlled execution and Docker isolation

## What the task was

Move DeployMate beyond merely listing checks toward running selected checks while protecting the host from untrusted project code. The key design challenge was to keep authorization, validation, filesystem preparation, process execution, and result reporting separate.

## Main question behind the work

**How can DeployMate run a repository's test/build/lint command without casually trusting that repository with the host machine?**

The implemented direction is to:
1. Make a policy decision first.
2. Validate the selected check and project paths.
3. Copy an allowlisted/filtered project workspace into a temporary location.
4. Run the supported command in a constrained Docker container using the staged copy.
5. Capture the process outcome.
6. Normalize the result into one shared schema.
7. Attempt cleanup and report failures honestly.

Docker reduces risk but does not guarantee perfect isolation. Host Docker configuration, mounts, credentials, daemon access, kernel/runtime vulnerabilities, and configuration mistakes remain relevant.

## 3.1 Shared result contract — `agent/src/execution/result.js`

### Why this module exists

Different execution backends and failure paths need to describe outcomes consistently. If each module invents its own status names and fields, reporting and later AI analysis become unreliable. The schema is the contract between execution and the rest of DeployMate.

### Recorded status vocabulary

| Status | Meaning |
|---|---|
| `not_run` | The check did not execute, for example because setup failed. |
| `passed` | Execution completed successfully under the result contract. |
| `failed` | The check ran and returned a non-zero exit code. |
| `timed_out` | The configured execution timeout was reached. |
| `blocked` | Policy or a security gate prevented execution. |
| `skipped` | The check was deliberately not performed. |

The result contract records fields including execution ID, component, check type, script/command, runner, working directory, start/finish timestamps, exit code, stdout, stderr, duration, and structured error details where available.

### Important invariants

- `passed` requires exit code `0`.
- `failed` requires a non-null, non-zero exit code.
- A timeout or infrastructure failure may have no meaningful process exit code.
- Never fabricate an exit code to make an error fit a schema.
- A failure to start the process is different from a process that started and returned a non-zero code.

**Interview explanation:** A result schema is a data contract. It prevents contradictory states and lets downstream consumers interpret results consistently regardless of which runner produced them.

## 3.2 Runner interface — `runner.js`

The runner abstraction checks for a `runCheck()` method. The intent is to let orchestration depend on a stable interface rather than on Docker-specific implementation details.

Why that matters:
- A fake/mock runner can be used in integration tests without launching Docker.
- Another execution backend could be added later behind the same interface.
- Policy orchestration need not know all the low-level process-spawning details.

The interface validates the shape of the runner; it does not itself sandbox or execute the check.

## 3.3 Policy and policy wrapper — `policy.js`, `policyRunner.js`

### What policy decides

The policy layer supports profiles named `restricted`, `standard`, and `custom`. Decisions include `allowed`, `requires_approval`, and `blocked`.

Recorded decision inputs include repository trust, check types, operational scripts, requested capabilities, network/secrets access, and limits. Operational scripts such as `dev` and `start` can have different risk from checks such as lint/test/build/typecheck because they may start persistent services or trigger unexpected behavior.

### Why policy must run before staging and execution

If a check is denied, DeployMate should not waste work creating a workspace or invoke Docker. More importantly, a denied operation should not reach the side-effecting layer at all. Integration tests use fake staging and runner functions to assert that denial prevents those calls.

### Policy is not the sandbox

Policy answers **“Should this operation be permitted?”** Docker and operating-system controls answer **“What can the process access while it runs?”** Both are needed. A policy decision cannot stop a process from accessing the host if the process is launched with unrestricted host permissions.

Approval also must not override a hard security block. Approval is a human authorization step, not a reason to ignore security constraints.

## 3.4 Check validation — `dockerRunner.js`

This module validates a requested check before the Docker process is launched. Recorded validation includes:

- The check type must be supported: lint, test, build, or typecheck.
- The requested script must match an accepted candidate and the package metadata.
- The package script's declared command must match the expected command.
- The component path must remain inside the intended project root.
- The package manager is resolved using lockfiles within the project boundary.
- Ambiguous or unsupported package-manager cases are rejected instead of guessed.

### Why validate both script name and command?

A label such as `test` is just a name. The actual command stored in package metadata is what will run. Validation helps ensure the selected script is the one discovered/approved rather than silently accepting a different command.

### Why resolve paths and check containment?

A relative path containing parent-directory segments, or a symlink/path trick, may point outside the intended component. Path containment checks are intended to keep execution inputs scoped to the project. Path validation must be tested against platform-specific path behavior and filesystem races; a string-prefix check alone is not a robust security boundary.

Validation reduces accidental/malicious input errors, but it is not a replacement for container isolation.

## 3.5 Disposable workspace staging — `workspace.js`

### Why copy files into a temporary workspace?

The container should not mount the original repository as a writable host directory. A disposable staging copy limits which files are exposed to the command and allows the staged workspace to be cleaned after execution.

### Recorded filtering and limits

Excluded directories include:
- `.git`
- `node_modules`
- `.deploymate`
- `.next`
- `coverage`

Recorded sensitive filename patterns include:
- `.env` and `.env.*`
- `.pem`, `.key`, `.p12`, `.pfx`
- `id_rsa`, `id_ed25519`

The staging layer skips symlinks and special entries. Recorded limits are 20,000 files and 250 MiB. Regular files receive restrictive permissions. The staging helper returns information including the staged root, source root, file count, total bytes, and a cleanup function.

### Important limitations to remember

- Filename filtering is not complete secret detection. A secret can be stored under an unexpected filename or embedded in another file.
- Excluding `node_modules` means dependencies may not be available in the staged copy. Dependency installation is not implemented as an automatic default and would need a separate, explicit network/capability policy.
- Copying can fail partway through. Partial workspace creation must be cleaned safely.
- Symlink skipping is a risk reduction, but path traversal, races, permissions, and unusual filesystem entries still deserve testing.
- Temporary workspace cleanup is part of the execution lifecycle, not an optional cosmetic step.

## 3.6 Docker process execution — `dockerProcess.js`

### What it is responsible for

The process layer runs the validated command against the staged workspace, imposes execution limits, captures standard output and standard error, tracks timing and process exit information, handles timeout/termination, and attempts cleanup.

Recorded pinned image:

```text
node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
```

Recorded Docker restrictions:
- Network disabled.
- User `1000:1000`.
- Read-only root filesystem.
- Linux capabilities dropped.
- `no-new-privileges`.
- PID limit 128.
- Memory limit 512 MiB.
- CPU limit 1.
- Temporary writable `/tmp`.
- Execution timeout.
- Bounded captured output.
- Cleanup attempts.

These are the controls recorded for the implementation; verify the current source and actual Docker invocation before relying on any individual flag.

### Timeout behavior

A timeout means the command exceeded the allowed duration. The runner should attempt to terminate the process/container, collect the final available output, clean up resources, and return a truthful `timed_out` result. It should not report a normal pass simply because a termination command was issued.

The smoke test deliberately timed out after approximately five seconds and reported `timed_out`, `SIGTERM`, cleanup success, and process closure. That is the expected outcome of a passing timeout test.

### Output bounds

Capturing unbounded stdout/stderr can exhaust memory or generate oversized logs. The implementation records a maximum output size. Future review should verify how truncation is indicated and whether sensitive output needs redaction before it is persisted or shown.

## 3.7 Result adapter — `resultAdapter.js`

The adapter translates lower-level Docker/process output into the shared result contract. This prevents the Docker implementation's internal result shape from spreading throughout the application.

Important design lesson: an adapter should preserve known facts and avoid inventing missing ones. For example, if Docker could not start the process and there is no exit code, the adapter should not manufacture a non-zero code merely to label the outcome `failed`. A structured `not_run` result with error details can be more accurate.

The adapter is also a critical trust boundary: malformed or contradictory raw results should not become falsely confident success reports.

## 3.8 Policy-aware orchestration — `dockerPolicyRunner.js`

This is the coordination layer. The recorded flow is:

1. Validate the runner and required project context.
2. Ask policy whether the check is allowed.
3. Stop early when policy denies or requires approval.
4. Validate the requested check.
5. Stage a filtered temporary workspace.
6. Run the check through the Docker process layer.
7. Clean up the staged workspace.
8. Adapt the raw result to the shared schema.
9. Return a normalized result, including setup/execution/cleanup errors where applicable.

The integration tests use fakes to verify ordering and to prove that denied checks do not proceed into staging or Docker. This is a useful testing technique for code that coordinates side effects.

### Known open edge case

The outer catch in `dockerPolicyRunner.js` may call `stagedWorkspace.cleanup()` a second time if result adaptation throws after cleanup has already been attempted. This is a review hypothesis based on the recorded control flow, not a confirmed production failure. The next task is to write a regression test that makes the adapter throw after the first cleanup attempt and asserts cleanup is attempted at most once, then make the smallest safe fix.

Also note the result invariant: if cleanup fails after a Docker command returned exit code zero, the final normalized result must not contradict the schema or claim clean success. Infrastructure/cleanup failure must remain visible.

---

# 4. Questions I asked / key answers from this work

This section is intended to capture the learning behind the implementation, not just filenames.

## Q1. Why not execute project scripts directly on my machine?

Because package scripts can run arbitrary commands with the permissions of the current user. They can modify files, read environment variables, launch processes, or access the network. A discovery phase should remain read-only; execution should be explicit, policy-gated, and isolated.

## Q2. Does Docker guarantee that malicious code cannot affect the host?

No. Docker provides useful isolation controls, but it is not an absolute security guarantee. Risk depends on mounts, privileges, daemon access, runtime/kernel vulnerabilities, credentials, network configuration, and resource limits. DeployMate should use a staged copy, no network by default, least privilege, resource limits, timeouts, and no unnecessary secrets or host mounts.

## Q3. Why do we need both a policy module and Docker restrictions?

They solve different problems. Policy determines whether an action is authorized. Container restrictions limit what the authorized process can do. Policy without isolation can authorize a dangerous process that has too much access; isolation without policy can still run an action that should never have been allowed.

## Q4. Why copy the repository into a temporary directory instead of mounting the original?

The staged copy can omit Git history, dependencies, caches, and common secret files. It avoids giving a container direct access to the original project tree and can be deleted after the check. It still needs robust filtering, path validation, partial-copy cleanup, and careful handling of secrets that do not match known filename patterns.

## Q5. Why use a shared result schema?

It standardizes the interface between runners and the rest of the system. Reports, tests, and future AI analysis can interpret statuses and fields consistently. Invariants such as “passed means exit code zero” prevent contradictory results.

## Q6. Why distinguish a timeout from an ordinary failure?

A non-zero exit code means a process ran and reported failure. A timeout means DeployMate stopped or attempted to stop execution because it exceeded a limit. They imply different diagnostics and remediation. A timeout may not have a meaningful exit code, so the schema must not force one to be invented.

## Q7. Why test policy denial using mock staging and Docker functions?

Because the security property is not merely that the final result says “blocked”; it is that the forbidden side effects never occur. Mocks let a test assert that staging and execution functions were not called when policy denies the operation.

## Q8. Why is cleanup part of correctness?

Temporary workspaces and containers consume resources and may contain copied project files. If cleanup fails, that is a real execution outcome worth surfacing. Cleanup must be attempted safely and should not be repeated accidentally in ways that create confusing errors or mask the original failure.

## Q9. What does the test suite actually prove?

It supports the behaviors exercised by the tests under the tested conditions. It does not prove every failure path is correct, that all secrets are filtered, that Docker isolation is perfect, or that a target application is production-ready. The exact tested scenarios and remaining gaps belong in `testing-log.md`.

## Q10. Why is AI not the first thing to build?

AI is more useful when it receives reliable repository facts and execution evidence. Without a trustworthy inspection/execution layer, an AI diagnosis can be based on missing or fabricated evidence. The planned sequence builds deterministic evidence first, then adds diagnostics and AI reasoning.

---

# 5. Test evidence recorded for 19 October 2026

**Important:** The following results came from developer-shared local terminal output. They were not executed as part of the documentation commit.

## Focused orchestration tests

Command, run from `C:\DeployMate\agent`:

```cmd
node --test test/dockerPolicyRunner.test.js
```

Reported result: **13 passed, 0 failed**, approximately 244 ms.

Scenarios recorded:
1. Policy denial prevents staging and Docker execution.
2. An allowed check uses a separate staged workspace and cleans it once.
3. Staging failure prevents Docker execution.
4. Non-zero Docker exit is preserved as failure.
5. Timeout remains a timeout and cleanup is attempted.
6. Docker exception is normalized and workspace cleanup is attempted.
7. Cleanup failure after successful execution cannot report success.
8. Cleanup failure after Docker exception does not double-clean in that tested case.
9. Workspace cleanup failure is not confused with success.
10. Execution limits are forwarded.
11. Missing project root is rejected.
12. Invalid Docker runner is rejected.
13. Restricted policy requires approval.

A test setup was corrected because omitting `dockerRunner` selected the default runner; the invalid-runner test needed to pass `dockerRunner: null` explicitly. The test also checked restricted-policy behavior without approval and allowed behavior with approval.

## Full suite

Command:

```cmd
npm test
```

Reported result: **113 passed, 0 failed**, 0 cancelled, 0 skipped, 0 todo, approximately 5.64 seconds.

The reported suite included discovery, package-manager/workspace handling, policy, result validation, runner validation, Docker validation/process lifecycle, reporting, result adaptation, workspace staging, integration tests, and a Docker timeout smoke test.

## Timeout smoke test interpretation

The test intentionally used a 5,000 ms timeout. Reported outcome included:
- `status: timed_out`
- `exitCode: null`
- `signal: SIGTERM`
- Duration around 5.5 seconds
- Error code `CHECK_TIMEOUT`
- Cleanup reported successful
- `processDidNotClose: false`
- Timeout/status/error/cleanup/process-closed assertions were true
- Printed `PASS: Docker timeout handling behaved as expected.`

The timeout itself is expected; the test passes because the runner handled the timeout as designed.

---

# 6. Interview revision questions

Try answering these aloud in your own words. Interview answers should explain the reason for the design and one limitation, not just recite a module name.

### Q1. Explain DeployMate's architecture.

**Revision answer:** DeployMate first discovers project structure and declared checks without executing them. For a selected check, policy decides whether it is allowed; validation verifies script and path metadata; staging creates a filtered temporary workspace; Docker runs the selected command with restrictions and limits; the result adapter maps the raw process outcome into a shared schema; orchestration and reporting present the result. Diagnostics, AI planning, approval-based repair, verification, and deployment are later phases.

### Q2. What is the difference between authentication/authorization and sandboxing in this context?

**Revision answer:** The relevant concept here is authorization: policy decides whether a requested operation may run. Sandboxing limits the process's capabilities after it runs. They are separate controls and neither replaces the other.

### Q3. What is the difference between validation and execution?

**Revision answer:** Validation checks that a request refers to an allowed check, expected script/command, supported package manager, and in-scope path. Execution starts the process and observes its real outcome. Keeping them separate makes accidental execution less likely and lets validation be tested without Docker.

### Q4. Why is a temporary staged workspace safer than mounting the whole repository?

**Revision answer:** Staging allows DeployMate to omit unnecessary or sensitive files and avoids exposing the original working tree directly. It limits the execution input, but filename-based secret filtering can miss secrets and staging itself must handle paths and cleanup safely.

### Q5. What is an exit code? Why is zero special?

**Revision answer:** An exit code is a process's numeric completion status. Conventionally, zero means success and a non-zero value means failure. DeployMate's result contract uses that convention for `passed` and `failed`, while timeout and infrastructure failures may need separate statuses because a valid exit code may not exist.

### Q6. What is the purpose of an adapter?

**Revision answer:** It converts one module's output format into a stable contract expected by other modules. Here it prevents Docker-specific process details from leaking through the rest of DeployMate and gives the application one place to validate and normalize outcomes.

### Q7. How would you test that a denied command never runs?

**Revision answer:** Inject mock staging and runner functions, make policy return a denied decision, call orchestration, and assert that the result is blocked while the staging and runner mocks have zero calls. This checks the side-effect prevention property, not just the displayed status.

### Q8. What happens if a check times out?

**Revision answer:** The process layer detects the deadline, attempts termination, captures available output, attempts cleanup, and returns a `timed_out` result with timing and error details. The result should not be reported as a normal failure or success, and it should not fabricate an exit code.

### Q9. What are the main security limitations?

**Revision answer:** Docker is not an absolute boundary; staging's filename filters are incomplete; host configuration and mounts matter; process and output limits must be enforced on the real execution path; cleanup and partial-copy failures need coverage; secrets must not be passed into the container or leaked into logs.

### Q10. What is the most immediate technical follow-up?

**Revision answer:** Test whether result adaptation throwing after cleanup can cause the outer catch to invoke cleanup a second time. Add a focused regression test, make the smallest safe fix, rerun the focused suite and full suite, and record the actual outcomes.

---

# 7. Open questions and next steps

1. **Cleanup attempt tracking:** confirm whether the adapter-exception path can trigger a second cleanup call; test before changing code.
2. **Partial staging failure:** verify temporary directories are cleaned if copying fails halfway through.
3. **Result truthfulness:** exercise malformed raw results and ensure no contradictory status/exit-code combinations survive normalization.
4. **Secret filtering:** evaluate filename patterns and output/log redaction; do not claim comprehensive secret detection.
5. **Docker enforcement:** inspect actual arguments and confirm restrictions apply to every execution path.
6. **Output handling:** verify truncation behavior and whether logs can leak secrets.
7. **Dependencies:** decide how projects needing installed dependencies will be supported without silently enabling unrestricted network access.
8. **Diagnostics:** build deterministic parsing and evidence-backed findings before AI-generated explanations.
9. **Repair flow:** generate diffs and require explicit approval before modifying files.
10. **Verification:** rerun relevant checks after an approved repair and record before/after evidence.

## Roadmap status

- **Phase 0 — discovery/reporting:** complete.
- **Phase 1 — execution/isolation:** implemented in the reported working state; security and edge-case review ongoing.
- **Phase 2 — deterministic diagnostics:** planned.
- **Phase 3 — AI analysis/planning:** planned.
- **Phase 4 — approval-based repairs and verification:** planned.
- **Phase 5 — UI:** planned.
- **Phase 6 — expanded release-readiness documentation:** planned.
- **Phase 7 — deployment integration:** planned.
- **Phase 8 — reliability/security hardening:** ongoing.

---

# 8. Rules for future journal entries

At the end of each work session, append a dated entry containing:

1. **What I asked for** — the actual task/problem in plain language.
2. **Starting state** — relevant files/modules and what existed before the task.
3. **What we changed or investigated** — exact paths and responsibilities.
4. **How the code works** — inputs, processing, outputs, control flow, and key APIs.
5. **Why we chose this design** — alternatives, trade-offs, and security implications.
6. **Questions and answers** — capture questions asked during the session and their explanations.
7. **Errors and fixes** — symptom, cause, correction, and how the correction was verified.
8. **Tests and evidence** — exact commands and outcomes, distinguishing developer-reported from tool-run results.
9. **Interview revision** — likely questions and concise answers based on the actual work.
10. **Limitations and open issues** — what remains uncertain or untested.
11. **Next steps** — the next small task and how success will be verified.

Keep previous sessions intact. Do not replace the journal with a short summary. Add detail when new code, questions, failures, or design decisions arise. If a session's exact conversation or source details are unavailable, explicitly mark the gap rather than inventing what was said.

---

# Learning Journal Entry — 20 October 2026
## Docker runner recovery, regression analysis, and dependency-install security boundary

### Why this session happened

The goal was to recover from a regression introduced while exploring dependency installation for DeployMate, preserve the working Docker execution baseline, and document the technical learning for future interview revision. The journal must record what was asked, what was learned, why decisions were made, and what remains unverified—not merely list a status.

### Product and execution-flow context

DeployMate is a software lifecycle and release-readiness agent. Its current deterministic flow is:

`project discovery → check inventory → policy decision → validation → staged workspace → Docker execution → cleanup → result normalization → diagnostics/report`

AI analysis, user-approved repairs, verification, a UI, release-readiness reports, and deployment integrations remain future phases unless implementation evidence establishes otherwise.

Core principles:
- Discovery inspects project metadata without executing arbitrary scripts.
- Execution is explicit and policy-gated.
- Authorization and sandboxing are different, complementary controls.
- A temporary staged workspace reduces exposure of the original project tree.
- Results should accurately distinguish pass, failure, timeout, policy block, skip, and not-run.
- Execution time, output, memory, CPU, and process count must be bounded.
- Ordinary checks must not gain network access implicitly.
- Dependency installation is a separate, higher-risk capability because package installation can run lifecycle scripts and access the network.

### Regression: symptom, root cause, recovery

**Symptom:** A previous dependency-installation patch caused a large set of Docker process tests to fail.

**Root cause:** A dependency-install-only network requirement was added to shared Docker process option validation. Ordinary checks use the same validator, so they began requiring installation-specific network configuration even when installation had not been requested. This is an example of an optional feature changing the default path because its precondition was placed in shared validation.

**Recovery:** Restore the known-good `dockerProcess.js` baseline and keep installation-specific guardrails scoped to the explicit opt-in/policy-aware path. Do not reintroduce a global guard that makes ordinary checks depend on dependency-install configuration.

**Engineering lesson:** During a broad regression, return to a known-good baseline, narrow the change, and test the normal path separately from the new opt-in path. Do not weaken the baseline merely to make an incomplete feature appear functional.

### Relevant modules and their responsibilities

- `src/execution/policy.js`: evaluates whether a check/action is allowed, requires approval, or is blocked; policy also controls network/secrets capabilities and resource limits. Approval is not a universal override for hard policy denials.
- `src/execution/policyRunner.js`: policy gate around the underlying runner; constrains execution limits and avoids passing policy-only metadata down to the process runner. Optional installation must request its capability explicitly.
- `src/execution/dockerPolicyRunner.js`: orchestrates policy evaluation, workspace staging, Docker invocation, cleanup, and result adaptation. Cleanup must not be attempted twice if result adaptation fails after cleanup has already been attempted.
- `src/execution/dockerProcess.js`: validates process options, builds Docker arguments, launches/observes the Docker CLI, limits output, enforces timeouts, and attempts cleanup. The described baseline uses a pinned Node image digest, no network for ordinary checks, non-root execution, read-only filesystem, dropped capabilities, no-new-privileges, resource limits, bounded output, and timeout handling. Docker is a risk-reduction layer, not an absolute security guarantee.
- `src/execution/workspace.js`: stages a filtered project subset into a temporary workspace and cleans it up. Filename-based exclusions are not complete secret detection; path traversal, symlinks, partial-copy failures, and cleanup need dedicated tests.
- `src/execution/result.js` / `resultAdapter.js`: normalize process outcomes into a structured contract. Statuses include `not_run`, `passed`, `failed`, `timed_out`, `blocked`, and `skipped`. A passed result requires exit code 0; a failed result requires a non-null non-zero exit code. Do not fabricate an exit code when a timeout or infrastructure failure prevented one.
- `src/diagnostics/diagnose.js` and `src/report.js`: turn discovery warnings, policy decisions, and execution outcomes into deterministic findings and a terminal report. Later AI analysis should interpret evidence, not replace it or invent facts.

### Latest test evidence

The developer shared output from `npm test` run at `C:\DeployMate\agent`:

| Metric | Reported result |
|---|---:|
| Tests | 136 |
| Passed | 136 |
| Failed | 0 |
| Cancelled / skipped / todo | 0 |
| Duration | about 15 seconds |

**Evidence provenance:** this is developer-shared terminal output; this documentation update did not independently execute the tests.

Relevant scenarios include:
1. Installation is denied when policy disables network access.
2. Installation fails closed when no restricted network is configured.
3. Ordinary check requests do not implicitly request network access.
4. Adapter failure does not trigger a second workspace cleanup.
5. Docker timeout handling is tested by an intentional timeout smoke test.

The timeout smoke test intentionally times out after 5,000 ms and reports `status: timed_out`, `exitCode: null`, `signal: SIGTERM`, error `CHECK_TIMEOUT`, successful cleanup, and `processDidNotClose: false`. The timeout is the scenario under test, not a test-suite failure.

### Dependency installation: current status and security requirements

**Current status: not a working installer.** The opt-in behavior safely refuses to proceed when the required restricted network is not configured. Tests prove the fail-closed guardrail, not successful dependency installation.

The staged workspace excludes `node_modules`, so checks that rely on installed tools such as `eslint` or `vite` may fail until a secure dependency-preparation stage exists.

Simply running `npm install` is not enough:
- lifecycle scripts can execute arbitrary code;
- package installation needs network access;
- a JavaScript URL allowlist cannot stop a child process from making direct network requests;
- a normal Docker bridge does not enforce a domain-level egress allowlist;
- npm, pnpm, and Yarn differ in lockfile and install semantics, while the current Docker process implementation supports npm only;
- disabling all lifecycle scripts can break packages, while enabling them blindly increases risk;
- shared caches create cross-project contamination and cache-poisoning concerns.

Before implementation, define:
1. Explicit user and policy opt-in.
2. Egress restriction enforced outside the untrusted process.
3. Package-manager/lockfile consistency rules.
4. A deliberate lifecycle-script policy.
5. Isolated caches or no cache initially.
6. Timeout, output, memory, CPU, and process limits.
7. Cleanup and auditable structured results.
8. Tests for success, denial, malicious lifecycle scripts, lockfile mismatch, timeout, and cleanup.

If real egress enforcement is unavailable, keep installation disabled rather than falling back to unrestricted networking.

### Questions and answers to preserve for revision

**Why did the change break ordinary checks?** The installation-specific precondition was put in shared validation, which ordinary checks also call.

**Why did restoring the baseline help?** It removed the misplaced precondition from the normal process path and narrowed the regression surface.

**Does a passing fail-closed test mean installation works?** No. It proves that the operation refuses to run without a security prerequisite; successful installation remains unimplemented/unverified.

**Why is an application-level URL allowlist insufficient?** It only constrains requests routed through that application logic. Untrusted lifecycle scripts can attempt direct network access, so egress must be enforced by a boundary they cannot bypass.

**Authorization versus sandboxing?** Authorization determines whether an operation may start. Sandboxing constrains what the process can access or do after it starts. Both are required.

**Why is a timeout not just a failed exit code?** A timed-out process may not return a valid exit code. The result should preserve `timed_out` and a null exit code rather than inventing one.

**What does 136/136 prove?** It is evidence that the tested cases passed in the reported environment. It does not prove complete security, successful dependency installation, universal package-manager support, or production readiness.

### Interview revision: 60-second architecture explanation

DeployMate discovers project components and scripts without executing them. When a check is requested, policy decides whether it may run. Validation confirms the selected script and paths, a filtered temporary workspace is staged, and Docker executes the check with restrictions and resource limits. Cleanup is attempted, the low-level outcome is normalized into a shared result schema, and deterministic diagnostics/reporting explain what happened. AI analysis, approved repairs, verification, UI, and deployment integrations are later phases.

### Uncertainties that must remain explicit

- GitHub `main` was previously observed to differ from the local dependency-install opt-in work and tests. Verify the current repository before claiming source synchronization.
- Successful dependency installation has not been demonstrated.
- Docker containment and secret filtering have not been proven complete.
- The reported test run was supplied by the developer, not independently reproduced here.
- End-to-end npm, pnpm, and Yarn support has not been established.
- Production readiness has not been established.

### Next session plan

1. Confirm local branch/files and whether opt-in safety changes are present.
2. Preserve 136/136 as the latest developer-reported baseline.
3. Design the dependency-preparation flow and trust boundaries before coding.
4. Decide package-manager/lockfile rules and lifecycle-script policy.
5. Select and validate genuine egress enforcement; otherwise leave installation disabled.
6. Define cache, resource-limit, cleanup, and audit behavior.
7. Test ordinary no-network execution separately from opt-in installation.
8. Make one isolated change, run focused tests, then the full suite, and record exact output.

### Standard for future entries

Every session entry should capture what was asked and why, starting state, exact files/modules, code flow, changed versus proposed work, design trade-offs, questions and answers, errors/root causes/fixes, commands and test evidence with provenance, interview revision notes, uncertainties, and acceptance criteria. Preserve previous entries; do not invent code changes, questions, or test results.

