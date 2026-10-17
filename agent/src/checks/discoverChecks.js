
const CHECK_TYPES = {
  lint: ["lint", "lint:check", "eslint"],
  test: ["test", "test:unit", "test:ci"],
  build: ["build", "build:prod"],
  typecheck: ["typecheck", "type-check", "check:types"],
};

export function discoverChecks(discoveryResult) {
  const checks = [];

  for (const component of discoveryResult.components) {
    const scripts = component.scripts ?? {};

    for (const [type, candidates] of Object.entries(CHECK_TYPES)) {
      const matchingScripts = candidates.filter(
        (scriptName) =>
          typeof scripts[scriptName] === "string" &&
          scripts[scriptName].trim().length > 0
      );

      if (matchingScripts.length === 0) {
        checks.push({
          component: component.path,
          type,
          status: "unavailable",
          script: null,
          command: null,
        });

        continue;
      }

      for (const script of matchingScripts) {
        checks.push({
          component: component.path,
          type,
          status: "available",
          script,
          command: scripts[script],
        });
      }
    }
  }

  return checks;
}
