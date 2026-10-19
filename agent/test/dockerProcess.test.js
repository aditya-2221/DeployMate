import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createDockerProcessRunner,
  DOCKER_IMAGE,
  runDockerCheck,
} from "../src/execution/dockerProcess.js";

async function createWorkspace(t, command = "node --test") {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-staged-"),
  );

  t.after(async () => {
    await fs.rm(workspace, {
      recursive: true,
      force: true,
    });
  });

  await fs.writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({
      name: "staged-fixture",
      scripts: { test: command },
    }),
  );

  return workspace;
}

function fakeChild({
  exitCode = 0,
  stdout = "",
  stderr = "",
  signal = null,
  spawnError,
  hang = false,
  onKill,
} = {}) {
  const child = new EventEmitter();

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  child.kill = (killSignal) => {
    onKill?.(killSignal, child);
    return true;
  };

  if (spawnError) {
    queueMicrotask(() => {
      child.emit("error", spawnError);
    });
  } else if (!hang) {
    setImmediate(() => {
      if (stdout) child.stdout.write(stdout);
      if (stderr) child.stderr.write(stderr);

      child.stdout.end();
      child.stderr.end();

      child.emit("close", exitCode, signal);
    });
  }

  return child;
}

function makeSpawnSequence(configs) {
  const calls = [];

  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });

    const config = configs.shift();

    if (config?.throwOnSpawn) {
      throw config.throwOnSpawn;
    }

    return fakeChild(config ?? { exitCode: 0 });
  };

  return { spawnImpl, calls };
}

async function runWithMocks(t, configs, overrides = {}) {
  const workspace = await createWorkspace(
    t,
    overrides.expectedCommand ?? "node --test",
  );

  const { spawnImpl, calls } = makeSpawnSequence(configs);

  const runner = createDockerProcessRunner({ spawnImpl });

  const result = await runner.runDockerCheck({
    stagedWorkspacePath: workspace,
    script: "test",
    expectedCommand: "node --test",
    timeoutMs: 30,
    ...overrides,
  });

  return { result, calls };
}

test("uses the verified immutable Node image digest", () => {
  assert.match(
    DOCKER_IMAGE,
    /^node@sha256:[a-f0-9]{64}$/,
  );
});


test("enforces required Docker security restrictions", async (t) => {
  const { result, calls } = await runWithMocks(
    t,
    [
      { exitCode: 0 },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "passed");
  assert.equal(calls.length, 2);

  const args = calls[0].args;

  // Network isolation
  assert.equal(
    args[args.indexOf("--network") + 1],
    "none",
  );

  // Run as a non-root user
  assert.equal(
    args[args.indexOf("--user") + 1],
    "1000:1000",
  );

  // Read-only container filesystem
  assert.ok(args.includes("--read-only"));

  // Remove Linux capabilities
  assert.equal(
    args[args.indexOf("--cap-drop") + 1],
    "ALL",
  );

  // Prevent privilege escalation
  assert.equal(
    args[args.indexOf("--security-opt") + 1],
    "no-new-privileges:true",
  );

  // Restrict writable temporary storage
  assert.equal(
    args[args.indexOf("--tmpfs") + 1],
    "/tmp:rw,noexec,nosuid,size=64m",
  );

  // Mount the staged project read-only
  const mountIndex = args.indexOf("--mount");
  assert.notEqual(mountIndex, -1);
  assert.match(
    args[mountIndex + 1],
    /type=bind,.*target=\/workspace,readonly$/,
  );

  // Use the pinned image digest, not a floating tag
  assert.ok(args.includes(DOCKER_IMAGE));
  assert.match(
    DOCKER_IMAGE,
    /^node@sha256:[a-f0-9]{64}$/,
  );
});

test(
  "redacts common credentials from captured Docker output",
  async (t) => {
    const sensitiveOutput = [
      "Authorization: Bearer abc.def.ghi",
      "password=super-secret-value",
      'API_KEY="my-private-api-key"',
      "token: hidden-token-value",
      "Build failed in src/app.js",
    ].join("\n");

    const { result } = await runWithMocks(
      t,
      [
        {
          exitCode: 1,
          stdout: sensitiveOutput,
        },
        {
          exitCode: 0,
        },
      ],
    );

    assert.equal(result.status, "failed");

    assert.doesNotMatch(
      result.stdout,
      /abc\.def\.ghi|super-secret-value|my-private-api-key|hidden-token-value/,
    );

    assert.match(result.stdout, /\[REDACTED\]/);

    assert.match(
      result.stdout,
      /Build failed in src\/app\.js/,
    );
  },
);

test("rejects a relative staged workspace path", async () => {
  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: "relative-folder",
      script: "test",
      expectedCommand: "node --test",
    }),
    /absolute path/,
  );
});

test("rejects unsupported package managers", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      packageManager: "pnpm",
      script: "test",
      expectedCommand: "node --test",
    }),
    /Unsupported package manager/,
  );
});

test("rejects invalid script names", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      script: "test && whoami",
      expectedCommand: "node --test",
    }),
    /valid script name/,
  );
});

test("rejects a component path that escapes the workspace", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      componentRelativePath: "..",
      script: "test",
      expectedCommand: "node --test",
    }),
    /remain inside the staged workspace/,
  );
});

test("rejects a script changed in the staged package.json", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      script: "test",
      expectedCommand: "npm test",
    }),
    /does not match the validated command/,
  );
});

test("rejects timeouts outside the configured bounds", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      script: "test",
      expectedCommand: "node --test",
      timeoutMs: 999999999,
    }),
    /timeoutMs must be between/,
  );
});

test("rejects output limits above the configured maximum", async (t) => {
  const workspace = await createWorkspace(t);

  await assert.rejects(
    runDockerCheck({
      stagedWorkspacePath: workspace,
      script: "test",
      expectedCommand: "node --test",
      maxOutputBytes: 2 * 1024 * 1024,
    }),
    /maxOutputBytes must be between/,
  );
});

test("applies validated memory, CPU, and process limits to Docker", async (t) => {
  const { result, calls } = await runWithMocks(
    t,
    [
      { exitCode: 0 },
      { exitCode: 0 },
    ],
    {
      memoryMb: 256,
      cpuCount: 0.5,
      processLimit: 32,
    },
  );

  assert.equal(result.status, "passed");
  assert.equal(calls.length, 2);

  const dockerArgs = calls[0].args;

  assert.equal(
    dockerArgs[dockerArgs.indexOf("--memory") + 1],
    "256m",
  );

  assert.equal(
    dockerArgs[dockerArgs.indexOf("--cpus") + 1],
    "0.5",
  );

  assert.equal(
    dockerArgs[dockerArgs.indexOf("--pids-limit") + 1],
    "32",
  );
});


test("rejects invalid resource limits before spawning Docker", async (t) => {
  const workspace = await createWorkspace(t);
  const calls = [];

  const runner = createDockerProcessRunner({
    spawnImpl: (...args) => {
      calls.push(args);
      return fakeChild({ exitCode: 0 });
    },
  });

  const invalidLimits = [
    {
      memoryMb: 127,
      expectedError: /memoryMb must be between/,
    },
    {
      cpuCount: 0.1,
      expectedError: /cpuCount must be between/,
    },
    {
      processLimit: 0,
      expectedError: /processLimit must be between/,
    },
  ];

  for (const { expectedError, ...limit } of invalidLimits) {
    await assert.rejects(
      runner.runDockerCheck({
        stagedWorkspacePath: workspace,
        script: "test",
        expectedCommand: "node --test",
        ...limit,
      }),
      expectedError,
    );
  }

  assert.equal(
    calls.length,
    0,
    "Docker must not start when a resource limit is invalid",
  );
});


test("passes on exit code zero and always attempts cleanup", async (t) => {
  const { result, calls } = await runWithMocks(
    t,
    [
      { exitCode: 0, stdout: "tests ok\n" },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "passed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanup.success, true);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "docker");

  assert.ok(
    calls[0].args.includes(
      "npm_config_cache=/tmp/npm-cache",
    ),
  );

  assert.ok(
    calls[0].args.some((arg) =>
      String(arg).includes("target=/workspace,readonly"),
    ),
  );

  assert.deepEqual(
    calls[1].args.slice(0, 2),
    ["rm", "--force"],
  );
});

test("fails when the check exits with a non-zero code", async (t) => {
  const { result } = await runWithMocks(
    t,
    [
      { exitCode: 2, stderr: "tests failed" },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 2);
  assert.equal(result.error.code, "CHECK_FAILED");
});

test("handles a synchronous Docker spawn failure and attempts cleanup", async (t) => {
  const failure = new Error("docker executable missing");

  const { result, calls } = await runWithMocks(
    t,
    [
      { throwOnSpawn: failure },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "DOCKER_PROCESS_ERROR");
  assert.match(result.error.message, /executable missing/);
  assert.equal(calls.length, 2);
});

test("resolves an asynchronous spawn error without waiting for close", async (t) => {
  const failure = Object.assign(
    new Error("spawn ENOENT"),
    { code: "ENOENT" },
  );

  const { result } = await runWithMocks(
    t,
    [
      { spawnError: failure },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "DOCKER_PROCESS_ERROR");
  assert.match(result.error.message, /ENOENT/);
});

test("times out, kills the Docker CLI, and attempts container cleanup", async (t) => {
  let killed = false;

  const hangingChild = fakeChild({
    hang: true,
    onKill: (_signal, child) => {
      killed = true;

      setImmediate(() => {
        child.emit("close", null, "SIGTERM");
      });
    },
  });

  const { calls } = makeSpawnSequence([
    { hang: true },
    { exitCode: 0 },
  ]);

  let count = 0;

  const runner = createDockerProcessRunner({
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      count += 1;

      return count === 1
        ? hangingChild
        : fakeChild({ exitCode: 0 });
    },
  });

  const workspace = await createWorkspace(t);

  const result = await runner.runDockerCheck({
    stagedWorkspacePath: workspace,
    script: "test",
    expectedCommand: "node --test",
    timeoutMs: 10,
  });

  assert.equal(result.status, "timed_out");
  assert.equal(killed, true);
  assert.equal(result.cleanup.success, true);
  assert.equal(calls.length, 2);
});

test("bounds retained stdout and marks output truncation", async (t) => {
  const { result } = await runWithMocks(
    t,
    [
      { exitCode: 0, stdout: "0123456789" },
      { exitCode: 0 },
    ],
    { maxOutputBytes: 4 },
  );

  assert.match(result.stdout, /0123/);
  assert.match(result.stdout, /output truncated/);
});


test("disables automatic npm lifecycle scripts", async (t) => {
  const { result, calls } = await runWithMocks(
    t,
    [
      { exitCode: 0 },
      { exitCode: 0 },
    ],
  );

  assert.equal(result.status, "passed");

  const dockerArgs = calls[0].args;
  const imageIndex = dockerArgs.indexOf(DOCKER_IMAGE);

  assert.notEqual(imageIndex, -1);

  assert.deepEqual(
    dockerArgs.slice(imageIndex, imageIndex + 5),
    [
      DOCKER_IMAGE,
      "npm",
      "--ignore-scripts",
      "run",
      "test",
    ],
  );
});


test("cleanup failure cannot turn a passing check into success", async (t) => {
  const { result } = await runWithMocks(
    t,
    [
      { exitCode: 0 },
      {
        exitCode: 1,
        stderr: "Cannot connect to the Docker daemon",
      },
    ],
  );

  assert.equal(result.status, "failed");
  assert.equal(
    result.error.code,
    "CONTAINER_CLEANUP_FAILED",
  );
  assert.equal(result.cleanup.success, false);
});

test("only treats explicit missing-container messages as already removed", async (t) => {
  const workspace = await createWorkspace(t);

  const { spawnImpl } = makeSpawnSequence([
    { exitCode: 0 },
    {
      exitCode: 1,
      stderr: "Error: No such container: deploymate-example",
    },
  ]);

  const result = await createDockerProcessRunner({
    spawnImpl,
  }).runDockerCheck({
    stagedWorkspacePath: workspace,
    script: "test",
    expectedCommand: "node --test",
  });

  assert.equal(result.cleanup.success, true);
  assert.equal(result.cleanup.alreadyRemoved, true);
});

test("does not swallow a generic daemon not-found error as successful cleanup", async (t) => {
  const { result } = await runWithMocks(
    t,
    [
      { exitCode: 0 },
      {
        exitCode: 1,
        stderr: "Docker daemon endpoint not found",
      },
    ],
  );

  assert.equal(result.cleanup.success, false);
  assert.equal(
    result.error.code,
    "CONTAINER_CLEANUP_FAILED",
  );
});

test("rejects an invalid injected process launcher", () => {
  assert.throws(
    () => createDockerProcessRunner({ spawnImpl: 42 }),
    /spawnImpl must be a function/,
  );
});