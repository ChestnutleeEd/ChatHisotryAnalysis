import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SHARE_CARD_LOGICAL_HEIGHT_V1,
  SHARE_CARD_LOGICAL_WIDTH_V1,
  SHARE_CARD_MAX_PNG_BYTES_V1,
  SHARE_CARD_PIXEL_HEIGHT_V1,
  SHARE_CARD_PIXEL_WIDTH_V1,
  SHARE_CARD_RENDER_SCALE_V1,
  ShareCardRendererErrorV1,
  inspectShareCardPngV1,
  renderShareCardV1,
  sanitizeShareCardPngV1,
  shareCardPercentageToRatioV1,
  truncateShareCardVocabularyTokenV1,
  wrapShareCardTextV1,
} from "../src/presentation/beta/share-card-renderer";

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.byteLength;
  });
  return result;
}

function uint32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
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

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((character) => character.charCodeAt(0)));
  const body = concatBytes(typeBytes, data);
  return concatBytes(uint32(data.byteLength), body, uint32(crc32(body)));
}

function syntheticPng(options: { readonly width?: number; readonly metadataType?: string } = {}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width ?? SHARE_CARD_PIXEL_WIDTH_V1, false);
  view.setUint32(4, SHARE_CARD_PIXEL_HEIGHT_V1, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const metadata = options.metadataType === undefined
    ? new Uint8Array()
    : chunk(options.metadataType, new TextEncoder().encode("note\0synthetic"));
  return concatBytes(signature, chunk("IHDR", ihdr), metadata, chunk("IDAT", Uint8Array.of(0)), chunk("IEND", new Uint8Array()));
}

describe("B5.3 share-card renderer authority", () => {
  it("rejects invalid view models before touching Canvas or DOM resources", async () => {
    await expect(renderShareCardV1({} as HTMLCanvasElement, {} as never)).rejects.toMatchObject({
      code: "INVALID_VIEW_MODEL",
    });
  });

  it("freezes logical geometry and backing pixels", () => {
    expect(SHARE_CARD_LOGICAL_WIDTH_V1).toBe(600);
    expect(SHARE_CARD_LOGICAL_HEIGHT_V1).toBe(750);
    expect(SHARE_CARD_RENDER_SCALE_V1).toBe(2);
    expect(SHARE_CARD_PIXEL_WIDTH_V1).toBe(1200);
    expect(SHARE_CARD_PIXEL_HEIGHT_V1).toBe(1500);
  });

  it("wraps mixed Chinese and English by code point and bounds long vocabulary tokens", () => {
    const measure = (text: string): number => [...text].length * 10;
    const wrapped = wrapShareCardTextV1("长标题MixedEnglish文本", 100, 2, measure, 600, 20, "sans-serif", 10);
    expect(wrapped.lines).toHaveLength(2);
    expect(wrapped.lines.join("")).toBe("长标题MixedEnglish文本");
    expect(truncateShareCardVocabularyTokenV1("超长的词汇摘要MixedToken")).toHaveLength(12);
    expect(truncateShareCardVocabularyTokenV1("超长的词汇摘要MixedToken").endsWith("…")).toBe(true);
  });

  it("fits or rejects text explicitly instead of clipping it", () => {
    const measure = (text: string): number => [...text].length * 10;
    expect(() => wrapShareCardTextV1("超长文本", 10, 1, measure, 600, 12, "sans-serif", 10)).toThrowError(ShareCardRendererErrorV1);
    expect(wrapShareCardTextV1("0123456789", 40, 1, measure, 600, 12, "sans-serif", 10, true).lines[0]).toMatch(/…$/u);
  });

  it("keeps comparison ratios finite for 0/100 and 50/50 cases", () => {
    expect(shareCardPercentageToRatioV1("0.0%")).toBe(0);
    expect(shareCardPercentageToRatioV1("50.0%")).toBe(0.5);
    expect(shareCardPercentageToRatioV1("100.0%")).toBe(1);
    expect(() => shareCardPercentageToRatioV1("NaN")).toThrowError(ShareCardRendererErrorV1);
  });

  it("validates PNG signature, dimensions, CRC, chunk order, and metadata privacy", () => {
    const valid = syntheticPng();
    expect(inspectShareCardPngV1(valid)).toMatchObject({
      byteLength: valid.byteLength,
      width: SHARE_CARD_PIXEL_WIDTH_V1,
      height: SHARE_CARD_PIXEL_HEIGHT_V1,
      bitDepth: 8,
      colorType: 6,
      chunkTypes: ["IHDR", "IDAT", "IEND"],
      forbiddenChunks: [],
    });
    for (const metadataType of ["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]) {
      expect(() => inspectShareCardPngV1(syntheticPng({ metadataType }))).toThrow(`PNG_FORBIDDEN_CHUNK_${metadataType}`);
    }
    expect(() => inspectShareCardPngV1(syntheticPng({ width: 1199 }))).toThrow("PNG_STRUCTURE_INVALID");
    const badCrc = valid.slice();
    badCrc[badCrc.length - 1] = (badCrc.at(-1) ?? 0) ^ 0xff;
    expect(() => inspectShareCardPngV1(badCrc)).toThrow("PNG_CRC_INVALID");
  });

  it("strips WebKit metadata before the final PNG privacy inspection", () => {
    const withExif = syntheticPng({ metadataType: "eXIf" });
    const sanitized = sanitizeShareCardPngV1(withExif);
    expect(sanitized.byteLength).toBeLessThan(withExif.byteLength);
    expect(inspectShareCardPngV1(sanitized)).toMatchObject({
      chunkTypes: ["IHDR", "IDAT", "IEND"],
      forbiddenChunks: [],
    });
  });

  it("enforces the encoded byte bound", () => {
    const oversized = new Uint8Array(SHARE_CARD_MAX_PNG_BYTES_V1 + 1);
    expect(() => inspectShareCardPngV1(oversized)).toThrowError(
      expect.objectContaining({ code: "EXPORT_LIMIT_EXCEEDED" }),
    );
  });

  it("keeps renderer source free of viewport, time, randomness, and source DTO access", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/presentation/beta/share-card-renderer.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/Math\.random|Date\.now|devicePixelRatio|getComputedStyle|innerWidth|scrollY|matchMedia/iu);
    expect(source).not.toMatch(/CanonicalAnalysisResult|BetaReportDto|WorkerWordFrequency|AnalyticsWorker|messageBody|sourcePath|contactName/iu);
    expect(source).not.toMatch(/PRIVATE_PATH_SENTINEL|CONTACT_ID_SENTINEL|RAW_MESSAGE_SENTINEL|QUERY_KEY_SENTINEL/iu);
  });
});
