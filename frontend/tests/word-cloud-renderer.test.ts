import { describe, expect, it } from "vitest";

import {
  createWordCloudDrawCommands,
  fitDrawableFontSize,
  renderWordCloudToCanvas,
  wordCloudColorForPaletteSlot,
  wordCloudOpacityForRank,
} from "../src/presentation/beta/word-cloud-renderer";
import { layoutWordCloud } from "../src/word-cloud-layout/layout-engine";
import type { PlacedWordCloudWordV1 } from "../src/word-cloud-layout/contracts";
import { createSyntheticLayoutRequest } from "./word-cloud-layout-fixtures";

const placedWord: PlacedWordCloudWordV1 = {
  stableKey: "synthetic",
  displayToken: "本地",
  displayRank: 1,
  sourceRank: 1,
  placementOrder: 1,
  x: 120,
  y: 100,
  width: 64,
  height: 42,
  fontSize: 28,
  rotation: 0,
  paletteSlot: "cobalt",
  attempts: 1,
};

function measurementContext(
  measure: (token: string, fontSize: number) => { width: number; height: number },
) {
  return {
    font: "",
    measureText(token: string) {
      const fontSize = Number.parseInt(this.font, 10);
      return {
        width: measure(token, fontSize).width,
        actualBoundingBoxAscent: measure(token, fontSize).height * 0.8,
        actualBoundingBoxDescent: measure(token, fontSize).height * 0.2,
      } as TextMetrics;
    },
  };
}

function fakeCanvas(context: ReturnType<typeof measurementContext>) {
  const transforms: number[][] = [];
  let clearCalls = 0;
  let fillCalls = 0;
  const canvas = {
    width: 0,
    height: 0,
    style: {} as CSSStyleDeclaration,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const canvasContext = context as typeof context & {
    fillStyle: string;
    globalAlpha: number;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    setTransform: (...values: number[]) => void;
    clearRect: (...values: number[]) => void;
    fillText: (...values: unknown[]) => void;
  };
  canvasContext.fillStyle = "";
  canvasContext.globalAlpha = 1;
  canvasContext.textAlign = "left";
  canvasContext.textBaseline = "alphabetic";
  canvasContext.setTransform = (...values) => transforms.push(values);
  canvasContext.clearRect = () => { clearCalls += 1; };
  canvasContext.fillText = () => { fillCalls += 1; };
  return { canvas, canvasContext, transforms, get clearCalls() { return clearCalls; }, get fillCalls() { return fillCalls; } };
}

describe("Beta word-cloud Canvas renderer", () => {
  it("fits real glyph measurements down without changing geometry or growing the layout size", () => {
    const fitted = fitDrawableFontSize(
      placedWord,
      (_token, fontSize) => ({ width: fontSize * 2, height: fontSize * 1.2 }),
    );
    expect(fitted?.fontSize).toBe(28);

    const shrunk = fitDrawableFontSize(
      placedWord,
      (_token, fontSize) => ({ width: fontSize * 2.5, height: fontSize * 1.4 }),
    );
    expect(shrunk?.fontSize).toBeLessThan(placedWord.fontSize);
    expect(shrunk?.fontSize).toBeGreaterThanOrEqual(14);
    expect(placedWord.x).toBe(120);
    expect(placedWord.y).toBe(100);

    const omitted = fitDrawableFontSize(
      placedWord,
      () => ({ width: 200, height: 200 }),
    );
    expect(omitted).toBeNull();
    const commands = createWordCloudDrawCommands(
      [placedWord],
      measurementContext(() => ({ width: 200, height: 200 })),
    );
    expect(commands.commands).toEqual([]);
    expect(commands.omitted).toEqual([{
      stableKey: "synthetic",
      displayToken: "本地",
      reason: "REAL_GLYPH_EXCEEDS_LAYOUT_BOX",
    }]);
  });

  it("creates deterministic draw commands with zero rotation, stable color and bounded opacity", () => {
    const context = measurementContext((_token, fontSize) => ({
      width: fontSize,
      height: fontSize,
    }));
    const first = createWordCloudDrawCommands([placedWord], context);
    const second = createWordCloudDrawCommands([placedWord], context);
    expect(second).toEqual(first);
    expect(first.commands[0]).toMatchObject({
      stableKey: "synthetic",
      x: 128,
      y: 134,
      fontSize: 28,
      rotation: 0,
      color: "#1738A8",
      opacity: 1,
    });
    expect(wordCloudColorForPaletteSlot("cobalt", "owner")).toBe("#1738A8");
    expect(wordCloudColorForPaletteSlot("cobalt", "other")).toBe("#E65F3D");
    expect(wordCloudOpacityForRank(20)).toBeLessThan(1);
  });

  it("clears old pixels and scales the backing store by DPR without changing layout coordinates", async () => {
    const result = await layoutWordCloud(createSyntheticLayoutRequest(1, "narrow"));
    const context = measurementContext((_token, fontSize) => ({
      width: fontSize * 0.8,
      height: fontSize,
    }));
    const fake = fakeCanvas(context);
    const report = renderWordCloudToCanvas(fake.canvas, result, {
      cssWidth: 240,
      devicePixelRatio: 2,
    });
    expect(report.cssWidth).toBe(240);
    expect(report.cssHeight).toBe(260);
    expect(report.backingWidth).toBe(480);
    expect(report.backingHeight).toBe(520);
    expect(fake.canvas.width).toBe(480);
    expect(fake.canvas.height).toBe(520);
    expect(fake.clearCalls).toBe(1);
    expect(fake.fillCalls).toBe(result.placed.length);
    expect(fake.transforms.at(0)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(fake.transforms.at(1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(report.commands.every((command) => command.rotation === 0)).toBe(true);
  });

  it("reports a static renderer fallback when Canvas context is unavailable", async () => {
    const result = await layoutWordCloud(createSyntheticLayoutRequest(1, "narrow"));
    const canvas = {
      width: 0,
      height: 0,
      style: {} as CSSStyleDeclaration,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const report = renderWordCloudToCanvas(canvas, result, {
      cssWidth: 240,
      devicePixelRatio: 1,
    });
    expect(report.commands).toEqual([]);
    expect(report.omitted).toHaveLength(result.placed.length);
    expect(report.omitted.every((word) => word.reason === "CANVAS_CONTEXT_UNAVAILABLE")).toBe(true);
  });
});
