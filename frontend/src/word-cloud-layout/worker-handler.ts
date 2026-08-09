import {
  type WordCloudLayoutWorkerRequest,
  type WordCloudLayoutWorkerScope,
} from "./protocol";
import {
  isWordCloudLayoutCancellation,
  requestCorrelationMatches,
  WordCloudLayoutRuntime,
} from "./worker-runtime";

export function createWordCloudLayoutWorkerHandler(
  scope: WordCloudLayoutWorkerScope,
  runtime: WordCloudLayoutRuntime,
): (event: MessageEvent<WordCloudLayoutWorkerRequest>) => void {
  return (event): void => {
    const message = event.data;
    if (message.type === "dispose") {
      runtime.dispose();
      scope.close();
      return;
    }
    if (message.type === "cancel") {
      runtime.cancel(message.requestId);
      return;
    }
    if (
      !requestCorrelationMatches(
        message.request,
        message.datasetId,
        message.generation,
      )
    ) {
      scope.postMessage({
        type: "error",
        requestId: message.requestId,
        code: "INVALID_LAYOUT_REQUEST",
      });
      return;
    }
    void runtime.layout(message.requestId, message.request).then(
      (result) => {
        scope.postMessage({
          type: "result",
          requestId: message.requestId,
          datasetId: message.datasetId,
          generation: message.generation,
          result,
        });
      },
      (error: unknown) => {
        if (isWordCloudLayoutCancellation(error)) {
          scope.postMessage({
            type: "cancelled",
            requestId: message.requestId,
          });
          return;
        }
        scope.postMessage({
          type: "error",
          requestId: message.requestId,
          code: error instanceof Error &&
              error.message.startsWith("INVALID_WORD_CLOUD_")
            ? "INVALID_LAYOUT_REQUEST"
            : "LAYOUT_RUNTIME_FAILED",
        });
      },
    );
  };
}
