
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { discoverPackages } from "../src/discovery/discoverPackages.js";

async function createTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "deploymate-test-"));
}

async function writePackage(projectRoot, relativePath, content) {
  const filePath = path.join(projectRoot, relativePath);

  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fs.writeFile(filePath, content, "utf8");
}

test("discovers frontend and backend packages", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePackage(
    root,
    "frontend/package.json",
    JSON.stringify({
      name: "frontend",
      dependencies: { react: "^19.0.0", vite: "^7.0.0" },
      scripts: { build: "vite build" },
    })
  );

  await writePackage(
    root,
    "backend/package.json",
    JSON.stringify({
      name: "backend",
      dependencies: { express: "^5.0.0" },
      scripts: { start: "node src/index.js" },
    })
  );

  const result = await discoverPackages(root);

  assert.equal(result.components.length, 2);
  assert.ok(result.components.some((p) => p.path === "frontend"));
  assert.ok(result.components.some((p) => p.path === "backend"));
});

test("reports an empty project", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await discoverPackages(root);

  assert.equal(result.components.length, 0);
  assert.ok(result.warnings.length > 0);
});

test("reports malformed package JSON", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePackage(
    root,
    "frontend/package.json",
    "{ invalid json }"
  );

  const result = await discoverPackages(root);

  assert.equal(result.components.length, 0);
  assert.ok(
    result.warnings.some((warning) =>
      warning.replaceAll("\\", "/").includes("frontend/package.json")
    ),
    "Expected a warning identifying the malformed frontend/package.json"
  );
});

test("rejects a nonexistent project directory", async () => {
  const missingPath = path.join(
    os.tmpdir(),
    `deploymate-missing-${Date.now()}`
  );

  await assert.rejects(
    discoverPackages(missingPath),
    /Project directory does not exist/
  );
});


test("does not warn about a missing root lockfile when components have npm lockfiles", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  for (const component of ["frontend", "backend"]) {
    await writePackage(
      root,
      `${component}/package.json`,
      JSON.stringify({
        name: component,
        dependencies:
          component === "frontend"
            ? { react: "^19.0.0", vite: "^7.0.0" }
            : { express: "^5.0.0" },
      })
    );

    await writePackage(
      root,
      `${component}/package-lock.json`,
      "{}"
    );
  }

  const result = await discoverPackages(root);

  assert.equal(result.packageManager.manager, "unknown");
  assert.ok(
    !result.warnings.some((warning) =>
      warning.includes("No recognized package-manager lockfile found")
    )
  );
  assert.ok(
    result.components.every(
      (component) => component.packageManager.manager === "npm"
    )
  );
});

test("warns when a component has no recognized lockfile", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePackage(
    root,
    "frontend/package.json",
    JSON.stringify({
      name: "frontend",
      dependencies: { react: "^19.0.0", vite: "^7.0.0" },
    })
  );

  const result = await discoverPackages(root);

  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("frontend")
    )
  );
});


test("warns when frontend and backend use different package managers", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePackage(
    root,
    "frontend/package.json",
    JSON.stringify({
      name: "frontend",
      dependencies: { react: "^19.0.0", vite: "^7.0.0" },
    })
  );
  await writePackage(root, "frontend/package-lock.json", "{}");

  await writePackage(
    root,
    "backend/package.json",
    JSON.stringify({
      name: "backend",
      dependencies: { express: "^5.0.0" },
    })
  );
  await writePackage(root, "backend/pnpm-lock.yaml", "");

  const result = await discoverPackages(root);

  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Different package managers detected")
    )
  );
});

test("warns when a component contains conflicting package managers", async (t) => {
  const root = await createTempProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writePackage(
    root,
    "frontend/package.json",
    JSON.stringify({
      name: "frontend",
      dependencies: { react: "^19.0.0", vite: "^7.0.0" },
    })
  );
  await writePackage(root, "frontend/package-lock.json", "{}");
  await writePackage(root, "frontend/pnpm-lock.yaml", "");

  const result = await discoverPackages(root);

  assert.ok(
    result.components.some(
      (component) => component.packageManager.manager === "ambiguous"
    )
  );
  assert.ok(
    result.warnings.some(
      (warning) =>
        warning.includes("frontend") &&
        warning.includes("Multiple package managers")
    )
  );
});

test("discovers packages declared through root workspaces", async (t) => {
  const root = await createTempProject();

  t.after(() =>
    fs.rm(root, { recursive: true, force: true })
  );

  await writePackage(
    root,
    "package.json",
    JSON.stringify({
      name: "monorepo",
      workspaces: ["services/*"],
    })
  );

  await writePackage(
    root,
    "services/dashboard/package.json",
    JSON.stringify({
      name: "dashboard",
      dependencies: {
        react: "^19.0.0",
      },
      scripts: {
        build: "vite build",
      },
    })
  );

  const result = await discoverPackages(root);

  const workspace = result.components.find(
    (component) => component.path === "services/dashboard"
  );

  assert.ok(workspace, "Expected workspace to be discovered");
  assert.equal(workspace.name, "dashboard");
  assert.equal(workspace.type, "frontend");
  assert.equal(
    workspace.packageFile,
    "services/dashboard/package.json"
  );
});

test("does not duplicate directories found as both known components and workspaces", async (t) => {
  const root = await createTempProject();

  t.after(() =>
    fs.rm(root, { recursive: true, force: true })
  );

  await writePackage(
    root,
    "package.json",
    JSON.stringify({
      name: "monorepo",
      workspaces: ["apps/*"],
    })
  );

  await writePackage(
    root,
    "apps/web/package.json",
    JSON.stringify({
      name: "web",
      dependencies: {
        react: "^19.0.0",
      },
    })
  );

  const result = await discoverPackages(root);

  const matchingComponents = result.components.filter(
    (component) => component.path === "apps/web"
  );

  assert.equal(matchingComponents.length, 1);
});