# DeployMate Security Notes

**Last updated:** 19 October 2026  
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

## Latest test evidence

On 19 October 2026, the developer shared output showing 13/13 policy-aware Docker-runner integration tests and 113/113 full-suite tests passing. The timeout smoke test reported SIGTERM, successful cleanup, and process closure.

These results cover the tested scenarios only. They do not prove complete isolation, comprehensive secret protection, or production readiness.

## Known review item

The outer catch in `dockerPolicyRunner.js` may attempt staged-workspace cleanup a second time if result adaptation throws after the first cleanup attempt. Existing tests cover some cleanup failure paths but do not establish this adapter-exception path. Add a regression test and fix only after confirming the behavior.

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

- Add a regression test for result-adaptation failure after cleanup.
- Review staging permissions and partial-copy cleanup.
- Review sensitive-file exclusions and log redaction.
- Verify actual Docker restrictions and resource limits.
- Reassess threat assumptions before adding dependency installation or network access.
