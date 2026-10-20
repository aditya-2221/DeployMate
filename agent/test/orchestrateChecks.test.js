
import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionResult } from "../src/execution/result.js";
import { orchestrateChecks } from "../src/execution/orchestrateChecks.js";

function makeCheck(component) {
  return {
    component,
    type: "test",
    script: "test",
    command: "npm test",
    status: "available",
  };
}

function makePassedResult(check) {
  return createExecutionResult({
    component: check.component,
    type: check.type,
    script: check.script,
    command: check.command,
    status: "passed",
    runner: "docker",
    exitCode: 0,
  });
}

test("continues remaining checks after an unexpected runner error", async () => {
  const firstCheck = makeCheck("frontend");
  const secondCheck = makeCheck("backend");
  const calls = [];

  const runner = {
    async runCheck(check) {
      calls.push(check.component);

      if (check.component === "frontend") {
        throw new Error("Unexpected runner failure");
      }

      return {
        decision: "allowed",
        result: makePassedResult(check),
      };
    },
  };

  const outcome = await orchestrateChecks({
    checks: [firstCheck, secondCheck],
    runner,
  });

  assert.deepEqual(calls, ["frontend", "backend"]);
  assert.equal(outcome.orchestrationFailed, true);
  assert.equal(outcome.executionResults.length, 2);

  assert.equal(
    outcome.executionResults[0].error.code,
    "ORCHESTRATION_FAILED",
  );
  assert.equal(
    outcome.executionResults[0].error.message,
    "Unexpected runner failure",
  );
  assert.equal(outcome.executionResults[0].status, "not_run");

  assert.equal(outcome.executionResults[1].status, "passed");
  assert.equal(outcome.policyDecisions.length, 1);
});

test("does not flag ordinary policy denial as orchestration failure", async () => {
  const check = makeCheck("frontend");

  const runner = {
    async runCheck() {
      return {
        decision: "denied",
        result: createExecutionResult({
          component: check.component,
          type: check.type,
          script: check.script,
          command: check.command,
          status: "blocked",
          error: {
            code: "POLICY_BLOCKED",
            message: "Execution requires approval.",
          },
        }),
      };
    },
  };

  const outcome = await orchestrateChecks({
    checks: [check],
    runner,
  });

  assert.equal(outcome.orchestrationFailed, false);
  assert.equal(outcome.executionResults[0].status, "blocked");
  assert.equal(outcome.policyDecisions.length, 1);
});

test("returns no orchestration failure when checks complete normally", async () => {
  const check = makeCheck("frontend");

  const outcome = await orchestrateChecks({
    checks: [check],
    runner: {
      async runCheck() {
        return {
          decision: "allowed",
          result: makePassedResult(check),
        };
      },
    },
  });

  assert.equal(outcome.orchestrationFailed, false);
  assert.equal(outcome.executionResults.length, 1);
  assert.equal(outcome.executionResults[0].status, "passed");
});
