
import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";

export async function discoverWorkspaces(projectPath, packageJson) {
  const root = path.resolve(projectPath);
  const warnings = [];

  let patterns = packageJson?.workspaces;

  // npm and Yarn commonly use an array of workspace patterns.
  // Yarn can also use an object containing a packages array.
  if (
    patterns &&
    typeof patterns === "object" &&
    !Array.isArray(patterns)
  ) {
    patterns = patterns.packages;
  }

  if (patterns === undefined) {
    return { paths: [], warnings };
  }

  if (
    !Array.isArray(patterns) ||
    !patterns.every(
      (pattern) => typeof pattern === "string" && pattern.length > 0
    )
  ) {
    return {
      paths: [],
      warnings: [
        "Workspace configuration must be an array of non-empty patterns.",
      ],
    };
  }

  try {
    const matches = await fg(
      patterns.map((pattern) => pattern.replaceAll("\\", "/")),
      {
        cwd: root,
        onlyDirectories: true,
        onlyFiles: false,
        dot: false,
        followSymbolicLinks: false,
        ignore: ["**/node_modules/**", "**/.git/**"],
        unique: true,
      }
    );

    const paths = [];

    for (const match of matches) {
      const absolutePath = path.resolve(root, match);
      const relativePath = path.relative(root, absolutePath);

      // Reject paths outside the project root.
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        warnings.push(
          `Ignored workspace outside the project root: ${match}`
        );
        continue;
      }

      try {
        const stats = await fs.stat(absolutePath);

        if (stats.isDirectory()) {
          paths.push(relativePath.replaceAll("\\", "/"));
        }
      } catch {
        warnings.push(
          `Could not inspect workspace directory: ${match}`
        );
      }
    }

    return {
      paths: [...new Set(paths)].sort(),
      warnings,
    };
  } catch (error) {
    
    return {
      paths: [],
      warnings: [
        `Could not discover workspaces: ${error.message}`,
      ],
    };
  }
}
