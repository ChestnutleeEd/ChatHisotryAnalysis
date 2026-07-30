import type { WorkerFailureCode } from "./protocol";

export interface TokenizerDependencies {
  initialize(): Promise<void>;
  cutWithoutHmm(text: string): readonly string[];
}

export class WorkerProbeError extends Error {
  readonly code: WorkerFailureCode;

  constructor(code: WorkerFailureCode) {
    super(code);
    this.name = "WorkerProbeError";
    this.code = code;
  }
}

export interface TokenizerProbeRuntime {
  initialize(): Promise<void>;
  segmentSyntheticProbe(text: string): readonly string[];
}

export function createTokenizerProbeRuntime(
  dependencies: TokenizerDependencies,
): TokenizerProbeRuntime {
  let initialized = false;

  return {
    async initialize(): Promise<void> {
      try {
        await dependencies.initialize();
        initialized = true;
      } catch {
        initialized = false;
        throw new WorkerProbeError("WASM_INITIALIZATION_FAILED");
      }
    },

    segmentSyntheticProbe(text: string): readonly string[] {
      if (!initialized) {
        throw new WorkerProbeError("WASM_NOT_INITIALIZED");
      }

      try {
        return dependencies.cutWithoutHmm(text);
      } catch {
        throw new WorkerProbeError("SEGMENTATION_FAILED");
      }
    },
  };
}

export function toWorkerFailureCode(error: unknown): WorkerFailureCode {
  return error instanceof WorkerProbeError
    ? error.code
    : "WORKER_RUNTIME_FAILED";
}
