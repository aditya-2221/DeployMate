
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createStagedWorkspace,
} from "../src/execution/workspace.js";

async function makeProject() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-source-test-")
  );

  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, ".git"));
  await fs.mkdir(path.join(root, "node_modules"));

  await fs.writeFile(
    path.join(root, "package.json"),
    '{"scripts":{"test":"node test.js"}}'
  );

  await fs.writeFile(
    path.join(root, "src", "index.js"),
    "console.log('hello');"
  );

  await fs.writeFile(
    path.join(root, ".env"),
    "SECRET=do-not-copy"
  );

  await fs.writeFile(
    path.join(root, ".git", "config"),
    "repository metadata"
  );

  await fs.writeFile(
    path.join(root, "node_modules", "example.js"),
    "dependency"
  );

  return root;
}

test("stages project files while excluding sensitive/unneeded paths", async () => {
  const sourceRoot = await makeProject();
  let workspace;

  try {
    workspace = await createStagedWorkspace({
      projectRoot: sourceRoot,
    });

    assert.notEqual(workspace.stagedRoot, sourceRoot);

    await fs.access(
      path.join(workspace.stagedRoot, "package.json")
    );

    await fs.access(
      path.join(workspace.stagedRoot, "src", "index.js")
    );

    await assert.rejects(
      fs.access(path.join(workspace.stagedRoot, ".env"))
    );

    await assert.rejects(
      fs.access(path.join(workspace.stagedRoot, ".git"))
    );

    await assert.rejects(
      fs.access(
        path.join(workspace.stagedRoot, "node_modules")
      )
    );
  } finally {
    if (workspace) {
      await workspace.cleanup();
    }

    await fs.rm(sourceRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("rejects a non-directory project root", async () => {
  const filePath = path.join(
    os.tmpdir(),
    `deploymate-not-directory-${Date.now()}.txt`
  );

  await fs.writeFile(filePath, "not a directory");

  try {
    await assert.rejects(
      createStagedWorkspace({
        projectRoot: filePath,
      }),
      /must point to a directory/
    );
  } finally {
    await fs.rm(filePath, { force: true });
  }
});

test("rejects invalid staging limits", async () => {
  const sourceRoot = await makeProject();

  try {
    await assert.rejects(
      createStagedWorkspace({
        projectRoot: sourceRoot,
        maxFiles: 0,
      }),
      /maxFiles/
    );
  } finally {
    await fs.rm(sourceRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("enforces the file-count limit and cleans up on failure", async () => {
  const sourceRoot = await makeProject();

  try {
    await assert.rejects(
      createStagedWorkspace({
        projectRoot: sourceRoot,
        maxFiles: 1,
      }),
      /file limit/
    );
  } finally {
    await fs.rm(sourceRoot, {
      recursive: true,
      force: true,
    });
  }
});
