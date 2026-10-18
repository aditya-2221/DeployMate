
import { randomUUID } from "node:crypto";
import { createExecutionResult } from "./result.js";

const VALID_STATUSES = new Set([
  "passed",
  "failed",
  "timed_out",
]);

function normalizeError(error) {
  if (!error) return null;

  return {
    code:typeof error.code === "string" && error.code.trim() ? error.code: "EXECUTION_ERROR",
    message:typeof error.message === "string" && error.message.trim() ? error.message: "The execution runner reported an error.",
    ...(typeof error.details === "string" ? { details: error.details } : {}),
  };
}

/**
 * Convert the low-level Docker runner response into the
 * application's validated execution-result format.
 *
 * This function does not execute commands or grant permissions.
 */
export function adaptDockerResult({
  rawResult,
  check,
  executionId = randomUUID(),
} = {}) {
  if (!rawResult || typeof rawResult !== "object") {
    throw new TypeError("rawResult must be an object.");
  }

  if (!check || typeof check !== "object") {
    throw new TypeError("check must be an object.");
  }

  if (
    typeof check.component !== "string" ||
    !check.component.trim() ||
    typeof check.type !== "string" ||
    !check.type.trim()
  ) {
    throw new TypeError(
      "check must contain non-empty component and type fields."
    );
  }

  if (!VALID_STATUSES.has(rawResult.status)) {
    throw new Error(
      `Unsupported Docker result status: ${rawResult.status}`
    );
  }

  const exitCode =  Number.isInteger(rawResult.exitCode) ? rawResult.exitCode: null;

  let status = rawResult.status;
  let error = normalizeError(rawResult.error);

  // A passed check must have exit code 0.
  if (status === "passed" && exitCode !== 0) {
    throw new Error(
      "Docker reported success without exit code 0."
    );
  }

  // A project check that exits non-zero is a normal failure.
  if (status === "failed" && exitCode === null) {
    /*
     * The existing schema requires a non-zero exit code for
     * status "failed". Do not invent one for Docker/runner errors.
     *
     * Use "not_run" to indicate that a valid check outcome
     * could not be established. The error remains available
     * for diagnostics.
     */
    status = "not_run";
    error ??= {
      code: "EXECUTION_OUTCOME_UNKNOWN",
      message:
        "The runner failed without providing a valid exit code.",
    };
  }

  if (status === "failed" && exitCode === 0) {
    if (
        error?.code === "CONTAINER_CLEANUP_FAILED" ||
        error?.code === "WORKSPACE_CLEANUP_FAILED"
    ) {
        status = "not_run";
    } else {
        throw new Error(
        "Docker reported failure with exit code 0."
        );
    }
  }


  return createExecutionResult({
    executionId,
    component: check.component,
    type: check.type,
    script: check.script ?? null,
    command: check.command ?? null,
    status,
    runner: rawResult.runner ?? "docker",
    workingDirectory: rawResult.workingDirectory ?? null,
    startedAt: rawResult.startedAt ?? null,
    finishedAt: rawResult.finishedAt ?? null,
    exitCode,
    stdout: rawResult.stdout ?? "",
    stderr: rawResult.stderr ?? "",
    durationMs: rawResult.durationMs ?? null,
    error,
  });
}
