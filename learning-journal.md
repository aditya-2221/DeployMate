# DeployMate Learning Journal — Technical Revision Handbook

**Last updated:** 21 October 2026  
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



# Learning Journal Entry — 21 October 2026
## Real Docker smoke tests, CLI exit-code defect, Git history recovery, and documentation maintenance

### 1. What I asked for and why

This session began after the developer wanted to stop for the day and asked what remained before “actual code execution.” The key clarification was that actual Docker execution had already occurred: the disposable smoke project had run inside the Docker-backed runner. The remaining work is to validate a broader set of outcomes and make the CLI report those outcomes correctly.

The developer then decided to commit and push the current code/tests. The push to origin/main was rejected because GitHub had four commits that the local branch did not contain. The developer asked for help recovering safely, then confirmed that the merge and push were completed. Before ending the session, the developer asked for all project documentation to be updated, explicitly requiring that the learning-journal editing rules be read first and that the new entry satisfy those rules.

### 2. Starting state and evidence sources

The current GitHub main branch was inspected before this documentation update. Its code includes:
- agent/src/index.js — CLI argument parsing, discovery, optional execution, diagnostics, report generation, and process exit-code handling.
- agent/src/execution/dockerPolicyRunner.js — policy-aware staging/execution/cleanup orchestration.
- agent/src/execution/dockerProcess.js — Docker process invocation, timeout/output/resource handling.
- agent/src/diagnostics/diagnose.js — deterministic diagnostic finding generation.
- agent/test/cli.test.js — four CLI regression tests.
- The broader agent/test suite covering discovery, policy, Docker process behavior, result contracts, diagnostics, staging, and orchestration.

The current learning-journal.md rules require a cumulative technical revision record. Each entry must preserve the user's actual questions, starting state, exact modules, code flow, design choices and trade-offs, errors and fixes, test evidence with provenance, interview questions/answers, limitations, and next steps. Older entries must remain intact. Missing details must be called out instead of invented.

### 3. First approved end-to-end smoke test: passing check

The developer ran this command from Windows Command Prompt:

~~~cmd
npm run dev -- "C:\DeployMate\cli-smoke-test" --run --approve
echo EXIT_CODE=%ERRORLEVEL%
~~~

Reported result:
- Project discovered at C:\DeployMate\cli-smoke-test.
- Root lockfile recognized as package-lock.json; package manager resolved to npm for the project.
- The package declared a test script: node -e "console.log('SMOKE_TEST_PASSED')".
- Policy decision: [ALLOWED], code APPROVED, because explicit approval was provided.
- Execution result: [PASSED], exit code 0, duration 4,568 ms.
- Unavailable lint/build/typecheck scripts were reported as informational CHECK_UNAVAILABLE findings, not failures.
- CLI process exit code was 0.

**What this proves:** the exercised path from discovery through approval, Docker-backed execution, result normalization, diagnostics, and terminal reporting worked for this simple passing test in the developer's environment.

**What it does not prove:** that all project types work, that the container is an absolute security boundary, or that all cleanup/error paths are correct.

### 4. Deliberately failing smoke test and confirmed bug

The developer changed the disposable project's test script to print SMOKE_TEST_FAILED to stderr and exit with code 1, then reran the same approved execution command.

Reported result:
- The runner returned [FAILED].
- Exit code: 1.
- Duration: 910 ms.
- Error code: CHECK_FAILED.
- Error message: Docker check exited with code 1.
- Stderr contained SMOKE_TEST_FAILED.
- Diagnostics produced one ERROR finding with code CHECK_FAILED and evidence containing the failed status and exit code.
- The CLI process returned EXIT_CODE=0 anyway.

This is the key defect identified in this session. The Docker runner, result adapter, and diagnostics represented the failure correctly; the top-level CLI did not propagate the failed requested check into its process exit status.

### 5. How the current CLI works

File: agent/src/index.js.

1. parseArguments() accepts the target path and flags --run and --approve; unknown options and --approve without --run are rejected.
2. discoverPackages() inspects the target project.
3. discoverChecks() and discoverOperationalScripts() inventory declared scripts.
4. When --run is supplied, the CLI creates a policy-aware Docker runner, filters to checks with status available, and calls orchestrateChecks().
5. It collects execution results and policy decisions.
6. diagnose() derives structured findings from discovery, execution results, and policy decisions.
7. printReport() renders the terminal report.
8. Current exit handling sets process.exitCode = 1 for orchestrationFailed and for fatal exceptions/invalid arguments, but does not consistently set a non-zero exit code when an individual requested check fails or is blocked by policy.

### 6. Why the exit-code defect matters

A human sees the FAILED report, but CI/CD systems, scripts, and other automation often use the process exit code to decide whether a command succeeded. If DeployMate prints an error and exits with code 0, an automated pipeline may treat a failed validation as successful. The process status is part of the product's output contract, not a cosmetic detail.

Target contract:
- Discovery-only invocation returns 0 when discovery and report generation succeed, even if optional check types are unavailable.
- Requested execution returns 0 only when the requested checks complete successfully.
- A requested check that fails, times out, is blocked for missing approval, or otherwise cannot complete successfully should return non-zero.
- Invalid arguments, fatal errors, and orchestration failures return non-zero.
- Ordinary policy denial must remain distinguishable from an internal orchestration failure in structured results, even though both can require a non-zero process exit code for an invocation that requested execution.

The next change should be test-first. Add CLI tests for a successful requested check and a failing requested check, then cover timeout and policy-block behavior as appropriate. Preserve the existing discovery-only success test. Make the smallest change in index.js that derives the final exit status from the requested execution's results/decisions without conflating a normal discovery-only run with failed execution.

### 7. Existing CLI regression tests

File: agent/test/cli.test.js.

The four tests in the current repository cover:
1. Missing project path returns non-zero.
2. --approve without --run is rejected.
3. Unknown CLI options are rejected.
4. Discovery-only mode reports checks as not run and returns zero.

The file creates a temporary project with a package.json and package-lock.json, and removes the fixture in a finally block. The current tests do not cover the CLI process exit status for an actual failed requested check; that gap allowed the observed defect to remain.

### 8. Full-suite and timeout evidence

The developer supplied the output of a full npm test run from C:\DeployMate\agent:
- Tests: 159
- Passed: 159
- Failed: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0
- Total duration: 17,166.1084 ms (about 17.17 seconds)

The output includes the Docker timeout smoke test. That test deliberately runs a process that keeps printing once per second and uses a 5,000 ms timeout. Its reported result was:
- status: timed_out
- exitCode: null
- signal: SIGTERM
- error.code: CHECK_TIMEOUT
- error.message: Check exceeded 5000 ms.
- durationMs: 5520
- cleanup success: true
- processDidNotClose: false
- all timeout assertions true
- final smoke-test message: PASS: Docker timeout handling behaved as expected.

The test file itself was reported at about 15.39 seconds in the test runner output, and the complete suite at about 17.17 seconds. The timeout is expected behavior for this test and is not a failing test.

**Evidence provenance:** these are developer-shared terminal output (also preserved in the attached test log), not a test run independently performed during this documentation update. The full suite was reported before the Git merge/push. A post-merge full-suite rerun was not shown in the conversation, so rerun npm test against the synchronized tree before claiming the merged checkpoint was freshly verified.

### 9. Git push rejection and safe history recovery

The developer ran git push origin main and Git rejected the push with [rejected] main -> main (fetch first). The initial git status showed a clean working tree and one local commit ahead of the then-known origin/main. After git fetch origin, Git reported local main ahead by one and behind by four commits.

The commit graph showed:
- Local code/test commit: 2bf9080 test: harden execution diagnostics and CLI coverage.
- Remote documentation commits: 084fc67, 40abdf3, 87b8c63, and f89625d.
- Common ancestor: dfb8f67.
- Merge commit: 520ba29 Merge remote-tracking branch 'origin/main'.
- Latest local merge follow-up commit: b20bd1b merged branch.

A backup branch was created as backup/main-before-sync. During the merge, Vim reported E211: File ".git/MERGE_MSG" no longer available. The subsequent status showed a clean working tree and three local commits ahead. The later graph confirmed the merge commit and all four remote documentation commits were present alongside the local code commit.

The developer then confirmed that the final synchronization/push steps were completed. No force-push or destructive reset was used. The repository's main branch is now the base for this documentation update; the documentation commit itself will advance that branch.

**Learning:** when Git rejects a push because remote work exists, fetch first, inspect both sides' commit lists and graph, preserve a backup, and merge/rebase only after understanding the divergence. Do not force-push or discard unknown remote work just to make a push succeed. A Vim editor error should be followed by checking Git's actual status and graph rather than assuming the merge was aborted or complete.

### 10. Repository hygiene observation

The inspected GitHub tree contains:
- root fixture directories cli-smoke-test/, docker-smoke-test/, and test-malformed/;
- agent/docker-smoke-test.mjs;
- zero-byte files under agent/ named agent@1.0.0, cd, git, node, and npm.

Their intended purpose is not established by the current evidence. Do not silently delete them as part of documentation work. Ask the developer to confirm whether these are intentional fixtures or accidental artifacts, then remove or relocate them in a separately reviewed code/repository-hygiene change if appropriate.

### 11. What I learned / interview revision

**Q: Why is an execution result not enough; why must the CLI exit code match it?**  
A: Humans inspect the report, but automation commonly consumes the process exit status. The CLI is an integration boundary, so it must translate structured results into an accurate process status.

**Q: Which layer was correct in the failing smoke test?**  
A: The Docker runner returned failure with exit code 1; the result/reporting layers preserved CHECK_FAILED and stderr. The bug is in top-level CLI exit handling.

**Q: Why should discovery-only mode still return 0 when lint/build/typecheck are unavailable?**  
A: Discovery-only mode answers what is declared, not whether every possible check exists. Missing optional scripts are informational unless the user requested a policy that makes them mandatory.

**Q: What does the Docker timeout smoke test prove?**  
A: In the exercised environment, the configured timeout was detected, a termination signal was observed, the structured result remained timed_out with no invented exit code, and cleanup/process closure assertions passed. It does not prove every process/daemon/cleanup failure path is safe.

**Q: Why not force-push after the rejection?**  
A: The remote contained four legitimate commits not in the local history. A force-push could discard them. Fetching, inspecting the graph, and merging preserved both the local code/test commit and remote documentation history.

**Q: What is the current architectural sequence?**  
A: Discovery → policy decision → validation → filtered staging → Docker execution → cleanup → result normalization → deterministic diagnostics → report. AI analysis, planning, approved repairs, verification, UI, and deployment remain future capabilities.

### 12. Current limitations and next steps

- Fix CLI exit-code propagation for failed, timed-out, blocked, and otherwise unsuccessful requested checks.
- Add regression tests for successful and unsuccessful --run invocations while preserving discovery-only behavior.
- Rerun the full suite after the Git merge/push and after the CLI fix.
- Continue security review of staging permissions, partial-copy cleanup, secret filtering, actual Docker flags, output truncation/redaction, and daemon/timeout failure combinations.
- Run a representative project through the real Docker path after CLI exit semantics are fixed.
- Review the tracked fixture directories and zero-byte files before deciding whether they belong in the repository.
- Dependency installation remains fail-closed when restricted network enforcement is unavailable; successful installation has not been demonstrated.
- AI planning, approval-based repairs, UI, and deployment integration remain planned.

### 13. Acceptance criteria for the next implementation task

The CLI exit-code fix is ready when:
1. A passing approved check yields exit code 0.
2. A deliberately failing approved check yields non-zero and retains its CHECK_FAILED diagnostic.
3. A timed-out requested check yields non-zero and retains timed_out/timeout evidence.
4. A requested check blocked for missing approval yields non-zero and retains a policy/approval finding.
5. Discovery-only mode still returns 0 when discovery/reporting succeeds.
6. Invalid arguments and orchestration failures remain non-zero.
7. Focused CLI tests and the full suite pass.
8. The testing log records exact output and its provenance.
