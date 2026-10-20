# DeployMate Security Notes

**Last updated:** 21 October 2026  
**Security milestone:** Policy-aware Docker execution is implemented; edge-case and production security review continue.

## Threat model

Repository scripts and dependencies must be treated as untrusted unless explicitly trusted and authorized. They may read/write accessible files, inspect environment variables, spawn subprocesses, use the network, consume resources, or attempt to affect the host. Discovering a script is not authorization to execute it.

## Policy before execution

`policy.js` and `policyRunner.js` provide `restricted`, `standard`, and `custom` profiles and decisions such as `allowed`, `requires_approval`, and `blocked`. Policy considers trust, allowed check types, operational scripts, requested capabilities, network/secrets access, and limits.

A non-allowed decision must prevent staging and execution. Approval must not override explicit security denials. Policy is not an OS-level sandbox.

## Check and path validation

`dockerRunner.js` validates supported check types, available/approved script candidates, package metadata, script/command consistency, package-manager lockfiles, and component path containment. The Docker process layer validates the staged workspace and expected script before execution.

## Disposable workspace

`workspace.js` creates a filtered temporary copy instead of mounting the original repository directly. Recorded exclusions:
- Directories: `.git`, `node_modules`, `.deploymate`, `.next`, `coverage`.
- Sensitive filename patterns: `.env`, `.env.*`, `.pem`, `.key`, `.p12`, `.pfx`, `id_rsa`, `id_ed25519`.
- Symlinks and special entries are skipped.
- Reported defaults: 20,000 files and 250 MiB.
- Regular files receive restrictive permissions.

These controls reduce exposure but do not guarantee that every secret is detected. Secrets can use unexpected filenames or be embedded in other files. Review filesystem race conditions, permission behavior, partial-copy failures, and cleanup paths.

## Docker restrictions

The execution layer uses the pinned Node image digest:

`node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`

Reported controls include disabled networking, user `1000:1000`, read-only root filesystem, dropped capabilities, `no-new-privileges`, PID limit 128, memory 512 MiB, CPU limit 1, temporary writable `/tmp`, timeout handling, bounded output, and cleanup attempts.

These settings reduce risk but do not create an absolute security boundary. Verify the actual Docker invocation and host/runtime configuration. Avoid privileged containers, sensitive host mounts, and exposure of host credentials. Dependency installation/network access should be a separate explicit capability, not an implicit default.

## Result integrity

The shared result schema distinguishes `not_run`, `passed`, `failed`, `timed_out`, `blocked`, and `skipped`. Passed requires exit code zero; failed requires a non-null non-zero exit code. Infrastructure failures should not be assigned fabricated exit codes. Cleanup failures must not be reported as clean success.

## Latest test and execution evidence — 21 October 2026

The developer shared a full npm test result with 159 tests, 159 passed, 0 failed, and no cancelled/skipped/todo tests; total duration was 17,166.1084 ms. This run occurred before the latest Git merge/push. It has not been independently rerun during this documentation update, so the synchronized tree still needs a fresh full-suite run.

A real Docker-backed smoke test against a disposable Node project passed:
- Explicit --run --approve invocation.
- Policy returned APPROVED.
- Check result was passed, exit code 0, duration 4,568 ms.
- CLI exit code was 0.

A deliberately failing Docker-backed smoke test also behaved correctly at the runner/report level:
- Check result failed, exit code 1.
- Error code CHECK_FAILED; stderr included SMOKE_TEST_FAILED.
- Diagnostics emitted an error finding with matching evidence.
- The CLI process still returned exit code 0. This is a confirmed CLI integration defect. It can cause automation to misinterpret failed validation as success and must be fixed before CI/CD use.

The timeout smoke test in the full-suite output deliberately reached 5,000 ms and reported status timed_out, exitCode null, signal SIGTERM, CHECK_TIMEOUT, cleanup success, and process closure. Its timeout is the expected scenario, not a failing test.

**Evidence provenance:** the full-suite and manual smoke-test results were shared by the developer. They were not independently executed during this documentation update. Passing tests establish only the tested behavior; they do not prove complete isolation, comprehensive secret protection, successful dependency installation, or production readiness.

## Cleanup review status

The previously noted adapter-exception/double-cleanup concern now has regression coverage in the developer-reported suite. The test named “adapter failure does not trigger a second workspace cleanup” passed in the 159-test run. Keep this as a tested edge case, not a claim that all cleanup failure modes are eliminated. Continue testing staging-copy failure, Docker daemon failure, timeout, cancellation, and cleanup errors separately.

## Production-use requirements

1. Verify the actual Docker arguments and restrictions on every execution path.
2. Keep host credentials and unnecessary environment variables out of the container.
3. Do not mount the original repository or sensitive host directories.
4. Keep networking disabled by default; treat dependency installation as a separate capability.
5. Validate paths, check types, script names, and commands.
6. Bound execution time, output, CPU, memory, process count, and workspace size.
7. Test timeout, cancellation, spawn, daemon, and cleanup failures.
8. Do not report success when cleanup or result normalization fails.
9. Consider output secret redaction before persisting logs.
10. Require explicit approval before modifying project files or deploying.
11. Test malformed/adversarial repository metadata and unusual filesystem structures.
12. Document supported environments and limitations.

## Immediate security review queue

- Review staging permissions and partial-copy cleanup.
- Review sensitive-file exclusions and log redaction.
- Verify actual Docker restrictions and resource limits.
- Reassess threat assumptions before adding dependency installation or network access.


---

## Security update — 20 October 2026

### Dependency installation is not yet available as a successful workflow

The explicit dependency-install opt-in currently **fails closed** when the required restricted-network mechanism is not configured. This is a guardrail, not a functioning installer. Do not describe dependency installation as implemented end-to-end.

The staged workspace excludes `node_modules`; consequently, project checks that rely on installed tools (for example, `eslint` or `vite`) may fail until a separate dependency-preparation stage is implemented.

### Network allowlisting must be enforced at the boundary

An application-level URL/origin allowlist does not constrain arbitrary network calls made directly by an untrusted process or package lifecycle script. A normal Docker bridge network also does not, by itself, enforce a domain-level egress allowlist. Do not enable installation by merely turning on Docker networking and assuming the application allowlist is a security boundary.

Before enabling dependency installation, require:
1. Explicit user opt-in and a policy decision for the installation capability.
2. Egress restrictions enforced outside the untrusted process and not bypassable by its child processes.
3. Defined package-manager and lockfile compatibility rules. Current execution support must not be assumed to cover npm, pnpm, and Yarn equally.
4. A deliberate lifecycle-script policy; package install scripts can execute arbitrary code.
5. Isolated caches (or no shared cache initially) to reduce cross-project contamination and cache-poisoning risk.
6. Existing resource controls, timeout, bounded output, workspace cleanup, and auditable structured results.
7. Tests for successful installation under the intended boundary, denied network access, malicious lifecycle scripts, lockfile mismatch, timeout, and cleanup.

If enforceable egress controls are unavailable, keep dependency installation disabled rather than falling back to unrestricted network access.

### Ordinary checks must remain unaffected

Installation-specific preconditions must not be inserted into shared Docker process validation in a way that causes ordinary checks to require installation-only configuration. Normal checks must continue to run with network access disabled by default. Test the normal no-network path separately from the explicit opt-in installation path.

### Security claims and limits

The reported 136/136 suite result is evidence for the tested behaviors, not proof of production readiness. Continue to treat repository scripts and dependencies as untrusted, and retain the distinction between policy authorization and OS/container isolation. Keep the original repository unmounted, minimize environment variables and host credentials, and treat secret filename filtering as incomplete.


## CLI correctness risk

The current CLI can print a CHECK_FAILED error and still exit with code 0. This is not a container escape, but it is a release-safety and automation-integrity risk: CI/CD may treat a failed check as successful. Fix and test the exit-code contract before integrating DeployMate into automated release gates. A requested check that fails, times out, or is blocked for missing approval should return non-zero; discovery-only success should remain zero.

## Repository hygiene observation

The current GitHub tree includes root-level cli-smoke-test/, docker-smoke-test/, and test-malformed/ fixtures, plus zero-byte files agent/agent@1.0.0, agent/cd, agent/git, agent/node, and agent/npm. Their intent has not been confirmed. Review whether these are intentional test assets or accidental artifacts before deleting or retaining them; no repository cleanup was performed as part of this documentation update.
