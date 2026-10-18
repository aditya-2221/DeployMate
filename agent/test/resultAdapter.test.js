
import test from "node:test";
import assert from "node:assert/strict";

import { adaptDockerResult } from "../src/execution/resultAdapter.js";

const check = {
  component: "app",
  type: "test",
  script: "test",
  command: "npm run test",
};

function rawResult(overrides = {}) {
  return {
    status: "passed",
    exitCode: 0,
    signal: null,
    stdout: "tests passed",
    stderr: "",
    durationMs: 100,
    startedAt: "2026-10-18T10:00:00.000Z",
    finishedAt: "2026-10-18T10:00:00.100Z",
    runner: "docker",
    workingDirectory: "/tmp/staged/app",
    error: null,
    ...overrides,
  };
}

test("adapts a successful Docker result", () => {
  const result = adaptDockerResult({
    rawResult: rawResult(),
    check,
    executionId: "test-execution",
  });

  assert.equal(result.executionId, "test-execution");
  assert.equal(result.component, "app");
  assert.equal(result.type, "test");
  assert.equal(result.status, "passed");
  assert.equal(result.exitCode, 0);
});

test("preserves a non-zero exit code", () => {
  const result = adaptDockerResult({
    rawResult: rawResult({
      status: "failed",
      exitCode: 7,
      stderr: "intentional failure",
      error: {
        code: "CHECK_FAILED",
        message: "Docker check exited with code 7.",
      },
    }),
    check,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /intentional failure/);
});

test("preserves a timeout", () => {
  const result = adaptDockerResult({
    rawResult: rawResult({
      status: "timed_out",
      exitCode: null,
      error: {
        code: "CHECK_TIMEOUT",
        message: "Check timed out.",
      },
    }),
    check,
  });

  assert.equal(result.status, "timed_out");
  assert.equal(result.exitCode, null);
});

test("does not invent an exit code for an execution error", () => {
  const result = adaptDockerResult({
    rawResult: rawResult({
      status: "failed",
      exitCode: null,
      error: {
        code: "DOCKER_UNAVAILABLE",
        message: "Docker daemon is unavailable.",
      },
    }),
    check,
  });

  assert.equal(result.status, "not_run");
  assert.equal(result.exitCode, null);
  assert.equal(result.error.code, "DOCKER_UNAVAILABLE");
});

test("rejects a success result with a non-zero exit code", () => {
  assert.throws(
    () =>
      adaptDockerResult({
        rawResult: rawResult({
          status: "passed",
          exitCode: 2,
        }),
        check,
      }),
    /without exit code 0/
  );
});

test("rejects an unknown Docker status", () => {
  assert.throws(
    () =>
      adaptDockerResult({
        rawResult: rawResult({
          status: "unknown",
        }),
        check,
      }),
    /Unsupported Docker result status/
  );
});
