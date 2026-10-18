
import test from "node:test";
import assert from "node:assert/strict";

import { createPolicyAwareRunner } from "../src/execution/policyRunner.js";

function createMockRunner(result) {
  let callCount = 0;

  return {
    runner: {
      async runCheck(check, options) {
        callCount++;

        return {
          ...result,
          component: result.component ?? "agent",
          type: result.type ?? check.type,
        };
      },
    },
    getCallCount() {
      return callCount;
    },
  };
}

function createCheck(overrides = {}) {
  return {
    component: "agent",
    type: "test",
    status: "available",
    script: "test",
    command: "npm test",
    ...overrides,
  };
}

function createValidResult(overrides = {}) {
  return {
    executionId: "test-execution-001",
    component: "agent",
    type: "test",
    script: "test",
    command: "npm test",
    status: "passed",
    runner: "mock",
    workingDirectory: "C:\\DeployMate\\agent",
    startedAt: "2026-10-18T10:00:00.000Z",
    finishedAt: "2026-10-18T10:00:01.000Z",
    exitCode: 0,
    stdout: "Tests passed",
    stderr: "",
    durationMs: 1000,
    error: null,
    ...overrides,
  };
}

test("blocked operations never reach the underlying runner", async () => {
  const mock = createMockRunner(createValidResult());

  const policyRunner = createPolicyAwareRunner({
    runner: mock.runner,
    policy: {
      profile: "standard",
    },
  });

  const response = await policyRunner.runCheck(
    createCheck({ type: "unknown" }),
  );

  assert.equal(response.decision.decision, "blocked");
  assert.equal(response.result, null);
  assert.equal(mock.getCallCount(), 0);
});

test("operations requiring approval never reach the runner", async () => {
  const mock = createMockRunner(createValidResult());

  const policyRunner = createPolicyAwareRunner({
    runner: mock.runner,
    policy: {
      profile: "standard",
    },
  });

  const response = await policyRunner.runCheck(
    createCheck({ type: "dev" }),
  );

  assert.equal(response.decision.decision, "requires_approval");
  assert.equal(response.result, null);
  assert.equal(mock.getCallCount(), 0);
});

test("allowed checks reach the underlying runner exactly once", async () => {
  const mock = createMockRunner(createValidResult());

  const policyRunner = createPolicyAwareRunner({
    runner: mock.runner,
    policy: {
        profile: "standard",
        trustedProject: true,
        allowedCheckTypes: ["test"],
    },
  });

  const response = await policyRunner.runCheck(
    createCheck({ type: "test" }),
  );

  assert.equal(response.decision.decision, "allowed");
  assert.equal(response.result.status, "passed");
  assert.equal(response.result.exitCode, 0);
  assert.equal(mock.getCallCount(), 1);
});

test("invalid runner results are rejected", async () => {
  const mock = createMockRunner(
    createValidResult({
      status: "passed",
      exitCode: 1,
    }),
  );

  const policyRunner = createPolicyAwareRunner({
    runner: mock.runner,
    policy: {
        profile: "standard",
        trustedProject: true,
        allowedCheckTypes: ["test"],
    },
  });

  await assert.rejects(
    policyRunner.runCheck(createCheck()),
  );

  assert.equal(mock.getCallCount(), 1);
});

test("missing or invalid runners are rejected", () => {
  assert.throws(
    () => createPolicyAwareRunner(),
    /Runner must be an object with a runCheck function/,
  );

  assert.throws(
    () => createPolicyAwareRunner({ runner: {} }),
    /Runner must be an object with a runCheck function/,
  );

  assert.throws(
    () => createPolicyAwareRunner({ runner: null }),
    /Runner must be an object with a runCheck function/,
  );
});
