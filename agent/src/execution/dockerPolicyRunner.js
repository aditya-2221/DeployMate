
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createPolicyAwareRunner } from "./policyRunner.js";
import { validateDockerCheck } from "./dockerRunner.js";
import { createStagedWorkspace } from "./workspace.js";
import { runDockerCheck } from "./dockerProcess.js";
import { adaptDockerResult } from "./resultAdapter.js";
import { createExecutionResult } from "./result.js";

function createSetupFailure(check, error) {
  return createExecutionResult({
    executionId: randomUUID(),
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
      code: "RUNNER_SETUP_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Docker runner setup failed.",
    },
  });
}

/**
 * Adds staging and Docker execution behind the existing policy gate.
 *
 * This runner does not install dependencies. The staged workspace
 * must already contain everything needed for the selected check.
 */
export function createPolicyAwareDockerRunner({
  projectRoot,
  policy = {},
  dockerRunner = { runDockerCheck },
  stageWorkspace = createStagedWorkspace,
} = {}) {
  if (
    typeof projectRoot !== "string" ||
    !projectRoot.trim()
  ) {
    throw new TypeError("projectRoot must be a non-empty path.");
  }

  if (
    !dockerRunner ||
    typeof dockerRunner.runDockerCheck !== "function"
  ) {
    throw new TypeError(
      "dockerRunner must expose runDockerCheck()."
    );
  }

  if (typeof stageWorkspace !== "function") {
    throw new TypeError("stageWorkspace must be a function.");
  }

  const executionRunner = {
    async runCheck(check, options = {}) {
      let stagedWorkspace;

      try {
        // Revalidate the project and selected script before staging.
        const validated = await validateDockerCheck({
          projectRoot,
          check,
        });

        stagedWorkspace = await stageWorkspace({
          projectRoot: validated.projectRoot,
        });

        const componentRelativePath =
          path.relative(
            validated.projectRoot,
            validated.componentPath
          ) || ".";

        let rawResult;

        try {
          rawResult = await dockerRunner.runDockerCheck({
            stagedWorkspacePath: stagedWorkspace.stagedRoot,
            componentRelativePath,
            packageManager: validated.packageManager,
            script: validated.script,
            expectedCommand: validated.command,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: options.maxOutputBytes,
          });
        } catch (error) {
          rawResult = {
            status: "failed",
            exitCode: null,
            stdout: "",
            stderr: "",
            durationMs: null,
            startedAt: null,
            finishedAt: null,
            runner: "docker",
            workingDirectory: null,
            error: {
              code: "DOCKER_RUNNER_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "Docker execution failed unexpectedly.",
            },
          };
        }

        // Workspace cleanup is required even when Docker fails.
        try {
          await stagedWorkspace.cleanup();
        } catch (error) {
          rawResult = {
            ...rawResult,
            status:
              rawResult.status === "timed_out"
                ? "timed_out"
                : "failed",
            error: {
              code: "WORKSPACE_CLEANUP_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "Staged workspace cleanup failed.",
              ...(rawResult.error
                ? {
                    details:
                      `Original execution error: ${rawResult.error.code ?? "unknown"}`,
                  }
                : {}),
            },
          };
        }

        return adaptDockerResult({
          rawResult,
          check,
        });
      } catch (error) {
        // If staging succeeded but execution setup failed, clean up.
        if (stagedWorkspace) {
          try {
            await stagedWorkspace.cleanup();
          } catch {
            // Preserve the original setup error.
            // Cleanup telemetry should be added separately.
          }
        }

        return createSetupFailure(check, error);
      }
    },
  };

  return createPolicyAwareRunner({
    runner: executionRunner,
    policy,
  });
}
