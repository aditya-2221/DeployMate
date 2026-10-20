
import { createExecutionResult } from "./result.js";

function createOrchestrationFailure(check, error) {
  return createExecutionResult({
    executionId: null,
    component: check.component,
    type: check.type,
    script: check.script ?? null,
    command: check.command ?? null,
    status: "not_run",
    runner: "docker",
    workingDirectory: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    stdout: "",
    stderr: "",
    durationMs: null,
    error: {
      code: "ORCHESTRATION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "An unexpected orchestration error occurred.",
    },
  });
}

export async function orchestrateChecks({
  checks,
  runner,
  approvalGranted = false,
}) {
  const executionResults = [];
  const policyDecisions = [];
  let orchestrationFailed = false;

  for (const check of checks) {
    try {
      const outcome = await runner.runCheck(check, {
        approvalGranted,
      });

      policyDecisions.push({
        check,
        decision: outcome.decision,
      });

      if (outcome.result !== null) {
        executionResults.push(outcome.result);
      }
    } catch (error) {
      orchestrationFailed = true;

      executionResults.push(
        createOrchestrationFailure(check, error),
      );
    }
  }

  return {
    executionResults,
    policyDecisions,
    orchestrationFailed,
  };
}
