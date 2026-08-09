import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  WORD_CLOUD_MIN_FREQUENCY,
  createWordCloudLayoutRequest,
} from "../src/word-cloud-layout/contracts";
import { layoutWordCloud } from "../src/word-cloud-layout/layout-engine";
import { createWordCloudPresentation } from "../src/word-cloud-layout/presentation";
import { canonicalQueryKey } from "../src/worker-analysis/analytics-contract";
import {
  createSyntheticFrequencyDto,
  LAYOUT_DATASET_A,
  LAYOUT_GENERATION,
} from "./word-cloud-layout-fixtures";

describe("B3 frequency DTO to B4 deterministic geometry integration", () => {
  it("runs WorkerWordFrequencyDtoV1 → bounded presentation → layout request → geometry", async () => {
    const dto = createSyntheticFrequencyDto(120);
    const canonicalKeyBefore = dto.identity.baseQueryKey;
    const presented = createWordCloudPresentation(
      dto,
      [dto.items[1]!.normalizedToken],
      "per-10000-eligible-tokens",
      80,
    );
    expect(presented.words).toHaveLength(80);
    expect(presented.words.some((word) => word.displayToken === dto.items[1]!.normalizedToken)).toBe(false);
    const request = createWordCloudLayoutRequest({
      datasetId: dto.identity.datasetId,
      generation: dto.identity.generation,
      frequencyDtoKey: presented.frequencyDtoKey,
      viewportBucket: "wide",
      wordLimit: 80,
      words: presented.words,
    });
    const result = await layoutWordCloud(request);
    expect(result.placed.length + result.omitted.length).toBe(80);
    expect(result.presentationDigest).toBe(presented.presentationDigest);
    expect(dto.identity.baseQueryKey).toBe(canonicalKeyBefore);
    expect(canonicalQueryKey(LAYOUT_DATASET_A, LAYOUT_GENERATION, {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      sender: "both",
      selectedYear: 2025,
      sessionThresholdHours: 6,
    })).toBe(canonicalKeyBefore);
    expect(JSON.stringify(request)).not.toMatch(/canonicalEvents|messageBody|sourcePath|contact|context/u);
  });

  it("uses a dedicated Worker and keeps the placement engine out of React/main-thread modules", () => {
    const root = new URL("../src/word-cloud-layout/", import.meta.url);
    const client = readFileSync(fileURLToPath(new URL("client.ts", root)), "utf8");
    const worker = readFileSync(fileURLToPath(new URL("word-cloud-layout.worker.ts", root)), "utf8");
    const presentation = readFileSync(fileURLToPath(new URL("presentation.ts", root)), "utf8");
    expect(client).toContain('new Worker(new URL("./word-cloud-layout.worker.ts"');
    expect(worker).toContain("createWordCloudLayoutWorkerHandler");
    expect(presentation).not.toMatch(/layoutWordCloud|measureText|Math\.random/u);
    const component = readFileSync(fileURLToPath(new URL("../src/presentation/beta/BetaWordCloud.tsx", import.meta.url)), "utf8");
    expect(component).not.toMatch(/layoutWordCloud\s*\(/u);
  });

  it("keeps the cloud presentation threshold at two occurrences without changing the DTO", () => {
    const dto = createSyntheticFrequencyDto(3);
    const presented = createWordCloudPresentation(
      dto,
      [],
      "raw-count",
      3,
      WORD_CLOUD_MIN_FREQUENCY,
    );
    expect(presented.items.map((item) => item.count)).toEqual([3, 2]);
    expect(dto.items.map((item) => item.count)).toEqual([3, 2, 1]);
    expect(dto.identity.frequencyDtoKey).toBe(presented.frequencyDtoKey);
  });

  it("contains no randomness, Canvas measurement, DOM, locale collation, or network dependency", () => {
    const root = fileURLToPath(new URL("../src/word-cloud-layout/", import.meta.url));
    for (const name of ["layout-engine.ts", "synthetic-metrics.ts"]) {
      const source = readFileSync(`${root}/${name}`, "utf8");
      expect(source).not.toMatch(/Math\.random|crypto|measureText|document\.|window\.|localeCompare|fetch\(/u);
    }
  });
});
