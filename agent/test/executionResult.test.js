
import test from "node:test";
import assert from "node:assert/strict";

import {
  createExecutionResult,
  EXECUTION_STATUSES,
  executionResultSchema,
  validateExecutionResult,
} from "../src/execution/result.js";

test("creates a complete not-run result using defaults", () => {
  const result = createExecutionResult({
    component: "frontend",
    type: "build",
    script: "build",
    command: "npm run build",
  });

  assert.deepEqual(result, {
    executionId: null,
    component: "frontend",
    type: "build",
    script: "build",
    command: "npm run build",
    status: "not_run",
    runner: null,
    workingDirectory: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: null,
    error: null,
  });
});

test("supports all documented execution statuses", () => {
  assert.deepEqual(EXECUTION_STATUSES, [
    "not_run",
    "passed",
    "failed",
    "timed_out",
    "blocked",
    "skipped",
  ]);

  for (const status of EXECUTION_STATUSES) {
    const exitCode =status === "passed" ? 0 : status === "failed" ? 1 : null;

    const result = createExecutionResult({
      component: "backend",
      type: "test",
      status,
      exitCode,
    });

    assert.equal(result.status, status);
  }
});

test("preserves metadata and structured errors", () => {
  const result = createExecutionResult({
    executionId: "exec-123",
    component: "frontend",
    type: "build",
    script: "build",
    command: "npm run build",
    status: "passed",
    runner: "docker",
    workingDirectory: "/workspace/frontend",
    startedAt: "2026-10-18T10:00:00.000Z",
    finishedAt: "2026-10-18T10:00:02.500Z",
    exitCode: 0,
    stdout: "Build complete",
    stderr: "",
    durationMs: 2500,
  });

  assert.equal(result.executionId, "exec-123");
  assert.equal(result.runner, "docker");
  assert.equal(result.durationMs, 2500);
  assert.equal(result.stdout, "Build complete");
  assert.equal(result.error, null);

  const blocked = createExecutionResult({
    component: "backend",
    type: "test",
    status: "blocked",
    error: {
      code: "POLICY_BLOCKED",
      message: "Execution requires approval.",
      details: "No process was started.",
    },
  });

  assert.deepEqual(blocked.error, {
    code: "POLICY_BLOCKED",
    message: "Execution requires approval.",
    details: "No process was started.",
  });
});

test("rejects a passed result without exit code zero", () => {
  assert.throws(
    () =>
      createExecutionResult({
        component: "frontend",
        type: "build",
        status: "passed",
        exitCode: 1,
      }),
    /A passed result must have exitCode 0/,
  );
});

test("rejects a failed result without a non-zero exit code", () => {
  assert.throws(
    () =>
      createExecutionResult({
        component: "frontend",
        type: "build",
        status: "failed",
        exitCode: null,
      }),
    /A failed result must have a non-zero exit code/,
  );
});

test("rejects invalid timestamps and negative durations", () => {
  const base = {
    component: "frontend",
    type: "build",
    status: "passed",
    exitCode: 0,
  };

  assert.equal(
    validateExecutionResult({
      ...base,
      startedAt: "not-a-timestamp",
      finishedAt: "2026-10-18T10:00:00.000Z",
    }).success,
    false,
  );

  assert.equal(
    validateExecutionResult({
      ...base,
      startedAt: "2026-10-18T10:00:02.000Z",
      finishedAt: "2026-10-18T10:00:00.000Z",
    }).success,
    false,
  );

  assert.equal(
    validateExecutionResult({
      ...base,
      durationMs: -1,
    }).success,
    false,
  );
});

test("rejects unknown statuses and malformed error objects", () => {
  assert.equal(
    executionResultSchema.safeParse({
      component: "frontend",
      type: "build",
      status: "success",
    }).success,
    false,
  );

  assert.equal(
    validateExecutionResult({
      component: "frontend",
      type: "build",
      error: { message: "Missing error code" },
    }).success,
    false,
  );
});

test("rejects missing component and check type", () => {
  assert.equal(
    validateExecutionResult({ type: "build" }).success,
    false,
  );

  assert.equal(
    validateExecutionResult({ component: "frontend" }).success,
    false,
  );
});
