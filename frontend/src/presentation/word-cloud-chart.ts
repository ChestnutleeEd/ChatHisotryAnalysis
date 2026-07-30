import * as echarts from "echarts";
import "echarts-wordcloud";

import type { RankedToken } from "../worker-analysis/protocol";

const WORD_COLORS = ["#606C38", "#C66B3D", "#8B9D83", "#B08B6E"];

export interface WordCloudChart {
  update(words: readonly RankedToken[]): void;
  exportPng(): string;
  resize(): void;
  dispose(): void;
}

export function createWordCloudChart(
  container: HTMLDivElement,
): WordCloudChart {
  const chart = echarts.init(container, undefined, {
    renderer: "canvas",
  });

  return {
    update(words): void {
      chart.setOption(
        {
          animation: false,
          backgroundColor: "#E8DCC7",
          tooltip: {
            trigger: "item",
            formatter: (parameters: unknown): string => {
              const item = parameters as {
                readonly name?: unknown;
                readonly value?: unknown;
              };
              return `${String(item.name ?? "")}: ${String(item.value ?? "")}`;
            },
          },
          series: [
            {
              type: "wordCloud",
              width: "96%",
              height: "92%",
              left: "center",
              top: "center",
              shape: "circle",
              gridSize: 8,
              sizeRange: [15, 66],
              rotationRange: [0, 0],
              rotationStep: 90,
              drawOutOfBound: false,
              shrinkToFit: true,
              layoutAnimation: false,
              textStyle: {
                fontFamily:
                  '"Iowan Old Style", "Baskerville", "Songti SC", serif',
                fontWeight: 700,
                color: (
                  parameters: { readonly dataIndex?: number } | undefined,
                ): string =>
                  WORD_COLORS[(parameters?.dataIndex ?? 0) % WORD_COLORS.length],
              },
              data: words.map((word) => ({
                name: word.token,
                value: word.frequency,
              })),
            },
          ],
        },
        { notMerge: true, lazyUpdate: false },
      );
    },

    exportPng(): string {
      const value = chart.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: "#E8DCC7",
        excludeComponents: ["tooltip"],
      });
      if (!value.startsWith("data:image/png;base64,")) {
        throw new Error("PNG_EXPORT_FAILED");
      }
      return value;
    },

    resize(): void {
      chart.resize();
    },

    dispose(): void {
      chart.dispose();
    },
  };
}
