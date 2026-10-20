
const SEVERITIES = Object.freeze(["info", "warning", "error"]);

const EXECUTION_DIAGNOSTICS = Object.freeze({
  failed: {
    code: "CHECK_FAILED",
    severity: "error",
    message: "The check failed.",
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



function matchesCheck(result, check) {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    check === null ||
    typeof check !== "object" ||
    Array.isArray(check)
  ) {
    return false;
  }

  // Component and type must be explicitly identified.
  if (
    !nonEmptyString(result.component) ||
    !nonEmptyString(result.type) ||
    !nonEmptyString(check.component) ||
    !nonEmptyString(check.type)
  ) {
    return false;
  }

  // Script may be null, but it must be explicitly present on both sides.
  const validScript = (value) =>
    value === null || nonEmptyString(value);

  if (
    !Object.hasOwn(result, "script") ||
    !Object.hasOwn(check, "script") ||
    !validScript(result.script) ||
    !validScript(check.script)
  ) {
    return false;
  }

  return (
    result.component === check.component &&
    result.type === check.type &&
    result.script === check.script
  );
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

  
  for (const [index, result] of executionResults.entries()) {
    const isObject =
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result);

    if (!isObject || !nonEmptyString(result.status)) {
      findings.push(
        makeFinding({
          code: "INVALID_EXECUTION_RESULT",
          severity: "warning",
          category: "execution",
          component: getComponentPath(result?.component),
          message:
            "The execution result is malformed or is missing a valid status.",
          evidence: {
            index,
            status: result?.status ?? null,
          },
          recommendation:
            "Inspect the execution result at this index and validate its structure before using it for diagnostics.",
        }),
      );
      continue;
    }

    
    const validScript = (value) => value === null || nonEmptyString(value);

    if (
      !nonEmptyString(result.component) ||
      !nonEmptyString(result.type) ||
      !Object.hasOwn(result, "script") ||
      !validScript(result.script)
    ) {
      findings.push(
        makeFinding({
          code: "INVALID_EXECUTION_RESULT",
          severity: "warning",
          category: "execution",
          component: getComponentPath(result.component),
          message:
            "The execution result is missing valid check identity fields.",
          evidence: {
            index,
            component: result.component ?? null,
            type: result.type ?? null,
            script: result.script ?? null,
          },
          recommendation:
            "Validate the execution result against the execution-result schema before using it for diagnostics.",
        }),
      );
      continue;
    }


    
    const invalidExitCode =
      (result.status === "passed" && result.exitCode !== 0) ||
      (result.status === "failed" &&
        (!Number.isInteger(result.exitCode) || result.exitCode === 0));

    if (invalidExitCode) {
      findings.push(
        makeFinding({
          code: "INVALID_EXECUTION_RESULT",
          severity: "warning",
          category: "execution",
          component: getComponentPath(result.component),
          message:
            "The execution status conflicts with its exit code.",
          evidence: {
            index,
            status: result.status,
            exitCode: result.exitCode ?? null,
          },
          recommendation:
            "Validate the execution result against the execution-result schema before using it for diagnostics.",
        }),
      );
      continue;
    }

    
    const matchingChecks = checks.filter(
      (check) => matchesCheck(result, check),
    );

    if (!matchingChecks.some((check) => check.status === "available")) {
      findings.push(
        makeFinding({
          code: "UNMATCHED_EXECUTION_RESULT",
          severity: "warning",
          category: "execution",
          component: getComponentPath(result.component),
          message:
            "The execution result does not match a discovered available check.",
          evidence: {
            index,
            type: result.type ?? null,
            script: result.script ?? null,
            status: result.status,
            matchingChecks: matchingChecks.length,
            availableMatch: false,
          },
          recommendation:
            "Verify the execution result against check discovery before using it as evidence of a check outcome.",
        }),
      );
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
          evidence: {
            index,
            status: result.status,
          },
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
          index,
          type: result.type ?? null,
          script: result.script ?? null,
          status: result.status,
          exitCode: result.exitCode ?? null,
          error:
            result.error && typeof result.error === "object"
              ? {
                  code: result.error.code ?? null,
                  message: result.error.message ?? null,
                }
              : null,
        },
        message: result.error?.message
          ? `${diagnostic.message} ${result.error.message}`
          : diagnostic.message,
      }),
    );
  }


  
  
  for (const [index, entry] of policyDecisions.entries()) {
    const isEntryObject =
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry);

    if (!isEntryObject) {
      findings.push(
        makeFinding({
          code: "INVALID_POLICY_DECISION",
          severity: "warning",
          category: "policy",
          component: "unknown",
          message:
            "The policy entry is malformed or is missing a valid decision.",
          evidence: {
            index,
            decision: null,
          },
          recommendation:
            "Inspect the policy decision at this index and validate its structure before using it for diagnostics.",
        }),
      );
      continue;
    }

    const check = entry.check;

    const validScript = (value) =>
      value === null || nonEmptyString(value);

    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      !nonEmptyString(check.component) ||
      !nonEmptyString(check.type) ||
      !Object.hasOwn(check, "script") ||
      !validScript(check.script)
    ) {
      findings.push(
        makeFinding({
          code: "INVALID_POLICY_DECISION",
          severity: "warning",
          category: "policy",
          component: getComponentPath(check?.component),
          message:
            "The policy decision is missing valid check identity fields.",
          evidence: {
            index,
            component: check?.component ?? null,
            type: check?.type ?? null,
            script: check?.script ?? null,
          },
          recommendation:
            "Ensure every policy decision references a check with valid component, type, and script identity fields.",
        }),
      );
      continue;
    }

    const decision = entry.decision;

    const isDecisionObject =
      decision !== null &&
      typeof decision === "object" &&
      !Array.isArray(decision);

    if (
      !isDecisionObject ||
      !nonEmptyString(decision.decision)
    ) {
      findings.push(
        makeFinding({
          code: "INVALID_POLICY_DECISION",
          severity: "warning",
          category: "policy",
          component: getComponentPath(check.component),
          message:
            "The policy entry is malformed or is missing a valid decision.",
          evidence: {
            index,
            decision: decision?.decision ?? null,
          },
          recommendation:
            "Inspect the policy decision at this index and validate its structure before using it for diagnostics.",
        }),
      );
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
          component: getComponentPath(check.component),
          message: "The policy decision is not recognized.",
          evidence: {
            index,
            decision: decision.decision,
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
        component: getComponentPath(check.component),
        message: decision.reason || diagnostic.message,
        evidence: {
          index,
          decision: decision.decision,
          code: decision.code ?? null,
          reason: decision.reason ?? null,
          checkType: check.type,
          script: check.script,
          profile: decision.profile ?? null,
        },
      }),
    );
  }

  
  // Detect duplicate outcomes for the same discovered, available check.
  const resultsByCheck = new Map();
  for (const [index, result] of executionResults.entries()) {
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !nonEmptyString(result.component) ||
      !nonEmptyString(result.type) ||
      !Object.hasOwn(result, "script") ||
      !(
        result.script === null ||
        nonEmptyString(result.script)
      ) ||
      !nonEmptyString(result.status)
    ) {
      continue;
    }

    const hasAvailableMatch = checks.some(
      (check) =>
        check?.status === "available" &&
        matchesCheck(result, check),
    );

    if (!hasAvailableMatch) {
      continue;
    }

    const key = JSON.stringify([
      result.component,
      result.type,
      result.script,
    ]);

    if (!resultsByCheck.has(key)) {
      resultsByCheck.set(key, []);
    }

    resultsByCheck.get(key).push({ index, result });
  }


  for (const entries of resultsByCheck.values()) {
    if (entries.length < 2) {
      continue;
    }

    const outcomes = new Set(
      entries.map(({ result }) =>
        JSON.stringify({
          status: result.status,
          exitCode: result.exitCode ?? null,
          error:
            result.error &&
            typeof result.error === "object" &&
            !Array.isArray(result.error)
              ? {
                  code: result.error.code ?? null,
                  message: result.error.message ?? null,
                }
              : result.error ?? null,
        }),
      ),
    );

    const conflicting = outcomes.size > 1;
    const first = entries[0].result;

    findings.push(
      makeFinding({
        code: conflicting
          ? "CONFLICTING_EXECUTION_RESULTS"
          : "DUPLICATE_EXECUTION_RESULT",
        severity: "warning",
        category: "execution",
        component: getComponentPath(first.component),
        message: conflicting
          ? "Multiple execution results for the same check report conflicting outcomes."
          : "Multiple execution results were supplied for the same check.",
        evidence: {
          type: first.type,
          script: first.script,
          indexes: entries.map(({ index }) => index),
          outcomes: entries.map(({ index, result }) => ({
            index,
            status: result.status,
            exitCode: result.exitCode ?? null,
          })),
        },
        recommendation:
          "Inspect the original execution records and establish a single authoritative outcome before using these results for release-readiness decisions.",
      }),
    );
  }

  // A blocked policy decision should not coexist with an execution result
  // for the same check in the same diagnostic input.
  for (const [index, entry] of policyDecisions.entries()) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !entry.check ||
      typeof entry.check !== "object" ||
      !entry.decision ||
      entry.decision.decision !== "blocked"
    ) {
      continue;
    }

    const blockedCheck = entry.check;

    const matchingIndexes = executionResults
      .map((result, resultIndex) => ({ result, resultIndex }))
      .filter(
        ({ result }) =>
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          matchesCheck(result, blockedCheck),
      )
      .map(({ resultIndex }) => resultIndex);

    if (matchingIndexes.length === 0) {
      continue;
    }

    findings.push(
      makeFinding({
        code: "POLICY_EXECUTION_CONFLICT",
        severity: "warning",
        category: "policy",
        component: getComponentPath(blockedCheck.component),
        message:
          "A blocked policy decision and an execution result exist for the same check.",
        evidence: {
          policyIndex: index,
          decision: entry.decision.decision,
          checkType: blockedCheck.type ?? null,
          script: blockedCheck.script ?? null,
          executionIndexes: matchingIndexes,
        },
        recommendation:
          "Reconcile the policy and execution records. A blocked decision should prevent dispatch; do not assume the result proves that the command ran.",
      }),
    );
  }


  return findings;
}
