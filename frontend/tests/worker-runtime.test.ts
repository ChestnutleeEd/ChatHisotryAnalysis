import { describe, expect, it, vi } from "vitest";

import {
  createTokenizerProbeRuntime,
  WorkerProbeError,
} from "../src/worker-analysis/worker-runtime";

describe("tokenizer probe runtime", () => {
  it("initializes and calls the injected Worker tokenizer without HMM", async () => {
    const initialize = vi.fn(async () => undefined);
    const cutWithoutHmm = vi.fn(() => ["本地", "隐私"]);
    const runtime = createTokenizerProbeRuntime({
      initialize,
      cutWithoutHmm,
    });

    await runtime.initialize();
    expect(runtime.segmentSyntheticProbe("固定合成探针")).toEqual([
      "本地",
      "隐私",
    ]);
    expect(initialize).toHaveBeenCalledOnce();
    expect(cutWithoutHmm).toHaveBeenCalledWith("固定合成探针");
  });

  it("returns a content-free error when WASM initialization fails", async () => {
    const runtime = createTokenizerProbeRuntime({
      initialize: async () => {
        throw new Error("sensitive upstream detail");
      },
      cutWithoutHmm: () => [],
    });

    await expect(runtime.initialize()).rejects.toEqual(
      new WorkerProbeError("WASM_INITIALIZATION_FAILED"),
    );
  });

  it("does not segment when WASM was not initialized", () => {
    const cutWithoutHmm = vi.fn(() => ["unexpected"]);
    const runtime = createTokenizerProbeRuntime({
      initialize: async () => undefined,
      cutWithoutHmm,
    });

    expect(() => runtime.segmentSyntheticProbe("固定合成探针")).toThrow(
      "WASM_NOT_INITIALIZED",
    );
    expect(cutWithoutHmm).not.toHaveBeenCalled();
  });

  it("maps segmentation failure without exposing the input or cause", async () => {
    const runtime = createTokenizerProbeRuntime({
      initialize: async () => undefined,
      cutWithoutHmm: () => {
        throw new Error("upstream detail");
      },
    });

    await runtime.initialize();
    expect(() => runtime.segmentSyntheticProbe("固定合成探针")).toThrow(
      "SEGMENTATION_FAILED",
    );
  });
});
