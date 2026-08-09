import type { WordCloudLayoutWordV1 } from "./contracts";

export const WORD_CLOUD_MIN_FONT_SIZE = 14;
export const WORD_CLOUD_MAX_FONT_SIZE = 56;
export const WORD_CLOUD_SYNTHETIC_LINE_HEIGHT_PER_1000 = 1_200;
export const WORD_CLOUD_SYNTHETIC_HORIZONTAL_PADDING = 6;
export const WORD_CLOUD_SYNTHETIC_VERTICAL_PADDING = 4;
export const WORD_CLOUD_SYNTHETIC_SAFETY_MARGIN = 2;

export const WORD_CLOUD_ADVANCE_UNITS = Object.freeze({
  han: 1_000,
  latinUpper: 660,
  latinLower: 560,
  digit: 560,
  punctuation: 360,
  other: 900,
});

export interface SyntheticTextBox {
  readonly width: number;
  readonly height: number;
}

function advanceUnits(codePoint: string): number {
  if (/\p{Script=Han}/u.test(codePoint)) {
    return WORD_CLOUD_ADVANCE_UNITS.han;
  }
  if (/[A-Z]/u.test(codePoint)) {
    return WORD_CLOUD_ADVANCE_UNITS.latinUpper;
  }
  if (/\p{Script=Latin}/u.test(codePoint)) {
    return WORD_CLOUD_ADVANCE_UNITS.latinLower;
  }
  if (/\p{Nd}/u.test(codePoint)) {
    return WORD_CLOUD_ADVANCE_UNITS.digit;
  }
  if (/[\p{P}\p{S}]/u.test(codePoint)) {
    return WORD_CLOUD_ADVANCE_UNITS.punctuation;
  }
  return WORD_CLOUD_ADVANCE_UNITS.other;
}

export function syntheticTextBox(
  displayToken: string,
  fontSize: number,
): SyntheticTextBox {
  if (
    displayToken.length === 0 ||
    !Number.isSafeInteger(fontSize) ||
    fontSize < WORD_CLOUD_MIN_FONT_SIZE ||
    fontSize > WORD_CLOUD_MAX_FONT_SIZE
  ) {
    throw new Error("INVALID_SYNTHETIC_TEXT_METRICS_INPUT");
  }
  let totalAdvanceUnits = 0;
  for (const codePoint of displayToken) {
    totalAdvanceUnits += advanceUnits(codePoint);
  }
  const horizontalInset = 2 * (
    WORD_CLOUD_SYNTHETIC_HORIZONTAL_PADDING +
    WORD_CLOUD_SYNTHETIC_SAFETY_MARGIN
  );
  const verticalInset = 2 * (
    WORD_CLOUD_SYNTHETIC_VERTICAL_PADDING +
    WORD_CLOUD_SYNTHETIC_SAFETY_MARGIN
  );
  return {
    width: Math.ceil((totalAdvanceUnits * fontSize) / 1_000) + horizontalInset,
    height: Math.ceil(
      (WORD_CLOUD_SYNTHETIC_LINE_HEIGHT_PER_1000 * fontSize) / 1_000,
    ) + verticalInset,
  };
}

export function mapWordFontSizes(
  words: readonly WordCloudLayoutWordV1[],
): ReadonlyMap<string, number> {
  if (words.length === 0) {
    return new Map();
  }
  if (words.length === 1) {
    return new Map([[words[0]!.stableKey, WORD_CLOUD_MAX_FONT_SIZE]]);
  }
  const weights = words.map((word) => word.weight);
  const minimumWeight = Math.min(...weights);
  const maximumWeight = Math.max(...weights);
  if (minimumWeight === maximumWeight) {
    return new Map(words.map((word) => [
      word.stableKey,
      WORD_CLOUD_MIN_FONT_SIZE,
    ]));
  }
  const fontRange = WORD_CLOUD_MAX_FONT_SIZE - WORD_CLOUD_MIN_FONT_SIZE;
  return new Map(words.map((word) => {
    const normalized = Math.max(0, Math.min(
      1,
      (word.weight - minimumWeight) / (maximumWeight - minimumWeight),
    ));
    // Cubing keeps a heavy head visible while bringing a long tail quickly
    // toward the frozen minimum, avoiding browser-dependent auto fitting.
    const scaled = normalized * normalized * normalized;
    return [
      word.stableKey,
      WORD_CLOUD_MIN_FONT_SIZE + Math.round(fontRange * scaled),
    ];
  }));
}

export function fitSyntheticFontSize(
  displayToken: string,
  preferredFontSize: number,
  maximumWidth: number,
  maximumHeight: number,
): { readonly fontSize: number; readonly box: SyntheticTextBox } | null {
  const preferred = syntheticTextBox(displayToken, preferredFontSize);
  if (preferred.width <= maximumWidth && preferred.height <= maximumHeight) {
    return { fontSize: preferredFontSize, box: preferred };
  }
  const minimum = syntheticTextBox(displayToken, WORD_CLOUD_MIN_FONT_SIZE);
  return minimum.width <= maximumWidth && minimum.height <= maximumHeight
    ? { fontSize: WORD_CLOUD_MIN_FONT_SIZE, box: minimum }
    : null;
}
