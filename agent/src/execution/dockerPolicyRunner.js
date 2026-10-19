
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createPolicyAwareRunner } from "./policyRunner.js";
import { validateDockerCheck } from "./dockerRunner.js";
import { createStagedWorkspace } from "./workspace.js";
import { runDockerCheck } from "./dockerProcess.js";
import { adaptDockerResult } from "./resultAdapter.js";
import { createExecutionResult } from "./result.js";

function createSetupFailure(check, error, code = "RUNNER_SETUP_FAILED") {
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
      code,
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
 * Dependency installation is not enabled until DeployMate has a verified
 * egress-restricted installation network. An explicit install request is
 * policy-checked first, then fails closed with an actionable result rather
 * than silently using an unrestricted Docker bridge network.
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
      if (options.installDependencies === true) {
        const error = new Error(
          "Dependency installation is not configured. DeployMate requires a verified egress-restricted Docker network or registry proxy before it can download dependencies. Existing network-isolated checks remain available without installation."
        );
        return createSetupFailure(
          check,
          error,
          "DEPENDENCY_INSTALL_NETWORK_NOT_CONFIGURED",
        );
      }

      let stagedWorkspace;
      let cleanupAttempted = false;

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
            memoryMb: options.memoryMb,
            cpuCount: options.cpuCount,
            processLimit: options.processLimit,
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

        // Mark the attempt before awaiting it so an exception cannot
        // cause the outer catch to attempt cleanup a second time.
        cleanupAttempted = true;

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
        // Clean up only if a workspace exists and no cleanup attempt
        // has already started. Never retry implicitly here.
        if (stagedWorkspace && !cleanupAttempted) {
          cleanupAttempted = true;

          try {
            await stagedWorkspace.cleanup();
          } catch {
            // Preserve the primary setup/adaptation error.
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
