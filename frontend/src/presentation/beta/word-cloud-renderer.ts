import type {
  PlacedWordCloudWordV1,
  WordCloudLayoutResultV1,
  WordCloudPaletteSlot,
} from "../../word-cloud-layout/contracts";
import type { WordFrequencyRole } from "../../worker-analysis/word-frequency-contract";

export const WORD_CLOUD_MIN_DRAWABLE_FONT_SIZE = 14;
export const WORD_CLOUD_FONT_FAMILY =
  '"Helvetica Neue", "Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif';

const PALETTE_COLORS: Readonly<Record<WordCloudPaletteSlot, string>> = {
  cobalt: "#1738A8",
  coral: "#E65F3D",
  teal: "#20806B",
  amber: "#A56A12",
  violet: "#7357A8",
};

export type WordCloudRendererOmissionReason =
  | "REAL_GLYPH_EXCEEDS_LAYOUT_BOX"
  | "CANVAS_CONTEXT_UNAVAILABLE";

export interface CanvasTextMeasurement {
  readonly width: number;
  readonly height: number;
}

export interface WordCloudDrawCommand {
  readonly stableKey: string;
  readonly displayToken: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly font: string;
  readonly color: string;
  readonly opacity: number;
  readonly rotation: 0;
}

export interface WordCloudRendererOmission {
  readonly stableKey: string;
  readonly displayToken: string;
  readonly reason: WordCloudRendererOmissionReason;
}

export interface WordCloudDrawCommandResult {
  readonly commands: readonly WordCloudDrawCommand[];
  readonly omitted: readonly WordCloudRendererOmission[];
}

export interface WordCloudCanvasRenderReport extends WordCloudDrawCommandResult {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly devicePixelRatio: number;
}

export interface WordCloudCanvasRenderOptions {
  readonly cssWidth: number;
  readonly devicePixelRatio: number;
  readonly role?: WordFrequencyRole;
  readonly fontFamily?: string;
  readonly minimumFontSize?: number;
}

export interface WordCloudMeasurementContext {
  font: string;
  measureText(text: string): TextMetrics;
}

export interface WordCloudCanvasContext extends WordCloudMeasurementContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

function positiveMetric(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function measureCanvasText(
  context: WordCloudMeasurementContext,
  token: string,
  fontSize: number,
  fontFamily: string,
): CanvasTextMeasurement {
  context.font = `${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(token);
  const measuredHeight = positiveMetric(metrics.actualBoundingBoxAscent) +
    positiveMetric(metrics.actualBoundingBoxDescent);
  return {
    width: Number.isFinite(metrics.width) ? Math.max(0, metrics.width) : Number.POSITIVE_INFINITY,
    height: measuredHeight > 0 ? measuredHeight : fontSize * 1.2,
  };
}

export function wordCloudColorForPaletteSlot(
  slot: WordCloudPaletteSlot,
  role: WordFrequencyRole = "both",
): string {
  if (role === "owner") {
    return PALETTE_COLORS.cobalt;
  }
  if (role === "other") {
    return PALETTE_COLORS.coral;
  }
  return PALETTE_COLORS[slot];
}

export function wordCloudOpacityForRank(displayRank: number): number {
  if (displayRank <= 6) {
    return 1;
  }
  if (displayRank <= 18) {
    return 0.9;
  }
  return 0.78;
}

export function fitDrawableFontSize(
  word: Pick<PlacedWordCloudWordV1, "displayToken" | "fontSize" | "width" | "height">,
  measure: (token: string, fontSize: number) => CanvasTextMeasurement,
  minimumFontSize = WORD_CLOUD_MIN_DRAWABLE_FONT_SIZE,
): { readonly fontSize: number; readonly measurement: CanvasTextMeasurement } | null {
  if (
    !Number.isSafeInteger(word.fontSize) ||
    !Number.isSafeInteger(minimumFontSize) ||
    minimumFontSize <= 0 ||
    minimumFontSize > word.fontSize
  ) {
    throw new Error("INVALID_WORD_CLOUD_DRAWABLE_FONT_SIZE");
  }
  for (let fontSize = word.fontSize; fontSize >= minimumFontSize; fontSize -= 1) {
    const measurement = measure(word.displayToken, fontSize);
    if (measurement.width <= word.width && measurement.height <= word.height) {
      return { fontSize, measurement };
    }
  }
  return null;
}

export function createWordCloudDrawCommands(
  placed: readonly PlacedWordCloudWordV1[],
  context: WordCloudMeasurementContext,
  options: Pick<WordCloudCanvasRenderOptions, "role" | "fontFamily" | "minimumFontSize"> = {},
): WordCloudDrawCommandResult {
  const fontFamily = options.fontFamily ?? WORD_CLOUD_FONT_FAMILY;
  const minimumFontSize = options.minimumFontSize ?? WORD_CLOUD_MIN_DRAWABLE_FONT_SIZE;
  const commands: WordCloudDrawCommand[] = [];
  const omitted: WordCloudRendererOmission[] = [];
  for (const word of placed) {
    const fitted = fitDrawableFontSize(
      word,
      (token, fontSize) => measureCanvasText(context, token, fontSize, fontFamily),
      minimumFontSize,
    );
    if (fitted === null) {
      omitted.push({
        stableKey: word.stableKey,
        displayToken: word.displayToken,
        reason: "REAL_GLYPH_EXCEEDS_LAYOUT_BOX",
      });
      continue;
    }
    commands.push({
      stableKey: word.stableKey,
      displayToken: word.displayToken,
      x: word.x + 8,
      y: word.y + 6 + fitted.fontSize,
      fontSize: fitted.fontSize,
      font: `${fitted.fontSize}px ${fontFamily}`,
      color: wordCloudColorForPaletteSlot(word.paletteSlot, options.role),
      opacity: wordCloudOpacityForRank(word.displayRank),
      rotation: 0,
    });
  }
  return { commands, omitted };
}

export function renderWordCloudToCanvas(
  canvas: HTMLCanvasElement,
  result: WordCloudLayoutResultV1,
  options: WordCloudCanvasRenderOptions,
): WordCloudCanvasRenderReport {
  if (
    !Number.isFinite(options.cssWidth) ||
    options.cssWidth <= 0 ||
    !Number.isFinite(options.devicePixelRatio) ||
    options.devicePixelRatio <= 0
  ) {
    throw new Error("INVALID_WORD_CLOUD_CANVAS_SIZE");
  }
  const context = canvas.getContext("2d") as WordCloudCanvasContext | null;
  const cssWidth = options.cssWidth;
  const scale = cssWidth / result.width;
  const cssHeight = result.height * scale;
  const devicePixelRatio = options.devicePixelRatio;
  const backingWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = backingWidth;
  canvas.height = backingHeight;

  if (context === null) {
    return {
      commands: [],
      omitted: result.placed.map((word) => ({
        stableKey: word.stableKey,
        displayToken: word.displayToken,
        reason: "CANVAS_CONTEXT_UNAVAILABLE",
      })),
      cssWidth,
      cssHeight,
      backingWidth,
      backingHeight,
      devicePixelRatio,
    };
  }

  const commands = createWordCloudDrawCommands(result.placed, context, options);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, backingWidth, backingHeight);
  context.setTransform(scale * devicePixelRatio, 0, 0, scale * devicePixelRatio, 0, 0);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  for (const command of commands.commands) {
    context.font = command.font;
    context.fillStyle = command.color;
    context.globalAlpha = command.opacity;
    context.fillText(command.displayToken, command.x, command.y);
  }
  context.globalAlpha = 1;
  return {
    ...commands,
    cssWidth,
    cssHeight,
    backingWidth,
    backingHeight,
    devicePixelRatio,
  };
}
