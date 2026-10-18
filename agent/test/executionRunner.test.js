import test from "node:test";
import assert from "node:assert/strict";
import { assertRunner } from "../src/execution/runner.js";

test("accepts an object exposing runCheck", () => {
  const runner = { runCheck() {} };
  assert.equal(assertRunner(runner), runner);
});

test("rejects values that do not implement runCheck", () => {
  for (const value of [null, undefined, {}, { runCheck: true }, "runner"]) {
    assert.throws(() => assertRunner(value), {
      name: "TypeError",
      message: "Runner must be an object with a runCheck function.",
    });
  }
});
