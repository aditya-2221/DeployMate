
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


test("enforces the file-count limit and cleans up on failure",async () => {
    const sourceRoot = await makeProject();

    const stagingParent = await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "deploymate-cleanup-test-",
      ),
    );

    try {
      await assert.rejects(
        createStagedWorkspace({
          projectRoot: sourceRoot,
          maxFiles: 1,
          tempDirectory: stagingParent,
        }),
        /file limit/,
      );

      // The failed staging attempt must leave no
      // temporary workspace inside our isolated parent.
      assert.deepEqual(
        await fs.readdir(stagingParent),
        [],
        "Failed staging must remove its partial workspace.",
      );
    } finally {
      await fs.rm(stagingParent, {
        recursive: true,
        force: true,
      });

      await fs.rm(sourceRoot, {
        recursive: true,
        force: true,
      });
    }
  },
);


test("excludes secret environment and private-key files at every depth", async () => {
  const sourceRoot = await makeProject();
  let workspace;

  const secretPaths = [
    ".env.local",
    ".ENV",
    "credentials.pem",
    "private.key",
    "certificate.p12",
    "certificate.pfx",
    "id_rsa",
    "id_ed25519",
    path.join("config", ".env.production"),
    path.join("config", "nested", "private.key"),
  ];

  try {
    for (const relativePath of secretPaths) {
      const sourcePath = path.join(sourceRoot, relativePath);

      await fs.mkdir(path.dirname(sourcePath), {
        recursive: true,
      });

      await fs.writeFile(
        sourcePath,
        "TEST_SECRET_DO_NOT_STAGE",
      );
    }

    workspace = await createStagedWorkspace({
      projectRoot: sourceRoot,
    });

    for (const relativePath of secretPaths) {
      await assert.rejects(
        fs.access(
          path.join(workspace.stagedRoot, relativePath),
        ),
        {
          code: "ENOENT",
        },
        `Expected sensitive file to be excluded: ${relativePath}`,
      );
    }

    // Ordinary project files must still be staged.
    await fs.access(
      path.join(workspace.stagedRoot, "package.json"),
    );

    await fs.access(
      path.join(workspace.stagedRoot, "src", "index.js"),
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


test("removes the staged workspace when cleanup is called",async () => {
    const sourceRoot = await makeProject();

    const stagingParent = await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "deploymate-cleanup-success-test-",
      ),
    );

    let workspace;

    try {
      workspace = await createStagedWorkspace({
        projectRoot: sourceRoot,
        tempDirectory: stagingParent,
      });

      const stagedRoot = workspace.stagedRoot;

      // Confirm the staged workspace exists.
      await fs.access(stagedRoot);

      await workspace.cleanup();

      // Confirm cleanup removed the actual directory.
      await assert.rejects(
        fs.access(stagedRoot),
        { code: "ENOENT" },
      );

      // The isolated parent should now be empty.
      assert.deepEqual(
        await fs.readdir(stagingParent),
        [],
      );
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }

      await fs.rm(stagingParent, {
        recursive: true,
        force: true,
      });

      await fs.rm(sourceRoot, {
        recursive: true,
        force: true,
      });
    }
  },
);


test("does not stage a symlink to a file outside the project", async (t) => {
  const sourceRoot = await makeProject();

  const outsideRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-outside-test-"),
  );

  let workspace;

  try {
    const outsideFile = path.join(
      outsideRoot,
      "private.txt",
    );

    await fs.writeFile(outsideFile, "outside content");

    const linkPath = path.join(
      sourceRoot,
      "external-link.txt",
    );

    try {
      await fs.symlink(outsideFile, linkPath, "file");
    } catch (error) {
      if (
        process.platform === "win32" &&
        ["EPERM", "EACCES"].includes(error.code)
      ) {
        t.skip(
          "Windows does not permit symlink creation; enable Developer Mode to run this test.",
        );
        return;
      }

      throw error;
    }

    workspace = await createStagedWorkspace({
      projectRoot: sourceRoot,
    });

    await assert.rejects(
      fs.access(
        path.join(
          workspace.stagedRoot,
          "external-link.txt",
        ),
      ),
      { code: "ENOENT" },
    );
  } finally {
    if (workspace) {
      await workspace.cleanup();
    }

    await fs.rm(sourceRoot, {
      recursive: true,
      force: true,
    });

    await fs.rm(outsideRoot, {
      recursive: true,
      force: true,
    });
  }
});

test("rejects a source file changed during staging and cleans up", async () => {
  const sourceRoot = await makeProject();

  const stagingParent = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-race-test-"),
  );

  const changingFile = path.join(sourceRoot, "changing.txt");

  await fs.writeFile(changingFile, "original");

  const originalOpen = fs.open;
  let mutationInjected = false;

  try {
    // Intercept opening only the file used by this test.
    fs.open = async (filePath, ...args) => {
      const handle = await originalOpen(filePath, ...args);

      if (path.resolve(String(filePath)) !== changingFile) {
        return handle;
      }

      // Wrap the source handle so the change happens after
      // the initial file metadata checks, immediately before
      // the first read.
      return new Proxy(handle, {
        get(target, property) {
          if (property === "read") {
            return async (...readArgs) => {
              if (!mutationInjected) {
                mutationInjected = true;

                await fs.writeFile(
                  changingFile,
                  "source content changed during staging",
                );
              }

              return target.read(...readArgs);
            };
          }

          const value = Reflect.get(target, property, target);

          return typeof value === "function"
            ? value.bind(target)
            : value;
        },
      });
    };

    await assert.rejects(
      createStagedWorkspace({
        projectRoot: sourceRoot,
        tempDirectory: stagingParent,
      }),
      /Source file changed during staging/,
    );

    assert.equal(
      mutationInjected,
      true,
      "The test must actually modify the source during copying.",
    );

    assert.deepEqual(
      await fs.readdir(stagingParent),
      [],
      "Failed staging must remove its temporary workspace.",
    );
  } finally {
    // Always restore the shared filesystem function.
    fs.open = originalOpen;

    await fs.rm(stagingParent, {
      recursive: true,
      force: true,
    });

    await fs.rm(sourceRoot, {
      recursive: true,
      force: true,
    });
  }
});

