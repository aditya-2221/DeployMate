import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import pathPosix from "node:path/posix";
import { randomUUID } from "node:crypto";

export const DOCKER_IMAGE =
  "node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 2_000;

const PACKAGE_MANAGERS = Object.freeze({ npm: true });

function validateOptions({
  stagedWorkspacePath,
  componentRelativePath = ".",
  packageManager = "npm",
  script,
  expectedCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (
    typeof stagedWorkspacePath !== "string" ||
    !path.isAbsolute(stagedWorkspacePath)
  ) {
    throw new TypeError(
      "stagedWorkspacePath must be an absolute path to a disposable staged workspace.",
    );
  }

  if (
    typeof componentRelativePath !== "string" ||
    !componentRelativePath.trim() ||
    path.isAbsolute(componentRelativePath)
  ) {
    throw new TypeError("componentRelativePath must be a relative path.");
  }

  const normalizedComponentPath = path.normalize(componentRelativePath);

  if (
    normalizedComponentPath === ".." ||
    normalizedComponentPath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      "componentRelativePath must remain inside the staged workspace.",
    );
  }

  if (!Object.hasOwn(PACKAGE_MANAGERS, packageManager)) {
    throw new Error(
      `Unsupported package manager for this runner: ${packageManager}`,
    );
  }

  if (
    typeof script !== "string" ||
    !/^[a-zA-Z0-9:_-]+$/.test(script)
  ) {
    throw new TypeError("script must be a valid script name.");
  }

  if (
    typeof expectedCommand !== "string" ||
    !expectedCommand.trim()
  ) {
    throw new TypeError(
      "expectedCommand must be a non-empty string.",
    );
  }

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }

  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > MAX_OUTPUT_LIMIT_BYTES
  ) {
    throw new RangeError(
      `maxOutputBytes must be between 1 and ${MAX_OUTPUT_LIMIT_BYTES}.`,
    );
  }

  return {
    stagedWorkspacePath,
    componentRelativePath: normalizedComponentPath,
    packageManager,
    script,
    expectedCommand,
    timeoutMs,
    maxOutputBytes,
  };
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

async function validateStagedWorkspace(options) {
  const workspace = await fs.realpath(
    options.stagedWorkspacePath,
  );

  const workspaceStats = await fs.stat(workspace);

  if (!workspaceStats.isDirectory()) {
    throw new Error(
      "The staged workspace must be a directory.",
    );
  }

  // Commas have special meaning in Docker's --mount syntax.
  if (workspace.includes(",")) {
    throw new Error(
      "The staged workspace path cannot contain commas.",
    );
  }

  const componentPath = path.resolve(
    workspace,
    options.componentRelativePath,
  );

  if (!isInsideRoot(workspace, componentPath)) {
    throw new Error(
      "Component path escapes the staged workspace.",
    );
  }

  const realComponentPath = await fs.realpath(componentPath);

  if (!isInsideRoot(workspace, realComponentPath)) {
    throw new Error(
      "Component resolves outside the staged workspace.",
    );
  }

  const packageJsonPath = path.join(
    realComponentPath,
    "package.json",
  );

  const packageStats = await fs.stat(packageJsonPath);

  if (!packageStats.isFile()) {
    throw new Error(
      "The component package.json must be a regular file.",
    );
  }

  let packageJson;

  try {
    packageJson = JSON.parse(
      await fs.readFile(packageJsonPath, "utf8"),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Staged package.json is invalid JSON.");
    }

    throw error;
  }

  if (
    !packageJson ||
    typeof packageJson !== "object" ||
    Array.isArray(packageJson) ||
    !packageJson.scripts ||
    typeof packageJson.scripts !== "object" ||
    Array.isArray(packageJson.scripts)
  ) {
    throw new Error(
      "Staged package.json has no valid scripts object.",
    );
  }

  if (
    packageJson.scripts[options.script] !==
    options.expectedCommand
  ) {
    throw new Error(
      "The staged script does not match the validated command.",
    );
  }

  return {
    workspace,
    componentPath: realComponentPath,
    componentRelativePath:
      path.relative(workspace, realComponentPath) || ".",
  };
}

function createBoundedCollector(maxBytes) {
  let output = Buffer.alloc(0);
  let truncated = false;

  return {
    append(chunk) {
      const incoming = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

      const remaining = maxBytes - output.length;

      if (incoming.length > remaining) {
        if (remaining > 0) {
          output = Buffer.concat([
            output,
            incoming.subarray(0, remaining),
          ]);
        }

        truncated = true;
        return;
      }

      output = Buffer.concat([output, incoming]);
    },

    value() {
      const text = output.toString("utf8");

      return truncated
        ? `${text}\n[DeployMate: output truncated]`
        : text;
    },
  };
}

function startProcess(args, spawnImpl) {
  return spawnImpl("docker", args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Runs a Docker CLI command while draining output and
 * retaining bounded buffers.
 */
async function runDockerCommand(
  args,
  {
    timeoutMs,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  },
  spawnImpl,
) {
  const stdout = createBoundedCollector(maxOutputBytes);
  const stderr = createBoundedCollector(maxOutputBytes);

  let child;

  try {
    child = startProcess(args, spawnImpl);
  } catch (error) {
    return {
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      error,
      timedOut: false,
      processDidNotClose: false,
    };
  }

  child.stdout?.on("data", (chunk) => stdout.append(chunk));
  child.stderr?.on("data", (chunk) => stderr.append(chunk));

  let timedOut = false;
  let spawnError = null;
  let closed = false;
  let exitCode = null;
  let signal = null;
  let forceTimer;
  let hardTimer;

  const completion = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;

      // A failed spawn may not emit close on every supported runtime.
      resolve("error");
    });

    child.once("close", (code, childSignal) => {
      closed = true;
      exitCode = code;
      signal = childSignal;
      resolve("closed");
    });
  });

  const timeout = new Promise((resolve) => {
    hardTimer = setTimeout(() => {
      timedOut = true;

      try {
        child.kill();
      } catch {
        // Container cleanup is attempted by the caller.
      }

      forceTimer = setTimeout(() => {
        if (!closed) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Cleanup is still attempted.
          }
        }

        resolve("kill-grace-expired");
      }, KILL_GRACE_MS);
    }, timeoutMs);
  });

  const outcome = await Promise.race([
    completion,
    timeout,
  ]);

  clearTimeout(hardTimer);

  if (forceTimer) {
    clearTimeout(forceTimer);
  }

  if (outcome === "kill-grace-expired" && !closed) {
    return {
      exitCode: null,
      signal,
      stdout: stdout.value(),
      stderr: stderr.value(),
      error:
        spawnError ??
        new Error(
          "Docker CLI did not terminate after being killed.",
        ),
      timedOut,
      processDidNotClose: true,
    };
  }

  return {
    exitCode,
    signal,
    stdout: stdout.value(),
    stderr: stderr.value(),
    error: spawnError,
    timedOut,
    processDidNotClose: false,
  };
}

async function removeContainer(containerName, spawnImpl) {
  const result = await runDockerCommand(
    ["rm", "--force", containerName],
    {
      timeoutMs: CLEANUP_TIMEOUT_MS,
      maxOutputBytes: 8 * 1024,
    },
    spawnImpl,
  );

  if (result.exitCode === 0 && !result.error) {
    return { success: true };
  }

  const combinedOutput =
    `${result.stdout}\n${result.stderr}`.toLowerCase();

  // Only accept explicit Docker missing-object messages.
  // Generic "not found" messages may hide daemon failures.
  if (
    /no such container:\s*\S+|no such object:\s*\S+/.test(
      combinedOutput,
    )
  ) {
    return {
      success: true,
      alreadyRemoved: true,
    };
  }

  return {
    success: false,
    error:
      result.error?.message ||
      result.stderr.trim() ||
      (
        result.processDidNotClose
          ? "Docker cleanup process did not terminate."
          : `Container cleanup failed with exit code ${result.exitCode}.`
      ),
  };
}

async function runDockerCheckWithSpawn(options, spawnImpl) {
  const validated = validateOptions(options);

  const {
    workspace,
    componentPath,
    componentRelativePath,
  } = await validateStagedWorkspace(validated);

  const containerName = `deploymate-${randomUUID()}`;
  const startedAt = new Date();
  const startTime = Date.now();

  const containerWorkingDirectory =
    componentRelativePath === "."
      ? "/workspace"
      : pathPosix.join(
          "/workspace",
          ...componentRelativePath.split(path.sep),
        );

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,

    "--network",
    "none",

    "--user",
    "1000:1000",

    "--read-only",

    "--cap-drop",
    "ALL",

    "--security-opt",
    "no-new-privileges:true",

    "--pids-limit",
    "128",

    "--memory",
    "512m",

    "--cpus",
    "1",

    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",

    "--env",
    "npm_config_cache=/tmp/npm-cache",

    "--mount",
    `type=bind,source=${workspace},target=/workspace,readonly`,

    "--workdir",
    containerWorkingDirectory,

    DOCKER_IMAGE,
    "npm",
    "run",
    validated.script,
  ];

  const execution = await runDockerCommand(
    args,
    {
      timeoutMs: validated.timeoutMs,
      maxOutputBytes: validated.maxOutputBytes,
    },
    spawnImpl,
  );

  // Always attempt cleanup, including after timeout or
  // Docker CLI failure.
  const cleanup = await removeContainer(
    containerName,
    spawnImpl,
  );

  const finishedAt = new Date();
  const durationMs = Date.now() - startTime;

  let status;
  let error = null;

  if (execution.timedOut) {
    status = "timed_out";
    error = {
      code: "CHECK_TIMEOUT",
      message: `Check exceeded ${validated.timeoutMs} ms.`,
    };
  } else if (execution.error) {
    status = "failed";
    error = {
      code: "DOCKER_PROCESS_ERROR",
      message: execution.error.message,
    };
  } else if (execution.exitCode === 0) {
    status = "passed";
  } else if (execution.exitCode !== null) {
    status = "failed";
    error = {
      code: "CHECK_FAILED",
      message:
        `Docker check exited with code ${execution.exitCode}.`,
    };
  } else {
    status = "failed";
    error = {
      code: "DOCKER_EXIT_UNKNOWN",
      message: "Docker ended without a known exit code.",
    };
  }

  if (!cleanup.success) {
    error = {
      code: "CONTAINER_CLEANUP_FAILED",
      message: `Container cleanup failed: ${cleanup.error}`,
      ...(error
        ? { details: `Original execution outcome: ${error.code}` }
        : {}),
    };

    // Cleanup failure must not be reported as success.
    if (status === "passed") {
      status = "failed";
    }
  }

  return {
    status,
    exitCode: execution.exitCode,
    signal: execution.signal ?? null,
    stdout: execution.stdout,
    stderr: execution.stderr,
    durationMs,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    runner: "docker",
    workingDirectory: componentPath,
    error,
    cleanup,
    processDidNotClose:
      execution.processDidNotClose ?? false,
  };
}

/**
 * Creates a runner with an injectable process launcher.
 * Injection is intended for deterministic tests.
 * Production callers should use runDockerCheck.
 */
export function createDockerProcessRunner({
  spawnImpl = spawn,
} = {}) {
  if (typeof spawnImpl !== "function") {
    throw new TypeError("spawnImpl must be a function.");
  }

  return {
    runDockerCheck(options = {}) {
      return runDockerCheckWithSpawn(options, spawnImpl);
    },
  };
}

export async function runDockerCheck(options = {}) {
  return runDockerCheckWithSpawn(options, spawn);
}