
import fs from "node:fs/promises";
import path from "node:path";

import { detectPackageManager } from "./detectPackageManager.js";
import { discoverWorkspaces } from "./discoverWorkspaces.js";

const COMPONENT_DIRECTORIES = [
  "frontend",
  "backend",
  "client",
  "server",
  "web",
  "api",
  "apps/web",
  "apps/api",
];

async function isDirectory(directoryPath) {
  try {
    const stats = await fs.stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function readPackageJson(packagePath) {
  try {
    const content = await fs.readFile(packagePath, "utf8");
    const parsed = JSON.parse(content);

    if (
      parsed === null ||typeof parsed !== "object" ||Array.isArray(parsed)
    ) {
      return {
        packageJson: null,
        warning: "package.json must contain a JSON object.",
      };
    }

    return { packageJson: parsed, warning: null };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { packageJson: null, warning: null };
    }

    return {
      packageJson: null,
      warning: `Could not read ${packagePath}: ${error.message}`,
    };
  }
}

function classifyComponent(relativePath, packageJson) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  const hasFrontendFramework = [
    "react",
    "vite",
    "next",
    "vue",
    "angular",
    "svelte",
  ].some((name) => name in dependencies);

  const hasBackendFramework = [
    "express",
    "fastify",
    "koa",
    "nestjs",
    "@nestjs/core",
  ].some((name) => name in dependencies);

  if (hasFrontendFramework && !hasBackendFramework) {
    return "frontend";
  }

  if (hasBackendFramework && !hasFrontendFramework) {
    return "backend";
  }

  const directoryName = path.posix.basename(normalizedPath);

  if (["frontend", "client", "web"].includes(directoryName)) {
    return "frontend";
  }

  if (["backend", "server", "api"].includes(directoryName)) {
    return "backend";
  }

  return "unknown";
}

export async function discoverPackages(projectPath) {
  const root = path.resolve(projectPath);

  if (!(await isDirectory(root))) {
    throw new Error(`Project directory does not exist: ${root}`);
  }

  const components = [];
  const warnings = [];

  const packageManager = await detectPackageManager(root);

  

  // First, check for a package at the project root.
  const rootPackagePath = path.join(root, "package.json");
  const rootResult = await readPackageJson(rootPackagePath);
  


  if (rootResult.warning) {
    warnings.push(rootResult.warning);
  }

  const workspaceResult = await discoverWorkspaces(
    root,
    rootResult.packageJson
  );

  warnings.push(...workspaceResult.warnings);

  if (rootResult.packageJson) {
    components.push({
      path: ".",
      type: "root",
      packageFile: "package.json",
      name: rootResult.packageJson.name ?? "unnamed",
      scripts: rootResult.packageJson.scripts ?? {},
      packageJson: rootResult.packageJson,
    });
  }
     
  
  // Combine known component directories with discovered workspaces.
  const workspacePaths = workspaceResult.paths.map((workspacePath) =>
    workspacePath.replaceAll("\\", "/")
  );

  const workspacePathSet = new Set(workspacePaths);

  const componentDirectories = [
    ...new Set([...COMPONENT_DIRECTORIES, ...workspacePaths]),
  ];

  // Inspect each unique component directory.
  for (const relativeDirectory of componentDirectories) {
    const absoluteDirectory = path.join(root, relativeDirectory);

    if (!(await isDirectory(absoluteDirectory))) {
      continue;
    }

    const packageFile = path.join(absoluteDirectory, "package.json");
    const result = await readPackageJson(packageFile);
    const componentPackageManager =
      await detectPackageManager(absoluteDirectory);

    if (componentPackageManager.warning) {
      warnings.push(
        `${relativeDirectory}: ${componentPackageManager.warning}`
      );
    }

    if (result.warning) {
      warnings.push(`${relativeDirectory}: ${result.warning}`);
      continue;
    }

    if (!result.packageJson) {
      if (workspacePathSet.has(relativeDirectory)) {
        warnings.push(
          `${relativeDirectory}: Workspace directory does not contain a package.json.`
        );
      }

      continue;
    }

    components.push({
      path: relativeDirectory,
      type: classifyComponent(relativeDirectory, result.packageJson),
      packageFile: path
        .relative(root, packageFile)
        .replaceAll("\\", "/"),
      name: result.packageJson.name ?? "unnamed",
      scripts: result.packageJson.scripts ?? {},
      packageJson: result.packageJson,
      packageManager: componentPackageManager,
    });
  }

  

  if (components.length === 0) {
    warnings.push(
      "No valid package.json was found at the root or in discovered component directories."
    );
  }

  const detectedManagers = [
    ...new Set(
      components.map((component) => component.packageManager?.manager)
        .filter(
          (manager) =>manager &&manager !== "unknown" &&manager !== "ambiguous"
        )
    ),
  ];

if (detectedManagers.length > 1) {
  warnings.push(
    `Different package managers detected across components: ${detectedManagers.join(", ")}.`
  );
}

  return {
    root,
    components,
    packageManager,
    warnings,
  };
}
