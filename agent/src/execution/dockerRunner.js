
import fs from "node:fs/promises";
import path from "node:path";

import { detectPackageManager } from "../discovery/detectPackageManager.js";

const SUPPORTED_CHECK_TYPES = new Set([
  "lint",
  "test",
  "build",
  "typecheck",
]);

const SCRIPT_CANDIDATES = Object.freeze({
  lint: ["lint", "lint:check", "eslint"],
  test: ["test", "test:unit", "test:ci"],
  build: ["build", "build:prod"],
  typecheck: ["typecheck", "type-check", "check:types"],
});

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

/**
 * Resolve the package manager from the nearest directory containing
 * a recognized lockfile, without searching outside the project root.
 *
 * A conflicting or unknown manager is never silently guessed.
 */
async function resolvePackageManager(componentPath, projectRoot) {
  let current = componentPath;

  while (isInsideRoot(projectRoot, current)) {
    const detection = await detectPackageManager(current);

    if (detection.manager === "ambiguous") {
      throw new Error(
        `Conflicting package-manager lockfiles in ${current}.`
      );
    }

    if (detection.manager !== "unknown") {
      return {
        manager: detection.manager,
        lockfiles: detection.lockfiles,
        lockfileDirectory: current,
      };
    }

    if (current === projectRoot) {
      break;
    }

    const parent = path.dirname(current);

    if (parent === current || !isInsideRoot(projectRoot, parent)) {
      break;
    }

    current = parent;
  }

  throw new Error(
    "No recognized package-manager lockfile exists between the component and project root."
  );
}

/**
 * Validate a discovered check before execution.
 *
 * This function does not execute project code and is not itself
 * a sandbox or a complete security boundary.
 */
export async function validateDockerCheck({
  projectRoot,
  check,
} = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) {
    throw new TypeError("projectRoot must be a non-empty path.");
  }

  if (
    !check ||
    typeof check !== "object" ||
    Array.isArray(check)
  ) {
    throw new TypeError("check must be an object.");
  }

  if (check.status !== "available") {
    throw new Error("Cannot execute a check that is not available.");
  }

  if (!SUPPORTED_CHECK_TYPES.has(check.type)) {
    throw new Error(`Unsupported check type: ${check.type}`);
  }

  if (
    typeof check.component !== "string" ||
    !check.component.trim() ||
    path.isAbsolute(check.component)
  ) {
    throw new Error(
      "Check must specify a relative component path."
    );
  }

  if (
    typeof check.script !== "string" ||
    !SCRIPT_CANDIDATES[check.type].includes(check.script)
  ) {
    throw new Error(
      "The script is not an approved candidate for this check type."
    );
  }

  if (
    typeof check.command !== "string" ||
    !check.command.trim()
  ) {
    throw new Error("Check must specify a command.");
  }

  const root = await fs.realpath(path.resolve(projectRoot));
  const componentPath = path.resolve(root, check.component);

  if (!isInsideRoot(root, componentPath)) {
    throw new Error("Component path escapes the project root.");
  }

  let realComponentPath;

  try {
    realComponentPath = await fs.realpath(componentPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Component directory does not exist.");
    }

    throw error;
  }

  if (!isInsideRoot(root, realComponentPath)) {
    throw new Error(
      "Component resolves outside the project root."
    );
  }

  const packageFile = path.join(
    realComponentPath,
    "package.json"
  );

  let packageJson;

  try {
    packageJson = JSON.parse(
      await fs.readFile(packageFile, "utf8")
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Component package.json does not exist.");
    }

    if (error instanceof SyntaxError) {
      throw new Error("Component package.json is invalid JSON.");
    }

    throw error;
  }

  if (
    !packageJson ||
    typeof packageJson !== "object" ||
    Array.isArray(packageJson) ||
    !packageJson.scripts ||
    typeof packageJson.scripts !== "object" ||
    Array.isArray(packageJson.scripts)
  ) {
    throw new Error("package.json has no valid scripts object.");
  }

  const currentCommand = packageJson.scripts[check.script];

  if (
    typeof currentCommand !== "string" ||
    currentCommand !== check.command
  ) {
    throw new Error(
      "The discovered command does not match the current package.json script."
    );
  }

  const packageManagerInfo = await resolvePackageManager(
    realComponentPath,
    root
  );

  return {
    projectRoot: root,
    componentPath: realComponentPath,
    componentRelativePath: path.relative(
      root,
      realComponentPath
    ) || ".",
    packageManager: packageManagerInfo.manager,
    lockfiles: packageManagerInfo.lockfiles,
    lockfileDirectory: packageManagerInfo.lockfileDirectory,
    script: check.script,
    command: currentCommand,
    type: check.type,
  };
}
