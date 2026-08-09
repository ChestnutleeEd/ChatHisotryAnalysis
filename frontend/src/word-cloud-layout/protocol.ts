import type { DatasetId, Generation } from "../desktop/ipc-contract";
import type {
  WordCloudLayoutRequestV1,
  WordCloudLayoutResultV1,
} from "./contracts";

export type WordCloudLayoutWorkerFailureCode =
  | "INVALID_LAYOUT_REQUEST"
  | "LAYOUT_RUNTIME_FAILED";

export type WordCloudLayoutWorkerRequest =
  | {
      readonly type: "layout";
      readonly requestId: number;
      readonly datasetId: DatasetId | null;
      readonly generation: Generation;
      readonly request: WordCloudLayoutRequestV1;
    }
  | {
      readonly type: "cancel";
      readonly requestId: number;
    }
  | { readonly type: "dispose" };

export type WordCloudLayoutWorkerResponse =
  | {
      readonly type: "result";
      readonly requestId: number;
      readonly datasetId: DatasetId | null;
      readonly generation: Generation;
      readonly result: WordCloudLayoutResultV1;
    }
  | {
      readonly type: "cancelled";
      readonly requestId: number;
    }
  | {
      readonly type: "error";
      readonly requestId: number;
      readonly code: WordCloudLayoutWorkerFailureCode;
    };

export interface WordCloudLayoutWorkerScope {
  onmessage: ((event: MessageEvent<WordCloudLayoutWorkerRequest>) => void) | null;
  postMessage(message: WordCloudLayoutWorkerResponse): void;
  close(): void;
}
