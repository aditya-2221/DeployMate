
import { assertRunner } from "./runner.js";
import { evaluateExecutionPolicy } from "./policy.js";
import { createExecutionResult } from "./result.js";

/**
 * Creates a policy gate around an existing runner.
 *
 * This module authorizes operations but does not implement
 * operating-system process isolation or command execution.
 */

function capRequestedLimit(requested, policyMaximum) {
  if (requested === undefined) {
    return policyMaximum;
  }

  // Preserve invalid values so the execution layer rejects them.
  if (typeof requested !== "number") {
    return requested;
  }

  return Math.min(requested, policyMaximum);
}

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
        installDependencies = false,
        dependencyInstallTargets = [],
        ...runnerOptions
      } = options;

      if (typeof installDependencies !== "boolean") {
        throw new TypeError("installDependencies must be a boolean.");
      }

      // Dependency installation is a distinct, explicitly requested
      // capability. Do not let a caller's generic requestedCapabilities
      // object accidentally omit the network authorization check.
      const effectiveRequestedCapabilities = installDependencies
        ? {
            networkAccess: true,
            networkPurpose: "dependency_install",
            networkTargets: dependencyInstallTargets,
            secrets: requestedCapabilities?.secrets ?? false,
          }
        : requestedCapabilities;

      const decision = evaluateExecutionPolicy({
        check,
        policy,
        approvalGranted,
        requestedCapabilities: effectiveRequestedCapabilities,
      });

      // Never dispatch operations that aren't authorized.
      if (decision.decision !== "allowed") {
        return {
          decision,
          result: null,
        };
      }

      // Policy limits are authoritative. Callers may request stricter
      // limits, but cannot increase resource consumption beyond policy.
      const effectiveRunnerOptions = {
        ...runnerOptions,
        // Preserve the existing runner-options shape unless installation
        // was explicitly requested.
        ...(installDependencies ? { installDependencies: true } : {}),
      };

      for (const key of [
        "timeoutMs",
        "maxOutputBytes",
        "memoryMb",
        "cpuCount",
        "processLimit",
      ]) {
        effectiveRunnerOptions[key] = capRequestedLimit(
          runnerOptions[key],
          decision.limits[key],
        );
      }

      // Delegate only after policy authorization succeeds.
      const rawResult = await validatedRunner.runCheck(
        check,
        effectiveRunnerOptions,
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
