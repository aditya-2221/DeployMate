
import { assertRunner } from "./runner.js";
import { evaluateExecutionPolicy } from "./policy.js";
import { createExecutionResult } from "./result.js";

/**
 * Creates a policy gate around an existing runner.
 *
 * This module authorizes operations but does not implement
 * operating-system process isolation or command execution.
 */
export function createPolicyAwareRunner({
  runner,
  policy = {},
} = {}) {
  const validatedRunner = assertRunner(runner);

  return {
    async runCheck(check, options = {}) {
      const {
        approvalGranted = false,
        requestedCapabilities = {},
        ...runnerOptions
      } = options;

      const decision = evaluateExecutionPolicy({
        check,
        policy,
        approvalGranted,
        requestedCapabilities,
      });

      // Never dispatch operations that aren't authorized.
      if (decision.decision !== "allowed") {
        return {
          decision,
          result: null,
        };
      }

      // Delegate only after policy authorization succeeds.
      const rawResult = await validatedRunner.runCheck(
        check,
        runnerOptions,
      );

      // Validate the runner's response before returning it.
      const result = createExecutionResult(rawResult);

      return {
        decision,
        result,
      };
    },
  };
}
