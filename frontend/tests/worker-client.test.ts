import { describe, expect, it, vi } from "vitest";

import { AnalysisWorkerClient } from "../src/worker-analysis/worker-client";
import { WorkerProbeError } from "../src/worker-analysis/worker-runtime";

describe("analysis Worker client", () => {
  it("reports Worker creation failure without a main-thread fallback", async () => {
    const factory = vi.fn(() => {
      throw new Error("Worker unavailable");
    });
    const client = new AnalysisWorkerClient(factory);

    await expect(client.runSyntheticProbe()).rejects.toEqual(
      new WorkerProbeError("WORKER_CREATION_FAILED"),
    );
    expect(factory).toHaveBeenCalledOnce();
  });
});
