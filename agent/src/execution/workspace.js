
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".deploymate",
  ".next",
  "coverage",
]);

const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;

function isSensitiveFilename(name) {
  const lower = name.toLowerCase();

  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower.endsWith(".p12") ||
    lower.endsWith(".pfx") ||
    lower === "id_rsa" ||
    lower === "id_ed25519"
  );
}

function isExcludedDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name);
}

/**
 * Copy a project into a disposable workspace.
 *
 * Symlinks and special filesystem entries are skipped rather
 * than followed. Limits prevent unexpectedly large copies.
 */
export async function createStagedWorkspace({
  projectRoot,
  maxFiles = DEFAULT_MAX_FILES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (
    typeof projectRoot !== "string" ||
    !projectRoot.trim()
  ) {
    throw new TypeError(
      "projectRoot must be a non-empty path."
    );
  }

  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new TypeError("maxFiles must be a positive integer.");
  }

  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive integer.");
  }

  const sourceRoot = await fs.realpath(
    path.resolve(projectRoot)
  );

  const sourceStats = await fs.stat(sourceRoot);

  if (!sourceStats.isDirectory()) {
    throw new Error("projectRoot must point to a directory.");
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "deploymate-workspace-")
  );

  let fileCount = 0;
  let totalBytes = 0;

  async function copyDirectory(source, destination) {
    const entries = await fs.readdir(source, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(
        destination,
        entry.name
      );

      // Never copy common secret files or secret key material.
      if (isSensitiveFilename(entry.name)) {
        continue;
      }

      // Skip dependency directories and repository metadata.
      if (
        entry.isDirectory() &&
        isExcludedDirectory(entry.name)
      ) {
        continue;
      }

      /*
       * Dirent symlinks are intentionally not followed.
       * This avoids copying files from outside the project root.
       */
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        await fs.mkdir(destinationPath, {
          recursive: true,
          mode: 0o700,
        });

        await copyDirectory(sourcePath, destinationPath);
        continue;
      }

      if (!entry.isFile()) {
        // Skip sockets, devices, FIFOs and other special entries.
        continue;
      }

      const stats = await fs.stat(sourcePath);

      fileCount += 1;
      totalBytes += stats.size;

      if (fileCount > maxFiles) {
        throw new Error(
          `Workspace exceeds the ${maxFiles}-file limit.`
        );
      }

      if (totalBytes > maxBytes) {
        throw new Error(
          `Workspace exceeds the ${maxBytes}-byte limit.`
        );
      }

      await fs.copyFile(sourcePath, destinationPath);

      // The copy is for inspection/build/test, not deployment
      // with preserved executable permissions.
      await fs.chmod(destinationPath, 0o600);
    }
  }

  try {
    await copyDirectory(sourceRoot, temporaryRoot);

    return {
      stagedRoot: temporaryRoot,
      sourceRoot,
      fileCount,
      totalBytes,

      async cleanup() {
        await fs.rm(temporaryRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      },
    };
  } catch (error) {
    // Best-effort cleanup if staging fails partway through.
    await fs.rm(temporaryRoot, {
      recursive: true,
      force: true,
    }).catch(() => {});

    throw error;
  }
}
