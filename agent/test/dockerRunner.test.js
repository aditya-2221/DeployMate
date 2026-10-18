
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  validateDockerCheck,
} from "../src/execution/dockerRunner.js";

async function createFixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-docker-runner-")
  );

  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  // Keep the manifest and lockfile as separate files.
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: {
        test: "node --test",
      },
    })
  );

  await fs.writeFile(
    path.join(root, "package-lock.json"),
    JSON.stringify({
      name: "fixture",
      lockfileVersion: 3,
      packages: {},
    })
  );

  return root;
}

function createCheck(overrides = {}) {
  return {
    component: ".",
    type: "test",
    status: "available",
    script: "test",
    command: "node --test",
    ...overrides,
  };
}

test("validates a declared test script", async (t) => {
  const root = await createFixture(t);

  const result = await validateDockerCheck({
    projectRoot: root,
    check: createCheck(),
  });

  assert.equal(result.projectRoot, await fs.realpath(root));
  assert.equal(result.componentRelativePath, ".");
  assert.equal(result.packageManager, "npm");
  assert.equal(result.script, "test");
  assert.equal(result.command, "node --test");
});

test("rejects unavailable checks", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({ status: "unavailable" }),
    }),
    /not available/
  );
});

test("rejects unsupported check types", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({ type: "deploy" }),
    }),
    /Unsupported check type/
  );
});

test("rejects component paths outside the project", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({ component: ".." }),
    }),
    /escapes the project root/
  );
});

test("rejects a command that no longer matches package.json", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({
        command: "node unexpected.js",
      }),
    }),
    /does not match/
  );
});

test("rejects a script that is not an approved candidate for its type", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({
        type: "test",
        script: "start",
        command: "node --test",
      }),
    }),
    /approved candidate/
  );
});

test("rejects projects without a recognized lockfile", async (t) => {
  const root = await createFixture(t);

  await fs.rm(path.join(root, "package-lock.json"));

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck(),
    }),
    /No recognized package-manager lockfile/
  );
});

test("rejects conflicting package-manager lockfiles", async (t) => {
  const root = await createFixture(t);

  await fs.writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n"
  );

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck(),
    }),
    /Conflicting package-manager lockfiles/
  );
});

test("rejects absolute component paths", async (t) => {
  const root = await createFixture(t);

  await assert.rejects(
    validateDockerCheck({
      projectRoot: root,
      check: createCheck({ component: root }),
    }),
    /relative component path/
  );
});

test("inherits the root package manager for a nested component", async (t) => {
  const root = await createFixture(t);
  const component = path.join(root, "apps", "api");

  await fs.mkdir(component, { recursive: true });

  await fs.writeFile(
    path.join(component, "package.json"),
    JSON.stringify({
      name: "api",
      scripts: {
        test: "node --test",
      },
    })
  );

  const result = await validateDockerCheck({
    projectRoot: root,
    check: createCheck({ component: "apps/api" }),
  });

  assert.equal(result.packageManager, "npm");
  assert.equal(result.componentRelativePath, path.join("apps", "api"));
});
