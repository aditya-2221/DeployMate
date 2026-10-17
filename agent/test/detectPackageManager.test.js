
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { detectPackageManager } from "../src/discovery/detectPackageManager.js";

async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "deploymate-manager-"));
}

async function createLockfile(root, filename) {
  await fs.writeFile(path.join(root, filename), "", "utf8");
}

test("detects npm from package-lock.json", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createLockfile(root, "package-lock.json");

  const result = await detectPackageManager(root);

  assert.equal(result.manager, "npm");
  assert.equal(result.lockfiles.length, 1);
  assert.equal(result.warning, null);
});

test("returns unknown when no lockfile exists", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await detectPackageManager(root);

  assert.equal(result.manager, "unknown");
  assert.ok(result.warning);
});

test("reports ambiguity when different managers exist", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createLockfile(root, "package-lock.json");
  await createLockfile(root, "pnpm-lock.yaml");

  const result = await detectPackageManager(root);

  assert.equal(result.manager, "ambiguous");
  assert.equal(result.lockfiles.length, 2);
  assert.ok(result.warning);
});

test("does not treat two Bun lockfiles as different managers", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await createLockfile(root, "bun.lock");
  await createLockfile(root, "bun.lockb");

  const result = await detectPackageManager(root);

  assert.equal(result.manager, "bun");
  assert.equal(result.lockfiles.length, 2);
  assert.equal(result.warning, null);
});
