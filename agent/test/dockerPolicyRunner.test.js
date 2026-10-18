
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPolicyAwareDockerRunner } from "../src/execution/dockerPolicyRunner.js";

const FIXED_START = "2026-10-18T10:00:00.000Z";
const FIXED_END = "2026-10-18T10:00:00.010Z";

const BASE_POLICY = {
  profile: "standard",
  trustedProject: true,
  allowedCheckTypes: ["test"],
};

const RESTRICTED_POLICY = {
  profile: "restricted",
  trustedProject: true,
  allowedCheckTypes: ["test"],
};

const CHECK = {
  component: ".",
  type: "test",
  status: "available",
  script: "test",
  command: `node -e "console.log('ok')"`,
};

async function makeProject() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-integration-"),
  );

  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "integration-fixture",
      version: "1.0.0",
      scripts: {
        test: CHECK.command,
      },
    }),
  );

  await fs.writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      name: "integration-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
    }),
  );

  return root;
}

function successfulDockerResult(overrides = {}) {
  return {
    status: "passed",
    exitCode: 0,
    signal: null,
    stdout: "ok",
    stderr: "",
    durationMs: 10,
    startedAt: FIXED_START,
    finishedAt: FIXED_END,
    runner: "docker",
    workingDirectory: "/staged-workspace",
    error: null,
    cleanup: true,
    processDidNotClose: false,
    ...overrides,
  };
}

function createStagingHarness({
  sourceRoot,
  stagedRoot,
  stageError,
  cleanupError,
} = {}) {
  const calls = {
    stage: 0,
    cleanup: 0,
    docker: 0,
    dockerOptions: [],
    stagedRoots: [],
  };

  const stageWorkspace = async ({ projectRoot }) => {
    calls.stage += 1;
    calls.stagedRoots.push(projectRoot);

    if (stageError) {
      throw stageError;
    }

    const actualStagedRoot =
      stagedRoot ??
      await fs.mkdtemp(
        path.join(os.tmpdir(), "deploymate-staged-test-"),
      );

    return {
      stagedRoot: actualStagedRoot,

      async cleanup() {
        calls.cleanup += 1;

        if (cleanupError) {
          throw cleanupError;
        }

        // Remove only the dedicated test staging directory.
        if (actualStagedRoot !== sourceRoot) {
          await fs.rm(actualStagedRoot, {
            recursive: true,
            force: true,
          });
        }
      },
    };
  };

  return { calls, stageWorkspace };
}

async function withProject(callback) {
  const projectRoot = await makeProject();

  try {
    await callback(projectRoot);
  } finally {
    await fs.rm(projectRoot, {
      recursive: true,
      force: true,
    });
  }
}

function assertExecutionResult(result) {
  assert.ok(result, "Expected a normalized execution result");
  assert.equal(typeof result.status, "string");
  assert.equal(typeof result.component, "string");
  assert.equal(typeof result.type, "string");
  assert.ok(
    Number.isInteger(result.exitCode) || result.exitCode === null,
    "exitCode must be an integer or null",
  );

  if (result.status === "passed") {
    assert.equal(result.exitCode, 0);
  }

  if (result.status === "failed") {
    assert.ok(
      Number.isInteger(result.exitCode) && result.exitCode !== 0,
      "A failed result must have a non-zero integer exit code",
    );
  }
}

test("policy denial prevents staging and Docker execution", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({ sourceRoot: projectRoot });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: RESTRICTED_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;
          throw new Error("Docker must not run for a denied check");
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.notEqual(response.decision.decision, "allowed");
    assert.equal(response.result, null);
    assert.equal(harness.calls.stage, 0);
    assert.equal(harness.calls.docker, 0);
    assert.equal(harness.calls.cleanup, 0);
  });
});

test("allowed check uses a separate staged workspace and cleans it once", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    harness.dockerRunner = {
      async runDockerCheck(options) {
        harness.calls.docker += 1;
        harness.calls.dockerOptions.push(options);

        assert.notEqual(
          path.resolve(options.stagedWorkspacePath),
          path.resolve(projectRoot),
          "Docker must not receive the original project root",
        );

        assert.equal(options.script, CHECK.script);
        assert.equal(options.expectedCommand, CHECK.command);

        return successfulDockerResult({
          workingDirectory: options.stagedWorkspacePath,
        });
      },
    };

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: harness.dockerRunner,
    });

    const response = await runner.runCheck(CHECK);

    assert.equal(response.decision.decision, "allowed");
    assertExecutionResult(response.result);
    assert.equal(response.result.status, "passed");
    assert.equal(response.result.exitCode, 0);

    assert.equal(harness.calls.stage, 1);
    assert.equal(harness.calls.docker, 1);
    assert.equal(harness.calls.cleanup, 1);
    assert.equal(harness.calls.dockerOptions.length, 1);
  });
});

test("staging failure prevents Docker execution", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
      stageError: new Error("Staging failed"),
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;
          return successfulDockerResult();
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.equal(harness.calls.stage, 1);
    assert.equal(harness.calls.docker, 0);
    assert.equal(harness.calls.cleanup, 0);
    assert.ok(response.result);
    assert.notEqual(response.result.status, "passed");
    assertExecutionResult(response.result);
  });
});

test("Docker non-zero exit is preserved as a failed check", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck(options) {
          harness.calls.docker += 1;

          return successfulDockerResult({
            status: "failed",
            exitCode: 7,
            stdout: "",
            stderr: "Test assertion failed",
            error: {
              code: "CHECK_FAILED",
              message: "The test command returned a non-zero exit code",
            },
            workingDirectory: options.stagedWorkspacePath,
          });
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assertExecutionResult(response.result);
    assert.equal(response.result.status, "failed");
    assert.equal(response.result.exitCode, 7);
    assert.match(response.result.stderr, /Test assertion failed/);
    assert.equal(harness.calls.cleanup, 1);
  });
});

test("Docker timeout remains a timeout and still cleans up", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;

          return successfulDockerResult({
            status: "timed_out",
            exitCode: null,
            signal: "SIGTERM",
            stderr: "Execution exceeded the time limit",
            error: {
              code: "EXECUTION_TIMEOUT",
              message: "Execution timed out",
            },
          });
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assertExecutionResult(response.result);
    assert.equal(response.result.status, "timed_out");
    assert.equal(response.result.exitCode, null);
    assert.equal(harness.calls.docker, 1);
    assert.equal(harness.calls.cleanup, 1);
  });
});

test("Docker runner exception is normalized and staged workspace is cleaned", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;
          throw new Error("Docker daemon unavailable");
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.equal(harness.calls.docker, 1);
    assert.equal(harness.calls.cleanup, 1);
    assert.ok(response.result);
    assert.notEqual(response.result.status, "passed");
    assertExecutionResult(response.result);
  });
});

test("cleanup failure after successful Docker execution cannot report success", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
      cleanupError: new Error("Unable to remove staging directory"),
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;
          return successfulDockerResult();
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.equal(harness.calls.docker, 1);
    assert.equal(harness.calls.cleanup, 1);
    assert.ok(response.result);
    assert.notEqual(
      response.result.status,
      "passed",
      "Cleanup failure must not be silently reported as success",
    );
    assertExecutionResult(response.result);
  });
});

test("cleanup failure after Docker exception does not cause double cleanup", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
      cleanupError: new Error("Cleanup also failed"),
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;
          throw new Error("Docker execution failed");
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.equal(harness.calls.docker, 1);
    assert.equal(
      harness.calls.cleanup,
      1,
      "Each staged workspace must have at most one cleanup attempt",
    );
    assert.ok(response.result);
    assert.notEqual(response.result.status, "passed");
    assertExecutionResult(response.result);
  });
});

test("workspace cleanup failure is not confused with a successful check", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
      cleanupError: new Error("Filesystem cleanup denied"),
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck() {
          harness.calls.docker += 1;

          return successfulDockerResult({
            stdout: "check passed",
          });
        },
      },
    });

    const response = await runner.runCheck(CHECK);

    assert.ok(response.result);
    assert.notEqual(response.result.status, "passed");
    assert.equal(harness.calls.cleanup, 1);
    assertExecutionResult(response.result);
  });
});

test("Docker receives execution limits from caller options", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: BASE_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck(options) {
          harness.calls.dockerOptions.push(options);
          return successfulDockerResult({
            workingDirectory: options.stagedWorkspacePath,
          });
        },
      },
    });

    await runner.runCheck(CHECK, {
      timeoutMs: 15_000,
      maxOutputBytes: 64 * 1024,
    });

    assert.equal(harness.calls.dockerOptions.length, 1);
    assert.equal(harness.calls.dockerOptions[0].timeoutMs, 15_000);
    assert.equal(
      harness.calls.dockerOptions[0].maxOutputBytes,
      64 * 1024,
    );
  });
});

test("runner setup rejects a missing project root", () => {
  assert.throws(
    () => createPolicyAwareDockerRunner({
      policy: BASE_POLICY,
    }),
  );
});


test("runner setup rejects an invalid Docker runner", async () => {
  await withProject(async (projectRoot) => {
    assert.throws(
      () =>
        createPolicyAwareDockerRunner({
          projectRoot,
          policy: BASE_POLICY,
          dockerRunner: null,
        }),
      /dockerRunner must expose runDockerCheck/,
    );
  });
});



test("restricted policy requires approval before execution", async () => {
  await withProject(async (projectRoot) => {
    const harness = createStagingHarness({
      sourceRoot: projectRoot,
    });

    const runner = createPolicyAwareDockerRunner({
      projectRoot,
      policy: RESTRICTED_POLICY,
      stageWorkspace: harness.stageWorkspace,
      dockerRunner: {
        async runDockerCheck(options) {
          harness.calls.docker += 1;
          return successfulDockerResult({
            workingDirectory: options.stagedWorkspacePath,
          });
        },
      },
    });

    // Without approval, execution must not start.
    const denied = await runner.runCheck(CHECK);

    assert.notEqual(denied.decision.decision, "allowed");
    assert.equal(denied.result, null);
    assert.equal(harness.calls.stage, 0);
    assert.equal(harness.calls.docker, 0);

    // With approval, execution may proceed.
    const approved = await runner.runCheck(CHECK, {
      approvalGranted: true,
    });

    assert.equal(approved.decision.decision, "allowed");
    assert.equal(approved.result.status, "passed");
    assert.equal(harness.calls.stage, 1);
    assert.equal(harness.calls.docker, 1);
    assert.equal(harness.calls.cleanup, 1);
  });
});

