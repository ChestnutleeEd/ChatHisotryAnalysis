import {
  WorkerClientCancelledError,
  WorkerClientError,
} from "../worker-analysis/worker-client";

const KNOWN_ANALYTICS_CONTRACT_ERRORS = new Set([
  "INVALID_RESULT",
  "INVALID_REPLY_SESSION_RESULT",
]);

export type KnownAnalyticsErrorClassification =
  | {
      readonly kind: "cancellation";
      readonly error: WorkerClientCancelledError;
    }
  | {
      readonly kind: "known-recoverable";
      readonly error: WorkerClientError;
    }
  | {
      readonly kind: "known-contract";
      readonly error: Error;
    };

export type AnalyticsErrorClassification =
  | KnownAnalyticsErrorClassification
  | {
      readonly kind: "unexpected";
      readonly error: unknown;
    };

export function classifyAnalyticsError(
  error: unknown,
): AnalyticsErrorClassification {
  if (error instanceof WorkerClientCancelledError) {
    return { kind: "cancellation", error };
  }
  if (error instanceof WorkerClientError) {
    return { kind: "known-recoverable", error };
  }
  if (
    error instanceof Error &&
    KNOWN_ANALYTICS_CONTRACT_ERRORS.has(error.message)
  ) {
    return { kind: "known-contract", error };
  }
  return { kind: "unexpected", error };
}

export async function handleAnalyticsUpdateError(
  error: unknown,
  cleanup: () => Promise<void>,
  onKnownError: (classification: KnownAnalyticsErrorClassification) => void,
): Promise<void> {
  const classification = classifyAnalyticsError(error);
  try {
    await cleanup();
  } catch {
    // Cleanup remains best effort; the original update failure is authoritative.
  }
  if (classification.kind === "unexpected") {
    throw error;
  }
  onKnownError(classification);
}
