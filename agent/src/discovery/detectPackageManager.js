
import fs from "node:fs/promises";
import path from "node:path";

const LOCKFILES = {
  "package-lock.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

export async function detectPackageManager(projectPath) {
  const root = path.resolve(projectPath);
  const foundLockfiles = [];

  for (const [filename, manager] of Object.entries(LOCKFILES)) {
    const filePath = path.join(root, filename);

    try {
      const stats = await fs.stat(filePath);

      if (stats.isFile()) {
        foundLockfiles.push({
          filename,
          manager,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const managers = [...new Set(
    foundLockfiles.map((file) => file.manager)
  )];

  if (foundLockfiles.length === 0) {
    return {
      manager: "unknown",
      lockfiles: [],
      warning: "No recognized package-manager lockfile found.",
    };
  }

  if (managers.length > 1) {
    return {
      manager: "ambiguous",
      lockfiles: foundLockfiles,
      warning:
        "Multiple package managers were detected. Review the lockfiles before choosing one.",
    };
  }

  return {
    manager: managers[0],
    lockfiles: foundLockfiles,
    warning: null,
  };
}
