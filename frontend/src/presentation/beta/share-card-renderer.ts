import shareCardField from "../../assets/beta/art/share-card-field-v1.webp";
import {
  SHARE_CARD_ART_VERSION,
  SHARE_CARD_COPY_VERSION,
  SHARE_CARD_LAYOUT_VERSION,
  SHARE_CARD_RENDERER_VERSION,
  validateShareCardViewModelV1,
  type ShareCardMetricViewModelV1,
  type ShareCardSenderComparisonViewModelV1,
  type ShareCardViewModelV1,
} from "./summary-contract";

export const SHARE_CARD_LOGICAL_WIDTH_V1 = 600 as const;
export const SHARE_CARD_LOGICAL_HEIGHT_V1 = 750 as const;
export const SHARE_CARD_RENDER_SCALE_V1 = 2 as const;
export const SHARE_CARD_PIXEL_WIDTH_V1 =
  SHARE_CARD_LOGICAL_WIDTH_V1 * SHARE_CARD_RENDER_SCALE_V1;
export const SHARE_CARD_PIXEL_HEIGHT_V1 =
  SHARE_CARD_LOGICAL_HEIGHT_V1 * SHARE_CARD_RENDER_SCALE_V1;
export const SHARE_CARD_SAFE_AREA_V1 = 36 as const;
export const SHARE_CARD_MAX_PNG_BYTES_V1 = 10 * 1024 * 1024;

export const SHARE_CARD_FONT_FAMILY_UI_V1 =
  '"PingFang SC", "Helvetica Neue", "Arial Unicode MS", sans-serif' as const;
export const SHARE_CARD_FONT_FAMILY_DISPLAY_V1 =
  '"Songti SC", "PingFang SC", "Arial Unicode MS", serif' as const;

export const SHARE_CARD_PALETTE_V1 = {
  background: "#F7F3EA",
  ink: "#171A18",
  secondaryInk: "#59615B",
  mutedInk: "#7A817B",
  moss: "#1F4D3F",
  coral: "#C8603C",
  sand: "#E8DCC7",
  divider: "#C7C0B3",
  owner: "#254B9B",
  other: "#C95D46",
  unavailable: "#A9A397",
} as const;

export const SHARE_CARD_TYPOGRAPHY_V1 = {
  eyebrow: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 700, size: 9, lineHeight: 12 },
  headline: { family: SHARE_CARD_FONT_FAMILY_DISPLAY_V1, weight: 600, size: 31, lineHeight: 34, minimumSize: 18 },
  range: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 600, size: 10, lineHeight: 14, minimumSize: 7 },
  metricLabel: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 700, size: 10, lineHeight: 14 },
  metricHero: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 600, size: 47, lineHeight: 50, minimumSize: 22 },
  metricValue: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 600, size: 18, lineHeight: 21, minimumSize: 10 },
  metricDetail: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 400, size: 8.5, lineHeight: 11, minimumSize: 7 },
  body: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 400, size: 9, lineHeight: 12, minimumSize: 7 },
  footer: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 600, size: 8, lineHeight: 11, minimumSize: 6.5 },
  signature: { family: SHARE_CARD_FONT_FAMILY_UI_V1, weight: 700, size: 9, lineHeight: 12 },
} as const;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FORBIDDEN_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]);
const ELLIPSIS = "…";

export type ShareCardRendererErrorCodeV1 =
  | "INVALID_VIEW_MODEL"
  | "CANVAS_CONTEXT_UNAVAILABLE"
  | "EXPORT_FONT_UNAVAILABLE"
  | "EXPORT_ARTWORK_FAILED"
  | "EXPORT_RENDER_FAILED"
  | "EXPORT_PNG_ENCODE_FAILED"
  | "EXPORT_PNG_INVALID"
  | "EXPORT_LIMIT_EXCEEDED"
  | "EXPORT_DECODE_FAILED"
  | "EXPORT_ALPHA_INVALID"
  | "EXPORT_CRYPTO_UNAVAILABLE"
  | "TEXT_OVERFLOW";

export class ShareCardRendererErrorV1 extends Error {
  readonly code: ShareCardRendererErrorCodeV1;

  constructor(code: ShareCardRendererErrorCodeV1, message: string = code) {
    super(message);
    this.name = "ShareCardRendererErrorV1";
    this.code = code;
  }
}

export interface ShareCardArtworkResourceV1 {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export interface ShareCardRenderResourcesV1 {
  readonly artwork?: ShareCardArtworkResourceV1;
}

export interface ShareCardRenderOptionsV1 {
  readonly scale?: typeof SHARE_CARD_RENDER_SCALE_V1;
}

export interface ShareCardRenderResultV1 {
  readonly width: typeof SHARE_CARD_PIXEL_WIDTH_V1;
  readonly height: typeof SHARE_CARD_PIXEL_HEIGHT_V1;
  readonly logicalWidth: typeof SHARE_CARD_LOGICAL_WIDTH_V1;
  readonly logicalHeight: typeof SHARE_CARD_LOGICAL_HEIGHT_V1;
  readonly scale: typeof SHARE_CARD_RENDER_SCALE_V1;
  readonly rendererVersion: typeof SHARE_CARD_RENDERER_VERSION;
  readonly layoutVersion: typeof SHARE_CARD_LAYOUT_VERSION;
  readonly copyVersion: typeof SHARE_CARD_COPY_VERSION;
  readonly artworkVersion: typeof SHARE_CARD_ART_VERSION;
  readonly artworkMode: "raster" | "fallback";
  readonly diagnostics: {
    readonly fontStack: "offline-macOS-stack";
    readonly fontMode: "offline-macOS-stack" | "stable-fallback";
    readonly artworkDecode: "ready" | "fallback";
  };
}

export interface ShareCardPngInspectionV1 {
  readonly byteLength: number;
  readonly width: typeof SHARE_CARD_PIXEL_WIDTH_V1;
  readonly height: typeof SHARE_CARD_PIXEL_HEIGHT_V1;
  readonly bitDepth: 8;
  readonly colorType: 2 | 6;
  readonly chunkTypes: readonly string[];
  readonly forbiddenChunks: readonly string[];
}

export interface ShareCardDecodedPixelsV1 {
  readonly width: typeof SHARE_CARD_PIXEL_WIDTH_V1;
  readonly height: typeof SHARE_CARD_PIXEL_HEIGHT_V1;
  readonly opaque: true;
  readonly rgbaDigest: string;
}

export interface ShareCardPngRenderResultV1 {
  readonly bytes: Uint8Array;
  readonly render: ShareCardRenderResultV1;
  readonly png: ShareCardPngInspectionV1;
  readonly decoded: ShareCardDecodedPixelsV1;
}

export interface ShareCardCanvasRenderUpdateV1 {
  readonly status: "rendering" | "ready" | "failed";
  readonly artworkMode: "raster" | "fallback";
  readonly fontMode?: "offline-macOS-stack" | "stable-fallback";
  readonly encodeDurationMs?: number;
  readonly png?: ShareCardPngInspectionV1;
  readonly decoded?: ShareCardDecodedPixelsV1;
  readonly error?: ShareCardRendererErrorV1;
}

export type ShareCardTextMeasureV1 = (text: string, font: string) => number;

export interface ShareCardWrappedTextV1 {
  readonly lines: readonly string[];
  readonly fontSize: number;
}

function fontString(
  weight: number,
  size: number,
  family: string,
): string {
  return `${weight} ${size}px ${family}`;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function ellipsizeToWidth(
  text: string,
  maxWidth: number,
  measure: ShareCardTextMeasureV1,
  font: string,
): string {
  if (measure(text, font) <= maxWidth) {
    return text;
  }
  if (measure(ELLIPSIS, font) > maxWidth) {
    return "";
  }
  const codePoints = [...text];
  let result = ELLIPSIS;
  for (let index = 0; index < codePoints.length; index += 1) {
    const candidate = `${codePoints.slice(0, index + 1).join("")}${ELLIPSIS}`;
    if (measure(candidate, font) > maxWidth) {
      break;
    }
    result = candidate;
  }
  return result;
}

function wrapAtFont(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: ShareCardTextMeasureV1,
  font: string,
  truncate: boolean,
): string[] {
  const codePoints = [...text];
  if (codePoints.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  for (const codePoint of codePoints) {
    const candidate = `${current}${codePoint}`;
    if (current.length > 0 && measure(candidate, font) > maxWidth) {
      lines.push(current);
      current = codePoint;
      if (lines.length === maxLines) {
        const remaining = `${current}${codePoints.slice(lines.reduce((sum, line) => sum + [...line].length, 0) + 1).join("")}`;
        if (truncate) {
          lines[maxLines - 1] = ellipsizeToWidth(remaining, maxWidth, measure, font);
          return lines;
        }
        return [...lines, remaining];
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

/**
 * Wraps by Unicode code point so Han, Latin, and mixed tokens never split a
 * surrogate pair. The renderer owns this helper; it never consults DOM layout.
 */
export function wrapShareCardTextV1(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: ShareCardTextMeasureV1,
  weight: number,
  size: number,
  family: string,
  minimumSize: number,
  truncate = false,
): ShareCardWrappedTextV1 {
  if (!finitePositive(maxWidth) || maxLines < 1 || !finitePositive(size) || !finitePositive(minimumSize) || minimumSize > size) {
    throw new ShareCardRendererErrorV1("TEXT_OVERFLOW", "INVALID_TEXT_LAYOUT_BOUNDS");
  }
  for (let currentSize = size; currentSize >= minimumSize - 0.001; currentSize -= 0.5) {
    const font = fontString(weight, currentSize, family);
    const lines = wrapAtFont(text, maxWidth, maxLines, measure, font, truncate);
    const fits = lines.length <= maxLines && lines.every((line) => measure(line, font) <= maxWidth + 0.01);
    if (fits && (!truncate || lines.join("") === text || lines.at(-1)?.endsWith(ELLIPSIS) === true)) {
      return { lines, fontSize: Number(currentSize.toFixed(1)) };
    }
  }
  throw new ShareCardRendererErrorV1("TEXT_OVERFLOW", "TEXT_DOES_NOT_FIT");
}

export function truncateShareCardVocabularyTokenV1(token: string): string {
  const codePoints = [...token];
  return codePoints.length <= 12
    ? token
    : `${codePoints.slice(0, 11).join("")}${ELLIPSIS}`;
}

export function shareCardPercentageToRatioV1(share: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)%\s*$/u.exec(share);
  if (match === null) {
    throw new ShareCardRendererErrorV1("INVALID_VIEW_MODEL", "INVALID_SENDER_SHARE");
  }
  const ratio = Number(match[1]) / 100;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new ShareCardRendererErrorV1("INVALID_VIEW_MODEL", "INVALID_SENDER_SHARE");
  }
  return ratio;
}

async function waitForFont(
  font: string,
): Promise<boolean> {
  if (typeof document === "undefined" || document.fonts === undefined) {
    return false;
  }
  try {
    await document.fonts.ready;
    const loaded = await document.fonts.load(font);
    return loaded.length > 0 && document.fonts.check(font);
  } catch {
    return false;
  }
}

export async function ensureShareCardFontsReadyV1(): Promise<"offline-macOS-stack" | "stable-fallback"> {
  const ready = await Promise.all([
    waitForFont(fontString(400, 16, SHARE_CARD_FONT_FAMILY_UI_V1)),
    waitForFont(fontString(600, 31, SHARE_CARD_FONT_FAMILY_DISPLAY_V1)),
  ]);
  return ready.every(Boolean) ? "offline-macOS-stack" : "stable-fallback";
}

export async function loadShareCardArtworkV1(): Promise<ShareCardArtworkResourceV1> {
  if (typeof Image === "undefined") {
    throw new ShareCardRendererErrorV1("EXPORT_ARTWORK_FAILED", "IMAGE_UNAVAILABLE");
  }
  const image = new Image();
  image.decoding = "async";
  image.src = shareCardField;
  try {
    await image.decode();
  } catch {
    throw new ShareCardRendererErrorV1("EXPORT_ARTWORK_FAILED", "ARTWORK_DECODE_FAILED");
  }
  if (!finitePositive(image.naturalWidth) || !finitePositive(image.naturalHeight)) {
    throw new ShareCardRendererErrorV1("EXPORT_ARTWORK_FAILED", "ARTWORK_DIMENSIONS_UNAVAILABLE");
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight };
}

function drawFallbackArtwork(ctx: CanvasRenderingContext2D): void {
  const { moss, coral, sand, divider } = SHARE_CARD_PALETTE_V1;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = sand;
  ctx.fillRect(0, 0, SHARE_CARD_LOGICAL_WIDTH_V1, SHARE_CARD_LOGICAL_HEIGHT_V1);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = moss;
  const lines: readonly [number, number, number, number][] = [
    [0, 112, 164, 0],
    [0, 192, 246, 0],
    [436, 0, 600, 164],
    [520, 0, 600, 80],
    [0, 622, 156, 750],
    [442, 750, 600, 594],
  ];
  lines.forEach(([x1, y1, x2, y2]) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  ctx.strokeStyle = coral;
  ctx.lineWidth = 2;
  const arcs: readonly [number, number, number, number, number, number][] = [
    [86, 76, 42, 0, Math.PI * 1.1, 0],
    [520, 640, 52, Math.PI, Math.PI * 1.85, 0],
  ];
  arcs.forEach(([x, y, radius, start, end]) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, start, end);
    ctx.stroke();
  });
  ctx.fillStyle = moss;
  const dots: readonly [number, number, number][] = [
    [42, 66, 2], [61, 48, 1.4], [80, 30, 1.8], [103, 54, 1.1],
    [520, 98, 1.8], [544, 118, 1.2], [566, 140, 2], [494, 76, 1.1],
    [44, 678, 1.6], [68, 702, 2], [92, 724, 1.2], [118, 698, 1.5],
    [500, 674, 1.2], [526, 696, 1.8], [550, 716, 1.2], [574, 690, 1.7],
  ];
  dots.forEach(([x, y, radius]) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = divider;
  ctx.lineWidth = 0.7;
  ctx.strokeRect(20, 20, 560, 710);
  ctx.restore();
}

function drawRasterArtwork(
  ctx: CanvasRenderingContext2D,
  artwork: ShareCardArtworkResourceV1,
): boolean {
  if (!finitePositive(artwork.width) || !finitePositive(artwork.height)) {
    return false;
  }
  const targetAspect = SHARE_CARD_LOGICAL_WIDTH_V1 / SHARE_CARD_LOGICAL_HEIGHT_V1;
  const sourceAspect = artwork.width / artwork.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = artwork.width;
  let sourceHeight = artwork.height;
  if (sourceAspect > targetAspect) {
    sourceWidth = artwork.height * targetAspect;
    sourceX = (artwork.width - sourceWidth) / 2;
  } else if (sourceAspect < targetAspect) {
    sourceHeight = artwork.width / targetAspect;
    sourceY = (artwork.height - sourceHeight) / 2;
  }
  try {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(
      artwork.source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      SHARE_CARD_LOGICAL_WIDTH_V1,
      SHARE_CARD_LOGICAL_HEIGHT_V1,
    );
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgb(247 243 234 / 86%)";
    ctx.fillRect(22, 22, 556, 706);
    ctx.restore();
    return true;
  } catch {
    ctx.restore();
    return false;
  }
}

function clearAndFillCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = SHARE_CARD_PIXEL_WIDTH_V1;
  canvas.height = SHARE_CARD_PIXEL_HEIGHT_V1;
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) {
    throw new ShareCardRendererErrorV1("CANVAS_CONTEXT_UNAVAILABLE");
  }
  context.setTransform(SHARE_CARD_RENDER_SCALE_V1, 0, 0, SHARE_CARD_RENDER_SCALE_V1, 0, 0);
  context.clearRect(0, 0, SHARE_CARD_LOGICAL_WIDTH_V1, SHARE_CARD_LOGICAL_HEIGHT_V1);
  context.fillStyle = SHARE_CARD_PALETTE_V1.background;
  context.fillRect(0, 0, SHARE_CARD_LOGICAL_WIDTH_V1, SHARE_CARD_LOGICAL_HEIGHT_V1);
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  return context;
}

function drawRule(ctx: CanvasRenderingContext2D, y: number, color: string = SHARE_CARD_PALETTE_V1.divider, width = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(SHARE_CARD_SAFE_AREA_V1, y);
  ctx.lineTo(SHARE_CARD_LOGICAL_WIDTH_V1 - SHARE_CARD_SAFE_AREA_V1, y);
  ctx.stroke();
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  weight: number,
  size: number,
  family: string,
  color: string,
  align: CanvasTextAlign = "left",
): void {
  ctx.save();
  ctx.font = fontString(weight, size, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, baseline);
  ctx.restore();
}

function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  maxWidth: number,
  maxLines: number,
  style: { readonly family: string; readonly weight: number; readonly size: number; readonly lineHeight: number; readonly minimumSize: number },
  color: string,
  truncate: boolean,
): ShareCardWrappedTextV1 {
  const measure: ShareCardTextMeasureV1 = (value, font) => {
    ctx.save();
    ctx.font = font;
    const width = ctx.measureText(value).width;
    ctx.restore();
    return width;
  };
  const wrapped = wrapShareCardTextV1(
    text,
    maxWidth,
    maxLines,
    measure,
    style.weight,
    style.size,
    style.family,
    style.minimumSize,
    truncate,
  );
  wrapped.lines.forEach((line, index) => {
    drawText(ctx, line, x, baseline + index * style.lineHeight, style.weight, wrapped.fontSize, style.family, color);
  });
  return wrapped;
}

function drawMetricValue(
  ctx: CanvasRenderingContext2D,
  metric: ShareCardMetricViewModelV1,
  x: number,
  baseline: number,
  width: number,
  hero = false,
): void {
  if (metric.status === "unavailable") {
    drawText(ctx, metric.detail, x, baseline, 600, hero ? 20 : 13, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.unavailable);
    return;
  }
  const style = hero ? SHARE_CARD_TYPOGRAPHY_V1.metricHero : SHARE_CARD_TYPOGRAPHY_V1.metricValue;
  const text = `${metric.value ?? ""}${metric.unit}`;
  drawWrapped(ctx, text, x, baseline, width, hero ? 1 : 2, style, SHARE_CARD_PALETTE_V1.ink, false);
}

function drawMetricDetail(
  ctx: CanvasRenderingContext2D,
  metric: ShareCardMetricViewModelV1,
  x: number,
  baseline: number,
  width: number,
): void {
  drawWrapped(ctx, metric.detail, x, baseline, width, 2, SHARE_CARD_TYPOGRAPHY_V1.metricDetail, SHARE_CARD_PALETTE_V1.secondaryInk, true);
}

function drawSenderComparison(
  ctx: CanvasRenderingContext2D,
  comparison: ShareCardSenderComparisonViewModelV1,
): void {
  const left = SHARE_CARD_SAFE_AREA_V1;
  const width = SHARE_CARD_LOGICAL_WIDTH_V1 - SHARE_CARD_SAFE_AREA_V1 * 2;
  drawRule(ctx, 392, SHARE_CARD_PALETTE_V1.moss, 1.4);
  drawText(ctx, "Owner / Other", left, 416, 700, 10, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.moss);
  drawWrapped(ctx, comparison.detail, left, 432, width, 2, SHARE_CARD_TYPOGRAPHY_V1.metricDetail, SHARE_CARD_PALETTE_V1.secondaryInk, true);
  const barY = 458;
  const barHeight = 13;
  ctx.save();
  ctx.fillStyle = SHARE_CARD_PALETTE_V1.sand;
  ctx.fillRect(left, barY, width, barHeight);
  if (comparison.status === "available") {
    const ownerRatio = shareCardPercentageToRatioV1(comparison.owner.share ?? "");
    const ownerWidth = Math.round(width * ownerRatio * 10) / 10;
    ctx.fillStyle = SHARE_CARD_PALETTE_V1.owner;
    ctx.fillRect(left, barY, ownerWidth, barHeight);
    ctx.fillStyle = SHARE_CARD_PALETTE_V1.other;
    ctx.fillRect(left + ownerWidth, barY, Math.max(0, width - ownerWidth), barHeight);
  } else {
    ctx.fillStyle = SHARE_CARD_PALETTE_V1.unavailable;
    ctx.fillRect(left, barY, width, barHeight);
  }
  ctx.restore();

  const roleY = 495;
  const columnWidth = width / 2 - 12;
  const roles = [comparison.owner, comparison.other] as const;
  roles.forEach((role, index) => {
    const x = left + index * (width / 2);
    const color = role.label === "Owner" ? SHARE_CARD_PALETTE_V1.owner : SHARE_CARD_PALETTE_V1.other;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x, roleY - 10, 7, 7);
    ctx.restore();
    drawText(ctx, role.label, x + 13, roleY - 2, 700, 10, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.ink);
    drawWrapped(ctx, role.count === null ? "证据不足" : `${role.count} 条 · ${role.share ?? ""}`, x + 13, roleY + 11, columnWidth - 13, 1, SHARE_CARD_TYPOGRAPHY_V1.footer, SHARE_CARD_PALETTE_V1.secondaryInk, false);
  });
}

function drawVocabulary(
  ctx: CanvasRenderingContext2D,
  viewModel: ShareCardViewModelV1,
): void {
  const left = SHARE_CARD_SAFE_AREA_V1;
  const width = SHARE_CARD_LOGICAL_WIDTH_V1 - SHARE_CARD_SAFE_AREA_V1 * 2;
  drawRule(ctx, 532);
  drawText(ctx, "词汇摘要", left, 555, 700, 10, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.moss);
  drawText(ctx, viewModel.vocabulary.label, left, 571, 400, 8.5, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.secondaryInk);
  if (viewModel.vocabulary.mode !== "on") {
    return;
  }
  const itemWidth = width / 5;
  viewModel.vocabulary.items.slice(0, 5).forEach((item, index) => {
    const x = left + itemWidth * index;
    const token = truncateShareCardVocabularyTokenV1(item.token);
    const measure: ShareCardTextMeasureV1 = (value, font) => {
      ctx.save();
      ctx.font = font;
      const measured = ctx.measureText(value).width;
      ctx.restore();
      return measured;
    };
    const font = fontString(600, 9, SHARE_CARD_FONT_FAMILY_UI_V1);
    const fitted = ellipsizeToWidth(token, itemWidth - 10, measure, font);
    drawText(ctx, fitted, x + itemWidth / 2, 599, 600, 9, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.ink, "center");
    ctx.save();
    ctx.fillStyle = SHARE_CARD_PALETTE_V1.coral;
    ctx.fillRect(x + 4, 606, itemWidth - 8, 2);
    ctx.restore();
  });
}

function drawCardContent(ctx: CanvasRenderingContext2D, viewModel: ShareCardViewModelV1): void {
  const left = SHARE_CARD_SAFE_AREA_V1;
  const right = SHARE_CARD_LOGICAL_WIDTH_V1 - SHARE_CARD_SAFE_AREA_V1;
  const contentWidth = right - left;

  ctx.fillStyle = SHARE_CARD_PALETTE_V1.moss;
  ctx.fillRect(left, left, 9, 9);
  drawText(ctx, "私人数据年鉴", left + 16, 44, SHARE_CARD_TYPOGRAPHY_V1.eyebrow.weight, SHARE_CARD_TYPOGRAPHY_V1.eyebrow.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.moss);
  drawText(ctx, viewModel.timezoneLabel, right, 44, SHARE_CARD_TYPOGRAPHY_V1.range.weight, SHARE_CARD_TYPOGRAPHY_V1.range.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.mutedInk, "right");

  drawWrapped(ctx, viewModel.headline, left, 89, 340, 2, SHARE_CARD_TYPOGRAPHY_V1.headline, SHARE_CARD_PALETTE_V1.ink, false);
  drawWrapped(ctx, viewModel.rangeLabel, right - 184, 80, 184, 2, SHARE_CARD_TYPOGRAPHY_V1.range, SHARE_CARD_PALETTE_V1.secondaryInk, false);
  if (viewModel.partialLabel !== null) {
    drawText(ctx, viewModel.partialLabel, right, 108, 700, 8.5, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.coral, "right");
  }

  drawRule(ctx, 139, SHARE_CARD_PALETTE_V1.coral, 1.5);
  drawText(ctx, viewModel.metrics.totalMessages.label, left, 164, SHARE_CARD_TYPOGRAPHY_V1.metricLabel.weight, SHARE_CARD_TYPOGRAPHY_V1.metricLabel.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.mutedInk);
  drawMetricValue(ctx, viewModel.metrics.totalMessages, left, 216, 360, true);
  drawMetricDetail(ctx, viewModel.metrics.totalMessages, left, 238, 380);

  const supportMetrics = [
    viewModel.metrics.activeDays,
    viewModel.metrics.mostActiveMonth,
    viewModel.metrics.longestStreak,
  ] as const;
  const supportTop = 282;
  const supportWidth = contentWidth / 3;
  supportMetrics.forEach((metric, index) => {
    const x = left + supportWidth * index;
    if (index > 0) {
      ctx.save();
      ctx.strokeStyle = SHARE_CARD_PALETTE_V1.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 12, supportTop);
      ctx.lineTo(x - 12, 378);
      ctx.stroke();
      ctx.restore();
    }
    drawText(ctx, metric.label, x, supportTop + 16, SHARE_CARD_TYPOGRAPHY_V1.metricLabel.weight, SHARE_CARD_TYPOGRAPHY_V1.metricLabel.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.mutedInk);
    drawMetricValue(ctx, metric, x, supportTop + 48, supportWidth - 22);
    drawMetricDetail(ctx, metric, x, supportTop + 78, supportWidth - 22);
  });

  drawSenderComparison(ctx, viewModel.senderComparison);
  drawVocabulary(ctx, viewModel);

  drawRule(ctx, 635);
  drawText(ctx, viewModel.privacyLine, left, 658, SHARE_CARD_TYPOGRAPHY_V1.footer.weight, SHARE_CARD_TYPOGRAPHY_V1.footer.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.moss);
  const scopeNote = `${viewModel.partialLabel ?? "完整日期范围"} · ${viewModel.senderFilterContext.appliedFilterLabel}`;
  drawWrapped(ctx, scopeNote, left, 676, 330, 2, SHARE_CARD_TYPOGRAPHY_V1.footer, SHARE_CARD_PALETTE_V1.secondaryInk, true);
  drawText(ctx, viewModel.productSignature, right, 704, SHARE_CARD_TYPOGRAPHY_V1.signature.weight, SHARE_CARD_TYPOGRAPHY_V1.signature.size, SHARE_CARD_FONT_FAMILY_UI_V1, SHARE_CARD_PALETTE_V1.ink, "right");
}

export async function renderShareCardV1(
  canvas: HTMLCanvasElement,
  viewModel: ShareCardViewModelV1,
  resources: ShareCardRenderResourcesV1 = {},
  options: ShareCardRenderOptionsV1 = {},
): Promise<ShareCardRenderResultV1> {
  try {
    validateShareCardViewModelV1(viewModel);
  } catch {
    throw new ShareCardRendererErrorV1("INVALID_VIEW_MODEL");
  }
  if (options.scale !== undefined && options.scale !== SHARE_CARD_RENDER_SCALE_V1) {
    throw new ShareCardRendererErrorV1("EXPORT_RENDER_FAILED", "UNSUPPORTED_RENDER_SCALE");
  }
  const fontMode = await ensureShareCardFontsReadyV1();
  let context: CanvasRenderingContext2D;
  try {
    context = clearAndFillCanvas(canvas);
  } catch (error) {
    if (error instanceof ShareCardRendererErrorV1) {
      throw error;
    }
    throw new ShareCardRendererErrorV1("CANVAS_CONTEXT_UNAVAILABLE");
  }
  let artworkMode: "raster" | "fallback" = "fallback";
  if (resources.artwork !== undefined && drawRasterArtwork(context, resources.artwork)) {
    artworkMode = "raster";
  } else {
    drawFallbackArtwork(context);
    // The fallback is drawn first, then the text-safe folio surface is applied.
    context.save();
    context.fillStyle = "rgb(247 243 234 / 88%)";
    context.fillRect(22, 22, 556, 706);
    context.restore();
  }
  try {
    drawCardContent(context, viewModel);
  } catch (error) {
    if (error instanceof ShareCardRendererErrorV1) {
      throw error;
    }
    throw new ShareCardRendererErrorV1("EXPORT_RENDER_FAILED");
  }
  return {
    width: SHARE_CARD_PIXEL_WIDTH_V1,
    height: SHARE_CARD_PIXEL_HEIGHT_V1,
    logicalWidth: SHARE_CARD_LOGICAL_WIDTH_V1,
    logicalHeight: SHARE_CARD_LOGICAL_HEIGHT_V1,
    scale: SHARE_CARD_RENDER_SCALE_V1,
    rendererVersion: SHARE_CARD_RENDERER_VERSION,
    layoutVersion: SHARE_CARD_LAYOUT_VERSION,
    copyVersion: SHARE_CARD_COPY_VERSION,
    artworkVersion: SHARE_CARD_ART_VERSION,
    artworkMode,
    diagnostics: {
      fontStack: "offline-macOS-stack",
      fontMode,
      artworkDecode: artworkMode === "raster" ? "ready" : "fallback",
    },
  };
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunkCrc(bytes: Uint8Array, typeStart: number, dataEnd: number): number {
  const typeAndData = bytes.slice(typeStart, dataEnd);
  return crc32(typeAndData);
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

export function inspectShareCardPngV1(bytes: Uint8Array): ShareCardPngInspectionV1 {
  if (bytes.byteLength === 0 || bytes.byteLength > SHARE_CARD_MAX_PNG_BYTES_V1) {
    throw new ShareCardRendererErrorV1(bytes.byteLength > SHARE_CARD_MAX_PNG_BYTES_V1 ? "EXPORT_LIMIT_EXCEEDED" : "EXPORT_PNG_INVALID", "PNG_SIZE_INVALID");
  }
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_SIGNATURE_INVALID");
  }
  let offset = PNG_SIGNATURE.length;
  const chunkTypes: string[] = [];
  let width: number | null = null;
  let height: number | null = null;
  let bitDepth: number | null = null;
  let colorType: number | null = null;
  let sawIend = false;
  let idatCount = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) {
      throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_CHUNK_TRUNCATED");
    }
    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd < dataStart || crcEnd < dataEnd || crcEnd > bytes.length) {
      throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_CHUNK_LENGTH_INVALID");
    }
    const type = chunkType(bytes, typeStart);
    chunkTypes.push(type);
    const expectedCrc = readUint32(bytes, dataEnd);
    if (chunkCrc(bytes, typeStart, dataEnd) !== expectedCrc) {
      throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_CRC_INVALID");
    }
    if (type === "IHDR") {
      if (chunkTypes.filter((entry) => entry === "IHDR").length !== 1 || length !== 13) {
        throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_IHDR_INVALID");
      }
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8] ?? null;
      colorType = bytes[dataStart + 9] ?? null;
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12] !== 0) {
        throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_IHDR_COMPRESSION_INVALID");
      }
    } else if (type === "IDAT") {
      idatCount += 1;
    } else if (type === "IEND") {
      if (length !== 0 || crcEnd !== bytes.length) {
        throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_IEND_INVALID");
      }
      sawIend = true;
    }
    offset = crcEnd;
    if (sawIend) {
      break;
    }
  }
  if (!sawIend || chunkTypes[0] !== "IHDR" || chunkTypes.at(-1) !== "IEND" || idatCount === 0 || width !== SHARE_CARD_PIXEL_WIDTH_V1 || height !== SHARE_CARD_PIXEL_HEIGHT_V1 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", "PNG_STRUCTURE_INVALID");
  }
  const forbiddenChunks = chunkTypes.filter((type) => FORBIDDEN_PNG_CHUNKS.has(type));
  if (forbiddenChunks.length > 0) {
    throw new ShareCardRendererErrorV1("EXPORT_PNG_INVALID", `PNG_FORBIDDEN_CHUNK_${forbiddenChunks[0]}`);
  }
  return {
    byteLength: bytes.byteLength,
    width: SHARE_CARD_PIXEL_WIDTH_V1,
    height: SHARE_CARD_PIXEL_HEIGHT_V1,
    bitDepth: 8,
    colorType: colorType as 2 | 6,
    chunkTypes,
    forbiddenChunks,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new ShareCardRendererErrorV1("EXPORT_PNG_ENCODE_FAILED", "PNG_BLOB_EMPTY"));
        } else {
          resolve(blob);
        }
      }, "image/png");
    } catch {
      reject(new ShareCardRendererErrorV1("EXPORT_PNG_ENCODE_FAILED"));
    }
  });
}

export async function encodeShareCardPngV1(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  try {
    const blob = await canvasToBlob(canvas);
    if (blob.size <= 0 || blob.size > SHARE_CARD_MAX_PNG_BYTES_V1) {
      throw new ShareCardRendererErrorV1(blob.size > SHARE_CARD_MAX_PNG_BYTES_V1 ? "EXPORT_LIMIT_EXCEEDED" : "EXPORT_PNG_ENCODE_FAILED", "PNG_BLOB_SIZE_INVALID");
    }
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    inspectShareCardPngV1(bytes);
    return bytes;
  } catch (error) {
    if (error instanceof ShareCardRendererErrorV1) {
      throw error;
    }
    throw new ShareCardRendererErrorV1("EXPORT_PNG_ENCODE_FAILED");
  }
}

function bytesToBlob(bytes: Uint8Array): Blob {
  const ownedBuffer = bytes.slice().buffer;
  return new Blob([ownedBuffer], { type: "image/png" });
}

async function decodeImageBlob(blob: Blob): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to HTMLImageElement for WebViews without bitmap decoding.
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new ShareCardRendererErrorV1("EXPORT_DECODE_FAILED", "IMAGE_DECODE_UNAVAILABLE");
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    throw new ShareCardRendererErrorV1("EXPORT_DECODE_FAILED", "PNG_DECODE_FAILED");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function digestShareCardRgbaV1(rgba: Uint8ClampedArray): Promise<string> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) {
    throw new ShareCardRendererErrorV1("EXPORT_CRYPTO_UNAVAILABLE");
  }
  const owned = new Uint8Array(rgba.byteLength);
  owned.set(rgba);
  try {
    const digest = await crypto.subtle.digest("SHA-256", owned.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  } finally {
    owned.fill(0);
  }
}

export async function decodeShareCardPngV1(bytes: Uint8Array): Promise<ShareCardDecodedPixelsV1> {
  const inspection = inspectShareCardPngV1(bytes);
  let bitmap: CanvasImageSource | undefined;
  let validationCanvas: HTMLCanvasElement | undefined;
  try {
    const blob = bytesToBlob(bytes);
    bitmap = await decodeImageBlob(blob);
    validationCanvas = document.createElement("canvas");
    validationCanvas.width = SHARE_CARD_PIXEL_WIDTH_V1;
    validationCanvas.height = SHARE_CARD_PIXEL_HEIGHT_V1;
    const context = validationCanvas.getContext("2d", { alpha: true });
    if (context === null) {
      throw new ShareCardRendererErrorV1("EXPORT_DECODE_FAILED", "VALIDATION_CONTEXT_UNAVAILABLE");
    }
    context.drawImage(bitmap, 0, 0, SHARE_CARD_PIXEL_WIDTH_V1, SHARE_CARD_PIXEL_HEIGHT_V1);
    const pixels = context.getImageData(0, 0, SHARE_CARD_PIXEL_WIDTH_V1, SHARE_CARD_PIXEL_HEIGHT_V1).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 255) {
        throw new ShareCardRendererErrorV1("EXPORT_ALPHA_INVALID", "PNG_ALPHA_NOT_OPAQUE");
      }
    }
    return {
      width: inspection.width,
      height: inspection.height,
      opaque: true,
      rgbaDigest: await digestShareCardRgbaV1(pixels),
    };
  } catch (error) {
    if (error instanceof ShareCardRendererErrorV1) {
      throw error;
    }
    throw new ShareCardRendererErrorV1("EXPORT_DECODE_FAILED");
  } finally {
    if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) {
      bitmap.close();
    }
    if (validationCanvas !== undefined) {
      validationCanvas.width = 0;
      validationCanvas.height = 0;
    }
  }
}

/**
 * Future native-save callers should use this one-shot in-memory pipeline. The
 * temporary Canvas/Blob/ArrayBuffer are owned here and released on every path;
 * the returned bytes are the only value that leaves the function.
 */
export async function renderShareCardPngV1(
  viewModel: ShareCardViewModelV1,
  resources: ShareCardRenderResourcesV1 = {},
): Promise<ShareCardPngRenderResultV1> {
  const canvas = document.createElement("canvas");
  let bytes: Uint8Array | undefined;
  try {
    const render = await renderShareCardV1(canvas, viewModel, resources);
    bytes = await encodeShareCardPngV1(canvas);
    const png = inspectShareCardPngV1(bytes);
    const decoded = await decodeShareCardPngV1(bytes);
    return { bytes, render, png, decoded };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
