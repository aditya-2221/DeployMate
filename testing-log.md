# DeployMate Testing Log

**Last updated:** 19 October 2026  
**Latest developer-shared full-suite result:** 113 passed, 0 failed.

## Recording rules

Record only results supported by actual command output. A passing test proves the exercised scenario, not production readiness. The Docker timeout smoke test deliberately times out and is expected to pass.

## Full regression run — 19 October 2026

Command from `C:\DeployMate\agent`:

```cmd
npm test
```

Developer-shared result:

| Metric | Result |
|---|---:|
| Total tests | 113 |
| Passed | 113 |
| Failed | 0 |
| Cancelled | 0 |
| Skipped | 0 |
| Todo | 0 |
| Duration | 5638.101 ms (~5.64 s) |

**Status: PASS, based on developer-shared local output.** Coverage includes discovery, workspace/package-manager logic, policy, result schema, runner validation, Docker validation/process lifecycle, reporting, result adaptation, workspace staging, policy-aware integration tests, and a Docker timeout smoke test.

## Focused integration run — 19 October 2026

Command:

```cmd
node --test test/dockerPolicyRunner.test.js
```

Developer-shared result: **13 tests, 13 passed, 0 failed**, approximately 244 ms.

Scenarios:
1. Policy denial prevents staging and Docker execution.
2. Allowed check uses a separate staged workspace and cleans it once.
3. Staging failure prevents Docker execution.
4. Non-zero Docker exit is preserved as failure.
5. Timeout remains a timeout and cleanup is attempted.
6. Docker exception is normalized and workspace cleaned.
7. Cleanup failure after successful execution cannot report success.
8. Cleanup failure after Docker exception does not double-clean in that tested case.
9. Workspace cleanup failure is not mistaken for success.
10. Execution limits are forwarded.
11. Missing project root is rejected.
12. Invalid Docker runner is rejected.
13. Restricted policy requires approval.

The test file was corrected to remove a stray incomplete test declaration, explicitly pass `dockerRunner: null` in the invalid-runner test (omitting it selects the default runner), and verify restricted-policy denial without approval followed by allowed execution with approval.

## Docker timeout smoke test

The full-suite output included a deliberately long-running process configured with a 5,000 ms timeout. Reported outcome:
- Status `timed_out`
- Exit code `null`
- Signal `SIGTERM`
- Duration approximately 5,529 ms
- Error code `CHECK_TIMEOUT`
- Cleanup success reported
- `processDidNotClose: false`
- Timeout/status/error/cleanup/process-closed assertions all true
- Final output: `PASS: Docker timeout handling behaved as expected.`

This is expected output from a passing timeout test, not a suite failure.

## Historical discovery baseline — 17 October 2026

The developer reported 26 tests passing after read-only discovery and operational-script reporting were integrated. Manual command:

```cmd
npm run dev -- "C:\DevLink"
```

The report identified frontend/backend packages and declared scripts, marking available scripts `Execution status: NOT RUN`.

## Coverage limitations

Passing tests do not establish arbitrary repository compatibility, complete sandbox security, comprehensive secret exclusion, or correctness for every cleanup/adaptation combination. They do not prove that DevLink is release-ready.

## Outstanding test/review queue

1. Add a regression test where result adaptation throws after cleanup has already been attempted; assert cleanup is attempted at most once.
2. Test malformed raw result objects and truthful normalization.
3. Test partial workspace-copy failures and cleanup.
4. Review sensitive-file exclusions, symlinks, special entries, file-count and byte limits.
5. Test Docker spawn, daemon, timeout, and cleanup error combinations.
6. Confirm blocked policy never invokes staging or Docker.
7. Verify limits are applied in the actual Docker invocation, not merely passed through orchestration.
8. Add output truncation and secret-redaction tests if/when those features are implemented.
9. Verify reports distinguish `not_run`, `blocked`, `skipped`, `passed`, `failed`, and `timed_out`.

Do not mark a queued item complete until it is run and its actual result is recorded.

---

## Session update — 20 October 2026

### Latest developer-reported full-suite result

Command: `npm test`  
Working directory reported by developer: `C:\DeployMate\agent`

- Total: 136
- Passed: 136
- Failed: 0
- Cancelled/skipped/todo: 0
- Duration: approximately 15 seconds

**Provenance:** user-shared terminal output; not independently rerun as part of this documentation change.

### Dependency-install opt-in cases

The reported suite includes tests confirming:
- dependency installation is denied when policy disables network access;
- installation fails closed when no restricted network is implemented;
- ordinary checks do not implicitly request network access;
- an adapter failure does not trigger a second workspace cleanup.

The Docker timeout smoke test intentionally reaches its configured 5,000 ms timeout and verifies `timed_out`, `CHECK_TIMEOUT`, termination signal, cleanup, and process-close behavior. That expected timeout is not a failing test.

### Scope of evidence

These results do **not** demonstrate successful dependency installation. The current behavior is a safety guard that refuses installation without a real restricted-network mechanism. A normal Docker bridge and application-level URL allowlist do not constitute enforceable domain-level egress control. Keep installation disabled until the security boundary and its tests are implemented.

Also, a passing suite does not prove complete Docker isolation, comprehensive secret detection, end-to-end pnpm/Yarn support, or production readiness.

