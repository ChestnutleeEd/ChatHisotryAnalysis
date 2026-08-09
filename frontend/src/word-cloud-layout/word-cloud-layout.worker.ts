/// <reference lib="webworker" />

import type { WordCloudLayoutWorkerScope } from "./protocol";
import { createWordCloudLayoutWorkerHandler } from "./worker-handler";
import { WordCloudLayoutRuntime } from "./worker-runtime";

const scope = self as unknown as WordCloudLayoutWorkerScope;
scope.onmessage = createWordCloudLayoutWorkerHandler(
  scope,
  new WordCloudLayoutRuntime(),
);

export {};
