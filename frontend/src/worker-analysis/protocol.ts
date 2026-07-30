export const SYNTHETIC_SEGMENTATION_PROBE = "本地隐私分析测试";

export type WorkerFailureCode =
  | "WORKER_CREATION_FAILED"
  | "WORKER_RUNTIME_FAILED"
  | "WORKER_TIMEOUT"
  | "WASM_INITIALIZATION_FAILED"
  | "WASM_NOT_INITIALIZED"
  | "SEGMENTATION_FAILED";

export type WorkerRequest =
  | {
      readonly type: "initialize";
      readonly id: number;
    }
  | {
      readonly type: "segment-probe";
      readonly id: number;
      readonly text: typeof SYNTHETIC_SEGMENTATION_PROBE;
    }
  | {
      readonly type: "dispose";
      readonly id: number;
    };

export type WorkerResponse =
  | {
      readonly type: "ready";
      readonly id: number;
    }
  | {
      readonly type: "probe-result";
      readonly id: number;
      readonly tokens: readonly string[];
    }
  | {
      readonly type: "error";
      readonly id: number;
      readonly code: WorkerFailureCode;
    };

export interface WorkerProbeResult {
  readonly tokens: readonly string[];
}
