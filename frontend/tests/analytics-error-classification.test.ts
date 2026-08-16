import { describe, expect, it } from "vitest";

import {
  WorkerClientCancelledError,
  WorkerClientError,
} from "../src/worker-analysis/worker-client";
import {
  classifyAnalyticsError,
  handleAnalyticsUpdateError,
} from "../src/presentation/analytics-error-classifier";

describe("bounded analytics error classification", () => {
  it.each([
    [new WorkerClientCancelledError(), "cancellation"],
    [new WorkerClientError("WORKER_RUNTIME_FAILED"), "known-recoverable"],
    [new Error("INVALID_RESULT"), "known-contract"],
    [new Error("INVALID_REPLY_SESSION_RESULT"), "known-contract"],
  ] as const)("classifies %s as %s", (error, kind) => {
    expect(classifyAnalyticsError(error)).toMatchObject({ kind });
  });

  it("leaves unexpected programmer errors unexpected", () => {
    const error = new Error("unexpected programmer error");

    expect(classifyAnalyticsError(error)).toMatchObject({
      kind: "unexpected",
      error,
    });
  });

  it("cleans up before rethrowing an unexpected update failure", async () => {
    const events: string[] = [];
    const error = new Error("unexpected programmer error");

    await expect(
      handleAnalyticsUpdateError(
        error,
        async () => {
          events.push("cleanup");
        },
        () => {
          events.push("bounded-ui");
        },
      ),
    ).rejects.toBe(error);

    expect(events).toEqual(["cleanup"]);
  });

  it("keeps known failures bounded after cleanup", async () => {
    const events: string[] = [];

    await handleAnalyticsUpdateError(
      new Error("INVALID_RESULT"),
      async () => {
        events.push("cleanup");
      },
      (classification) => {
        events.push(classification.kind);
      },
    );

    expect(events).toEqual(["cleanup", "known-contract"]);
  });
});
