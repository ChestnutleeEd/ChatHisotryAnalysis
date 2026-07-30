import * as echarts from "echarts";
import "echarts-wordcloud";

export const SYNTHETIC_WORD_CLOUD_INPUT = [
  { name: "本地", value: 40 },
  { name: "隐私", value: 32 },
  { name: "分析", value: 24 },
  { name: "测试", value: 16 },
] as const;

export interface WordCloudProbe {
  readonly pngDataUrl: string;
  dispose(): void;
}

export async function renderWordCloudProbe(
  container: HTMLDivElement,
): Promise<WordCloudProbe> {
  const chart = echarts.init(container, undefined, {
    renderer: "canvas",
    width: 560,
    height: 280,
  });

  const rendered = new Promise<void>((resolve) => {
    chart.on("finished", () => {
      resolve();
    });
  });

  chart.setOption({
    animation: false,
    backgroundColor: "#f6f3ed",
    series: [
      {
        type: "wordCloud",
        width: "94%",
        height: "90%",
        left: "center",
        top: "center",
        shape: "circle",
        gridSize: 8,
        sizeRange: [18, 38],
        rotationRange: [0, 0],
        rotationStep: 90,
        drawOutOfBound: false,
        layoutAnimation: false,
        textStyle: {
          fontFamily: 'Arial, "PingFang SC", sans-serif',
          color: "#23483e",
          fontWeight: 600,
        },
        data: SYNTHETIC_WORD_CLOUD_INPUT.map((item) => ({ ...item })),
      },
    ],
  });

  await rendered;
  const pngDataUrl = chart.getDataURL({
    type: "png",
    pixelRatio: 1,
    backgroundColor: "#f6f3ed",
  });

  if (!pngDataUrl.startsWith("data:image/png;base64,")) {
    chart.dispose();
    throw new Error("PNG_EXPORT_FAILED");
  }

  return {
    pngDataUrl,
    dispose(): void {
      chart.dispose();
    },
  };
}
