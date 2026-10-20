
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { constants as fsConstants } from "node:fs";

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
  tempDirectory = os.tmpdir(),
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

  if (typeof tempDirectory !== "string" ||!tempDirectory.trim()) {
    throw new TypeError(
      "tempDirectory must be a non-empty path.",
    );
  }

  const sourceRoot = await fs.realpath(
    path.resolve(projectRoot)
  );

  const sourceStats = await fs.stat(sourceRoot);

  if (!sourceStats.isDirectory()) {
    throw new Error("projectRoot must point to a directory.");
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(
      path.resolve(tempDirectory),
      "deploymate-workspace-",
    ),
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
        entry.name,
      );

      // Never copy common secret files or private-key material.
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

      // Never intentionally follow symlinks.
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

      let sourceHandle;
      let destinationHandle;
      let operationError;

      try {
        // O_NOFOLLOW prevents opening a final-component symlink
        // on platforms that support this flag.
        const noFollowFlag = fsConstants.O_NOFOLLOW ?? 0;

        sourceHandle = await fs.open(
          sourcePath,
          fsConstants.O_RDONLY | noFollowFlag,
        );

        const stats = await sourceHandle.stat();

        if (!stats.isFile()) {
          continue;
        }

        // Check whether the source path was replaced after readdir
        // or while the file was being opened.
        const currentStats = await fs.lstat(sourcePath);

        if (
          currentStats.isSymbolicLink() ||
          !currentStats.isFile() ||
          currentStats.dev !== stats.dev ||
          currentStats.ino !== stats.ino
        ) {
          throw new Error(
            `Source file changed during staging: ${entry.name}`,
          );
        }

        // Reject files exceeding the remaining byte budget.
        if (stats.size > maxBytes - totalBytes) {
          throw new Error(
            `Workspace exceeds the ${maxBytes}-byte limit.`,
          );
        }

        if (fileCount >= maxFiles) {
          throw new Error(
            `Workspace exceeds the ${maxFiles}-file limit.`,
          );
        }

        // "wx" prevents overwriting an existing staged file.
        // The staged copy is readable/writable only by its owner.
        destinationHandle = await fs.open(
          destinationPath,
          "wx",
          0o600,
        );

        const buffer = Buffer.alloc(64 * 1024);
        let copiedBytes = 0;

        while (true) {
          const { bytesRead } = await sourceHandle.read(
            buffer,
            0,
            buffer.length,
            null,
          );

          if (bytesRead === 0) {
            break;
          }

          // Enforce the limit on actual bytes read, in case the
          // source grows after its initial size was checked.
          if (
            bytesRead >
            maxBytes - totalBytes - copiedBytes
          ) {
            throw new Error(
              `Workspace exceeds the ${maxBytes}-byte limit.`,
            );
          }

          let offset = 0;

          // Handle partial writes rather than assuming the whole
          // buffer is written in a single operation.
          while (offset < bytesRead) {
            const { bytesWritten } =
              await destinationHandle.write(
                buffer,
                offset,
                bytesRead - offset,
              );

            if (bytesWritten === 0) {
              throw new Error(
                "Could not finish writing staged file.",
              );
            }

            offset += bytesWritten;
          }

          copiedBytes += bytesRead;
        }

        
        // Verify that the source remained stable during copying.
        const finalStats = await sourceHandle.stat();

        if (
          copiedBytes !== stats.size ||
          finalStats.size !== stats.size ||
          finalStats.mtimeMs !== stats.mtimeMs ||
          finalStats.ctimeMs !== stats.ctimeMs
        ) {
          throw new Error(
            `Source file changed during staging: ${entry.name}`,
          );
        }

        // Account for the file only after verification succeeds.
        fileCount += 1;
        totalBytes += copiedBytes;


      } 

      catch (error) {
        operationError = error;
        throw error;

      } 
      finally {
        let closeError;

        try {
          await destinationHandle?.close();
        } catch (error) {
          closeError = error;
        }

        try {
          await sourceHandle?.close();
        } catch (error) {
          closeError ??= error;
        }

        // Preserve the original operation error if copying already failed.
        if (closeError && !operationError) {
          throw closeError;
        }
      }
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
  
    } 
    catch (error) {
      // Attempt cleanup after a partial staging failure.
      try {
        await fs.rm(temporaryRoot, {
          recursive: true,
          force: true,
        });
      } catch (cleanupError) {
        // Preserve the original staging error while exposing
        // the cleanup failure as additional structured information.
        throw new AggregateError(
          [error, cleanupError],
          `Workspace staging failed: ${error.message}. ` +
            `Workspace cleanup also failed: ${cleanupError.message}`,
          { cause: error },
        );
      }

      throw error;
    }

}
