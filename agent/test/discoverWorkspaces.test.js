
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { discoverWorkspaces } from "../src/discovery/discoverWorkspaces.js";

async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "deploymate-workspace-"));
}

async function createDirectory(root, relativePath) {
  await fs.mkdir(path.join(root, relativePath), {
    recursive: true,
  });
}

test("discovers directories matching workspace patterns", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createDirectory(root, "apps/web");
  await createDirectory(root, "apps/api");
  await createDirectory(root, "packages/shared");

  const result = await discoverWorkspaces(root, {
    workspaces: ["apps/*", "packages/*"],
  });

  assert.deepEqual(result.paths, [
    "apps/api",
    "apps/web",
    "packages/shared",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("supports object-style workspace configuration", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createDirectory(root, "packages/shared");

  const result = await discoverWorkspaces(root, {
    workspaces: {
      packages: ["packages/*"],
    },
  });

  assert.deepEqual(result.paths, ["packages/shared"]);
});

test("returns no workspaces when configuration is absent", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await discoverWorkspaces(root, {});

  assert.deepEqual(result.paths, []);
  assert.deepEqual(result.warnings, []);
});

test("warns on invalid workspace configuration", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await discoverWorkspaces(root, {
    workspaces: "apps/*",
  });

  assert.deepEqual(result.paths, []);
  assert.ok(result.warnings.length > 0);
});

test("does not return node_modules workspaces", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createDirectory(root, "apps/web");
  await createDirectory(root, "apps/web/node_modules/example");

  const result = await discoverWorkspaces(root, {
    workspaces: ["apps/**"],
  });

  assert.ok(
    result.paths.every((workspace) =>
      !workspace.includes("node_modules")
    )
  );
});
