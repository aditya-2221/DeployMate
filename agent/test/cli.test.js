
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../src/index.js", import.meta.url),
);

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
}

function makeProject() {
  const root = mkdtempSync(
    path.join(tmpdir(), "deploymate-cli-"),
  );

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "deploymate-cli-fixture",
      version: "1.0.0",
      scripts: {
        test: 'node -e "process.exit(0)"',
      },
    }),
  );

  writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      name: "deploymate-cli-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "deploymate-cli-fixture",
          version: "1.0.0",
        },
      },
    }),
  );

  return root;
}

test("missing project path returns a non-zero exit code", () => {
  const result = runCli([]);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test("--approve without --run is rejected", () => {
  const result = runCli(["C:\\sample-project", "--approve"]);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /--approve requires --run/);
});

test("unknown CLI options are rejected", () => {
  const result = runCli(["C:\\sample-project", "--unknown"]);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Unknown option: --unknown/);
});

test("discovery-only mode reports checks without executing them", () => {
  const root = makeProject();

  try {
    const result = runCli([root]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Check Inventory:/);
    assert.match(result.stdout, /Execution status: NOT RUN/);
    assert.doesNotMatch(
      result.stdout,
      /\[PASSED\].*\| test \| test/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
