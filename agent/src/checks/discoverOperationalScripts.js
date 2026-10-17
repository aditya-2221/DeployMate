
const OPERATIONAL_SCRIPTS = ["dev", "start"];

export function discoverOperationalScripts(discoveryResult) {
  const operationalScripts = [];

  for (const component of discoveryResult.components) {
    const scripts = component.scripts ?? {};

    for (const scriptName of OPERATIONAL_SCRIPTS) {
      const command = scripts[scriptName];

      if (typeof command === "string" && command.trim().length > 0) {
        operationalScripts.push({
          component: component.path,
          type: scriptName,
          status: "available",
          script: scriptName,
          command,
        });
      } else {
        operationalScripts.push({
          component: component.path,
          type: scriptName,
          status: "unavailable",
          script: null,
          command: null,
        });
      }
    }
  }

  return operationalScripts;
}
