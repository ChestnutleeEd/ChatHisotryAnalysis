import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalEventV2,
  type CanonicalMessageCategory,
} from "../canonical-v2/schema";
import {
  canonicalDateCode,
  DEFAULT_SESSION_THRESHOLD_HOURS,
  SESSION_THRESHOLD_HOURS,
  type CanonicalDatasetSummary,
  type CanonicalIndexSummary,
  type SessionThresholdHours,
} from "./analytics-contract";
import {
  calendarDayOrdinal,
  calendarWeekdayIndex,
} from "./calendar";

export const OWNER_SENDER_CODE = 0;
export const OTHER_SENDER_CODE = 1;
export const SYSTEM_SENDER_CODE = 2;

export interface ActiveSessionIndexSeam {
  readonly thresholdHours: SessionThresholdHours;
  readonly sortedUserRecordIndexes: Uint32Array;
}

const UINT32_MAX = 4_294_967_295;

function categoryCode(category: CanonicalMessageCategory): number {
  const code = CANONICAL_MESSAGE_CATEGORIES.indexOf(category);
  if (code < 0) {
    throw new Error("INVALID_CATEGORY");
  }
  return code;
}

function weekdayCode(calendarDate: string): number {
  return calendarWeekdayIndex(calendarDate);
}

class GrowableUint32 {
  private storage = new Uint32Array(1024);
  private lengthValue = 0;

  get length(): number {
    return this.lengthValue;
  }

  push(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new Error("INDEX_LIMIT");
    }
    if (this.lengthValue === this.storage.length) {
      const next = new Uint32Array(this.storage.length * 2);
      next.set(this.storage);
      this.storage = next;
    }
    this.storage[this.lengthValue] = value;
    this.lengthValue += 1;
  }

  finish(): Uint32Array {
    return this.storage.slice(0, this.lengthValue);
  }
}

export interface CanonicalIndex {
  readonly createTimes: Float64Array;
  readonly calendarDates: Uint32Array;
  readonly calendarDays: Int32Array;
  readonly years: Uint16Array;
  readonly months: Uint8Array;
  readonly hours: Uint8Array;
  readonly weekdays: Uint8Array;
  readonly senderCodes: Uint8Array;
  readonly categoryCodes: Uint8Array;
  readonly eligibleFlags: Uint8Array;
  readonly textLengths: Uint32Array;
  readonly fileRanks: Uint32Array;
  readonly sourceIndexes: Uint32Array;
  readonly tokenIds: Uint32Array;
  readonly recordOffsets: Uint32Array;
  readonly tokenTable: readonly string[];
  readonly sessionIndex: ActiveSessionIndexSeam;
  readonly dataset: CanonicalDatasetSummary;
  readonly summary: CanonicalIndexSummary;
}

export class CanonicalIndexBuilder {
  private readonly createTimes: Float64Array;
  private readonly calendarDates: Uint32Array;
  private readonly calendarDays: Int32Array;
  private readonly years: Uint16Array;
  private readonly months: Uint8Array;
  private readonly hours: Uint8Array;
  private readonly weekdays: Uint8Array;
  private readonly senderCodes: Uint8Array;
  private readonly categoryCodes: Uint8Array;
  private readonly eligibleFlags: Uint8Array;
  private readonly textLengths: Uint32Array;
  private readonly fileRanks: Uint32Array;
  private readonly sourceIndexes: Uint32Array;
  private readonly recordOffsets: Uint32Array;
  private readonly tokenIds = new GrowableUint32();
  private readonly tokenTable: string[] = [];
  private tokenMap: Map<string, number> | undefined = new Map();
  private records = 0;
  private eligibleTextCodePointCount = 0;

  constructor(private readonly expectedRecords: number) {
    if (
      !Number.isSafeInteger(expectedRecords) ||
      expectedRecords < 1 ||
      expectedRecords > 2_000_000
    ) {
      throw new Error("INDEX_LIMIT");
    }
    this.createTimes = new Float64Array(expectedRecords);
    this.calendarDates = new Uint32Array(expectedRecords);
    this.calendarDays = new Int32Array(expectedRecords);
    this.years = new Uint16Array(expectedRecords);
    this.months = new Uint8Array(expectedRecords);
    this.hours = new Uint8Array(expectedRecords);
    this.weekdays = new Uint8Array(expectedRecords);
    this.senderCodes = new Uint8Array(expectedRecords);
    this.categoryCodes = new Uint8Array(expectedRecords);
    this.eligibleFlags = new Uint8Array(expectedRecords);
    this.textLengths = new Uint32Array(expectedRecords);
    this.fileRanks = new Uint32Array(expectedRecords);
    this.sourceIndexes = new Uint32Array(expectedRecords);
    this.recordOffsets = new Uint32Array(expectedRecords + 1);
  }

  append(event: CanonicalEventV2, tokens: readonly string[]): void {
    if (this.records >= this.expectedRecords) {
      throw new Error("COUNT_MISMATCH");
    }
    const tokenMap = this.tokenMap;
    if (tokenMap === undefined) {
      throw new Error("INDEX_RELEASED");
    }
    const dateCode = canonicalDateCode(event.calendarDate);
    this.createTimes[this.records] = event.createTime;
    this.calendarDates[this.records] = dateCode;
    this.calendarDays[this.records] = calendarDayOrdinal(event.calendarDate);
    this.years[this.records] = Number(event.calendarDate.slice(0, 4));
    this.months[this.records] = Number(event.calendarDate.slice(5, 7));
    this.hours[this.records] = Number(event.formattedTime.slice(11, 13));
    this.weekdays[this.records] = weekdayCode(event.calendarDate);
    this.senderCodes[this.records] =
      event.messageCategory === "system"
        ? SYSTEM_SENDER_CODE
        : event.senderScope === "owner"
          ? OWNER_SENDER_CODE
          : OTHER_SENDER_CODE;
    this.categoryCodes[this.records] = categoryCode(event.messageCategory);
    this.eligibleFlags[this.records] = event.textEligible ? 1 : 0;
    this.fileRanks[this.records] = event.fileRank;
    this.sourceIndexes[this.records] = event.sourceIndex;
    this.recordOffsets[this.records] = this.tokenIds.length;
    if (event.textEligible) {
      const codePointLength = [...(event.content ?? "")].length;
      if (codePointLength > UINT32_MAX) {
        throw new Error("INDEX_LIMIT");
      }
      this.textLengths[this.records] = codePointLength;
      this.eligibleTextCodePointCount += codePointLength;
    }
    for (const token of tokens) {
      let tokenId = tokenMap.get(token);
      if (tokenId === undefined) {
        tokenId = this.tokenTable.length;
        if (tokenId > UINT32_MAX) {
          throw new Error("INDEX_LIMIT");
        }
        this.tokenTable.push(token);
        tokenMap.set(token, tokenId);
      }
      this.tokenIds.push(tokenId);
    }
    this.records += 1;
  }

  finish(dataset: CanonicalDatasetSummary): CanonicalIndex {
    if (this.records !== this.expectedRecords) {
      throw new Error("COUNT_MISMATCH");
    }
    this.recordOffsets[this.records] = this.tokenIds.length;
    this.tokenMap = undefined;
    const tokenIds = this.tokenIds.finish();
    const userRecordCount = this.senderCodes.reduce(
      (count, senderCode) =>
        count + (senderCode === SYSTEM_SENDER_CODE ? 0 : 1),
      0,
    );
    const sortedUserRecordIndexes = new Uint32Array(userRecordCount);
    let userRecordIndex = 0;
    for (let record = 0; record < this.records; record += 1) {
      if (this.senderCodes[record] !== SYSTEM_SENDER_CODE) {
        sortedUserRecordIndexes[userRecordIndex] = record;
        userRecordIndex += 1;
      }
    }
    const typedArrayBytes =
      this.createTimes.byteLength +
      this.calendarDates.byteLength +
      this.calendarDays.byteLength +
      this.years.byteLength +
      this.months.byteLength +
      this.hours.byteLength +
      this.weekdays.byteLength +
      this.senderCodes.byteLength +
      this.categoryCodes.byteLength +
      this.eligibleFlags.byteLength +
      this.textLengths.byteLength +
      this.fileRanks.byteLength +
      this.sourceIndexes.byteLength +
      this.recordOffsets.byteLength +
      tokenIds.byteLength +
      sortedUserRecordIndexes.byteLength;
    return {
      createTimes: this.createTimes,
      calendarDates: this.calendarDates,
      calendarDays: this.calendarDays,
      years: this.years,
      months: this.months,
      hours: this.hours,
      weekdays: this.weekdays,
      senderCodes: this.senderCodes,
      categoryCodes: this.categoryCodes,
      eligibleFlags: this.eligibleFlags,
      textLengths: this.textLengths,
      fileRanks: this.fileRanks,
      sourceIndexes: this.sourceIndexes,
      tokenIds,
      recordOffsets: this.recordOffsets,
      tokenTable: this.tokenTable,
      sessionIndex: {
        thresholdHours: DEFAULT_SESSION_THRESHOLD_HOURS,
        sortedUserRecordIndexes,
      },
      dataset,
      summary: {
        indexedRecordCount: this.records,
        eligibleTextCodePointCount: this.eligibleTextCodePointCount,
        tokenCount: tokenIds.length,
        distinctTokenCount: this.tokenTable.length,
        typedArrayBytes,
      },
    };
  }
}

export function activateSessionIndex(
  index: CanonicalIndex,
  thresholdHours: SessionThresholdHours,
): ActiveSessionIndexSeam {
  if (!SESSION_THRESHOLD_HOURS.includes(thresholdHours)) {
    throw new Error("INVALID_SESSION_THRESHOLD");
  }
  return {
    thresholdHours,
    sortedUserRecordIndexes: index.sessionIndex.sortedUserRecordIndexes,
  };
}
