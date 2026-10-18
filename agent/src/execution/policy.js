
import { z } from "zod";

export const EXECUTION_PROFILES = Object.freeze([
  "restricted",
  "standard",
  "custom",
]);

export const POLICY_DECISIONS = Object.freeze([
  "allowed",
  "requires_approval",
  "blocked",
]);

const CHECK_TYPES = ["lint", "test", "build", "typecheck"];
const OPERATIONAL_TYPES = ["dev", "start"];
const SUPPORTED_TYPES = [...CHECK_TYPES, ...OPERATIONAL_TYPES];

const resourceLimitsSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(600_000),
    maxOutputBytes: z.number().int().min(1_024).max(10_485_760),
    memoryMb: z.number().int().min(128).max(8_192),
    cpuCount: z.number().min(0.25).max(8),
    processLimit: z.number().int().min(1).max(1_024),
  })
  .strict();

export const executionPolicySchema = z
  .object({
    profile: z.enum(EXECUTION_PROFILES).default("restricted"),
    trustedProject: z.boolean().default(false),
    allowedCheckTypes: z.array(z.enum(CHECK_TYPES)).default([
      "lint",
      "test",
      "build",
      "typecheck",
    ]),
    networkAccess: z.enum(["disabled", "dependency_install", "allowlist"]).default("disabled"),
    networkAllowlist: z.array(z.string().url()).default([]),
    allowSecrets: z.boolean().default(false),
    limits: resourceLimitsSchema.default({
      timeoutMs: 120_000,
      maxOutputBytes: 1_048_576,
      memoryMb: 1_024,
      cpuCount: 1,
      processLimit: 128,
    }),
  })
  .strict();

const checkSchema = z
  .object({
    component: z.string().trim().min(1),
    type: z.string().trim().min(1),
    status: z.string().trim().min(1),
    script: z.string().trim().min(1),
    command: z.string().trim().min(1),
  })
  .passthrough();

const requestedCapabilitiesSchema = z
  .object({
    networkAccess: z.boolean().default(false),
    networkPurpose: z.enum(["dependency_install", "check"]).default("check"),
    networkTargets: z.array(z.string().url()).default([]),
    secrets: z.boolean().default(false),
  })
  .strict();

export function createExecutionPolicy(input = {}) {
  return executionPolicySchema.parse(input);
}

function makeDecision(policy, decision, code, reason) {
  return {
    decision,
    code,
    reason,
    profile: policy.profile,
    limits: { ...policy.limits },
    permissions: {
      networkAccess: policy.networkAccess,
      allowSecrets: policy.allowSecrets,
    },
  };
}

/**
 * Evaluates authorization only. It never executes a command.
 *
 * approvalGranted must come from a trusted authorization flow.
 * Do not accept it directly from untrusted repository files.
 */


function evaluateNetworkAccess(policy, capabilities) {
  if (!capabilities.networkAccess) {
    return null;
  }

  if (policy.networkAccess === "disabled") {
    return {
      code: "NETWORK_ACCESS_DENIED",
      reason: "The policy does not permit network access for this execution.",
    };
  }

  if (
    policy.networkAccess === "dependency_install" &&
    capabilities.networkPurpose !== "dependency_install"
  ) {
    return {
      code: "NETWORK_PURPOSE_DENIED",
      reason:
        "Network access under this policy is limited to dependency installation.",
    };
  }

  if (capabilities.networkTargets.length === 0) {
    return {
      code: "NETWORK_TARGET_REQUIRED",
      reason: "Network access requires explicitly requested destinations.",
    };
  }

  const allowedOrigins = new Set(
    policy.networkAllowlist.map((value) => new URL(value).origin),
  );

  const targetsAllowed = capabilities.networkTargets.every((target) => {
    try {
      return allowedOrigins.has(new URL(target).origin);
    } catch {
      return false;
    }
  });

  if (!targetsAllowed) {
    return {
      code: "NETWORK_TARGET_DENIED",
      reason:
        "One or more requested destinations are not in the network allowlist.",
    };
  }

  return null;
}



export function evaluateExecutionPolicy({
  check,
  policy: policyInput = {},
  approvalGranted = false,
  requestedCapabilities: requestedInput = {},
} = {}) {
  const policy = createExecutionPolicy(policyInput);
  const capabilities =requestedCapabilitiesSchema.parse(requestedInput);

  if (typeof approvalGranted !== "boolean") {
    throw new TypeError("approvalGranted must be a boolean.");
  }

  const parsedCheck = checkSchema.safeParse(check);

  if (!parsedCheck.success) {
    return makeDecision(
      policy,
      "blocked",
      "INVALID_CHECK",
      "The check is missing required fields or contains invalid values.",
    );
  }

  const candidate = parsedCheck.data;

  if (candidate.status !== "available") {
    return makeDecision(
      policy,
      "blocked",
      "CHECK_UNAVAILABLE",
      "Only discovered checks marked available can be considered for execution.",
    );
  }

  if (!SUPPORTED_TYPES.includes(candidate.type)) {
    return makeDecision(
      policy,
      "blocked",
      "UNSUPPORTED_CHECK_TYPE",
      "This check type is not supported by the execution policy.",
    );
  }

 
    const networkDenial = evaluateNetworkAccess(policy, capabilities);

    if (networkDenial) {
        return makeDecision(
            policy,
            "blocked",
            networkDenial.code,
            networkDenial.reason,
        );
    }


  if (capabilities.secrets && !policy.allowSecrets) {
    return makeDecision(
      policy,
      "blocked",
      "SECRET_ACCESS_DENIED",
      "The policy does not permit secrets in this execution environment.",
    );
  }

  const isOperational = OPERATIONAL_TYPES.includes(candidate.type);
  const checkTypeAllowed =CHECK_TYPES.includes(candidate.type) && policy.allowedCheckTypes.includes(candidate.type);

  if (!isOperational && !checkTypeAllowed) {
    return makeDecision(
      policy,
      "blocked",
      "CHECK_TYPE_NOT_ALLOWED",
      "This check type is not included in the policy allowlist.",
    );
  }

  // Explicit approval can authorize a supported operation, but cannot
  // override unsupported types or denied capabilities.
  if (approvalGranted) {
    return makeDecision(
      policy,
      "allowed",
      "APPROVED",
      "The operation is supported and explicit approval was provided.",
    );
  }

  if (isOperational) {
    return makeDecision(
      policy,
      "requires_approval",
      "OPERATIONAL_SCRIPT_REQUIRES_APPROVAL",
      "Development and start scripts require explicit approval.",
    );
  }

  if (policy.profile === "restricted") {
    return makeDecision(
      policy,
      "requires_approval",
      "RESTRICTED_PROFILE_REQUIRES_APPROVAL",
      "The restricted profile requires approval before running checks.",
    );
  }

  if (!policy.trustedProject) {
    return makeDecision(
      policy,
      "requires_approval",
      "PROJECT_NOT_TRUSTED",
      "Automatic execution is disabled for projects not marked trusted.",
    );
  }

  return makeDecision(
    policy,
    "allowed",
    "TRUSTED_CHECK_ALLOWED",
    "This supported check is allowed by the configured policy.",
  );
}
