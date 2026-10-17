
import fs from "node:fs/promises";
import path from "node:path";

export async function inspectProject(projectPath) {
  const root = path.resolve(projectPath);

  const stat = await fs.stat(root).catch(() => null);

  if (!stat?.isDirectory()) {
    throw new Error("Project directory does not exist.");
  }

  const packagePath = path.join(root, "package.json");

  let packageJson = null;

  try {
    packageJson = JSON.parse(
      await fs.readFile(packagePath, "utf8")
    );
  } catch {
    // A project without package.json may not be a Node project.
  }

  const exists = async (relativePath) => {
    try {
      await fs.access(path.join(root, relativePath));
      return true;
    } catch {
      return false;
    }
  };

  const scripts = packageJson?.scripts ?? {};

  const findings = [];

  if (!packageJson) {
    findings.push({
      severity: "warning",
      message: "No root package.json was found.",
      evidence: "package.json is absent or invalid."
    });
  }

  if (packageJson && !scripts.build) {
    findings.push({
      severity: "info",
      message: "No root build script was detected.",
      evidence: "package.json scripts.build is absent."
    });
  }

  return {
    projectPath: root,
    inspectedAt: new Date().toISOString(),
    stack: {
      nodeProject: Boolean(packageJson),
      react: Boolean(
        packageJson?.dependencies?.react ||
        packageJson?.devDependencies?.react
      ),
      express: Boolean(
        packageJson?.dependencies?.express ||
        packageJson?.devDependencies?.express
      ),
      vite: Boolean(
        packageJson?.dependencies?.vite ||
        packageJson?.devDependencies?.vite
      ),
      gitRepository: await exists(".git")
    },
    package: packageJson
      ? {
          name: packageJson.name ?? "unnamed",
          scripts
        }
      : null,
    findings
  };
}
