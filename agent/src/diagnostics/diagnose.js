
const SEVERITIES = Object.freeze(["info", "warning", "error"]);

const EXECUTION_DIAGNOSTICS = Object.freeze({
  failed: {
    code: "CHECK_FAILED",
    severity: "error",
    message: "The check completed with a non-zero exit code.",
    recommendation: "Review the check output and fix the reported issue.",
  },
  timed_out: {
    code: "CHECK_TIMED_OUT",
    severity: "warning",
    message: "The check exceeded its execution time limit.",
    recommendation:
      "Inspect the output and determine whether the check needs optimization or a different timeout.",
  },
  blocked: {
    code: "CHECK_BLOCKED",
    severity: "warning",
    message: "The check was blocked before successful execution.",
    recommendation:
      "Review the associated policy decision or execution error.",
  },
  skipped: {
    code: "CHECK_SKIPPED",
    severity: "info",
    message: "The check was skipped.",
    recommendation: "Run the check if its result is needed for release readiness.",
  },
  not_run: {
    code: "CHECK_NOT_RUN",
    severity: "warning",
    message: "No verified execution outcome is available for this check.",
    recommendation:
      "Inspect the execution error and run the check when its prerequisites are satisfied.",
  },
});

const POLICY_DIAGNOSTICS = Object.freeze({
  requires_approval: {
    code: "POLICY_APPROVAL_REQUIRED",
    severity: "warning",
    message: "Execution requires explicit approval.",
    recommendation:
      "Review the requested operation and approve it through the authorized approval flow if appropriate.",
  },
  blocked: {
    code: "POLICY_BLOCKED",
    severity: "warning",
    message: "Execution was denied by the configured policy.",
    recommendation:
      "Review the policy decision and its reason. Do not bypass the policy.",
  },
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getComponentPath(value) {
  return nonEmptyString(value) ? value : "unknown";
}

function makeFinding({
  code,
  severity,
  category,
  component = "unknown",
  message,
  evidence = {},
  recommendation,
}) {
  if (!SEVERITIES.includes(severity)) {
    throw new TypeError(`Unsupported diagnostic severity: ${severity}`);
  }

  return {
    code,
    severity,
    category,
    component,
    message,
    evidence,
    recommendation,
  };
}

/**
 * Derives deterministic findings from discovery, execution, and policy
 * evidence. This function never executes commands or modifies a project.
 *
 * Policy entry format:
 * { check: { component, type, script }, decision: { decision, code, reason } }
 */
export function diagnose({
  discoveryResult,
  checks = [],
  executionResults = [],
  policyDecisions = [],
} = {}) {
  if (
    !discoveryResult ||
    typeof discoveryResult !== "object" ||
    !Array.isArray(discoveryResult.components) ||
    !Array.isArray(discoveryResult.warnings)
  ) {
    throw new TypeError(
      "discoveryResult must contain components and warnings arrays.",
    );
  }

  for (const [name, entries] of [
    ["checks", checks],
    ["executionResults", executionResults],
    ["policyDecisions", policyDecisions],
  ]) {
    if (!Array.isArray(entries)) {
      throw new TypeError(`${name} must be an array.`);
    }
  }

  const findings = [];

  // Preserve discovery messages as evidence rather than rewriting them.
  for (const warning of discoveryResult.warnings) {
    if (!nonEmptyString(warning)) {
      continue;
    }

    findings.push(
      makeFinding({
        code: "DISCOVERY_WARNING",
        severity: "warning",
        category: "discovery",
        message: warning,
        evidence: { warning },
        recommendation:
          "Review the discovery warning and confirm whether it affects the intended project scope.",
      }),
    );
  }

  // Missing scripts are informational, not automatically defects.
  for (const check of checks) {
    if (!check || typeof check !== "object") {
      continue;
    }

    if (check.status !== "unavailable") {
      continue;
    }

    findings.push(
      makeFinding({
        code: "CHECK_UNAVAILABLE",
        severity: "info",
        category: "configuration",
        component: getComponentPath(check.component),
        message: `No recognized ${nonEmptyString(check.type) ? check.type : "check"} script was discovered.`,
        evidence: {
          type: check.type ?? null,
          status: check.status,
        },
        recommendation:
          "Confirm whether this check is required for the component. Add a script only if it matches the project's needs.",
      }),
    );
  }

  for (const result of executionResults) {
    if (!result || typeof result !== "object") {
      continue;
    }

    if (result.status === "passed") {
      continue;
    }

    const diagnostic = EXECUTION_DIAGNOSTICS[result.status];

    if (!diagnostic) {
      findings.push(
        makeFinding({
          code: "UNKNOWN_EXECUTION_STATUS",
          severity: "warning",
          category: "execution",
          component: getComponentPath(result.component),
          message: "The execution result contains an unrecognized status.",
          evidence: { status: result.status ?? null },
          recommendation:
            "Validate the execution result against the supported result schema.",
        }),
      );
      continue;
    }

    findings.push(
      makeFinding({
        ...diagnostic,
        category: "execution",
        component: getComponentPath(result.component),
        evidence: {
          type: result.type ?? null,
          script: result.script ?? null,
          status: result.status,
          exitCode: result.exitCode ?? null,
          error: result.error
            ? {
                code: result.error.code ?? null,
                message: result.error.message ?? null,
              }
            : null,
        },
        // Preserve the underlying execution error for diagnosis.
        message: result.error?.message
          ? `${diagnostic.message} ${result.error.message}`
          : diagnostic.message,
      }),
    );
  }

  for (const entry of policyDecisions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const decision = entry.decision;

    if (!decision || typeof decision !== "object") {
      continue;
    }

    if (decision.decision === "allowed") {
      continue;
    }

    const diagnostic = POLICY_DIAGNOSTICS[decision.decision];

    if (!diagnostic) {
      findings.push(
        makeFinding({
          code: "UNKNOWN_POLICY_DECISION",
          severity: "warning",
          category: "policy",
          component: getComponentPath(entry.check?.component),
          message: "The policy decision is not recognized.",
          evidence: {
            decision: decision.decision ?? null,
            code: decision.code ?? null,
          },
          recommendation:
            "Validate the policy decision against the supported policy schema.",
        }),
      );
      continue;
    }

    findings.push(
      makeFinding({
        ...diagnostic,
        category: "policy",
        component: getComponentPath(entry.check?.component),
        message: decision.reason || diagnostic.message,
        evidence: {
          decision: decision.decision,
          code: decision.code ?? null,
          reason: decision.reason ?? null,
          checkType: entry.check?.type ?? null,
          script: entry.check?.script ?? null,
          profile: decision.profile ?? null,
        },
      }),
    );
  }

  return findings;
}
