import {
  CANONICAL_MESSAGE_CATEGORIES,
  type CanonicalMessageCategory,
} from "../canonical-v2/schema";
import {
  canonicalDateCode,
  type CanonicalAggregateSummary,
  type CanonicalAnalysisFilters,
} from "./analytics-contract";
import {
  activateSessionIndex,
  OWNER_SENDER_CODE,
  SYSTEM_SENDER_CODE,
  type CanonicalIndex,
} from "./canonical-index";
import type { SessionThresholdHours } from "./analytics-contract";

export interface SharedAggregateAccumulator {
  readonly eventCount: number;
  readonly userMessageCount: number;
  readonly eligibleTextCount: number;
  readonly systemEventCount: number;
  readonly messageCategoryCounts: Readonly<
    Record<CanonicalMessageCategory, number>
  >;
  readonly senderCounts: Readonly<{ owner: number; other: number }>;
  readonly unknownSenderCount: number;
  readonly eligibleTextCodePointCount: number;
  readonly tokenCount: number;
  readonly activeSessionThresholdHours: SessionThresholdHours;
  readonly hourCounts: Uint32Array;
  readonly weekdayCounts: Uint32Array;
}

function emptyCategoryCounts(): Record<CanonicalMessageCategory, number> {
  return Object.fromEntries(
    CANONICAL_MESSAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<CanonicalMessageCategory, number>;
}

function matchesSender(code: number, sender: CanonicalAnalysisFilters["sender"]): boolean {
  return (
    sender === "both" ||
    (sender === "owner" && code === OWNER_SENDER_CODE) ||
    (sender === "other" && code !== OWNER_SENDER_CODE && code !== SYSTEM_SENDER_CODE)
  );
}

export function createSharedAggregate(
  index: CanonicalIndex,
  filters: CanonicalAnalysisFilters,
): SharedAggregateAccumulator {
  const start = canonicalDateCode(filters.startDate);
  const end = canonicalDateCode(filters.endDate);
  const activeSessionThresholdHours = activateSessionIndex(
    index,
    filters.sessionThresholdHours,
  ).thresholdHours;
  const categoryCounts = emptyCategoryCounts();
  const senderCounts = { owner: 0, other: 0 };
  const hourCounts = new Uint32Array(24);
  const weekdayCounts = new Uint32Array(7);
  let eventCount = 0;
  let userMessageCount = 0;
  let eligibleTextCount = 0;
  let systemEventCount = 0;
  const unknownSenderCount = 0;
  let eligibleTextCodePointCount = 0;
  let tokenCount = 0;
  for (let record = 0; record < index.summary.indexedRecordCount; record += 1) {
    const date = index.calendarDates[record];
    if (date < start || date > end) {
      continue;
    }
    const senderCode = index.senderCodes[record];
    const isSystem = senderCode === SYSTEM_SENDER_CODE;
    if (isSystem) {
      eventCount += 1;
      systemEventCount += 1;
      continue;
    }
    if (senderCode === OWNER_SENDER_CODE) {
      senderCounts.owner += 1;
    } else {
      senderCounts.other += 1;
    }
    if (!matchesSender(senderCode, filters.sender)) {
      continue;
    }
    eventCount += 1;
    userMessageCount += 1;
    const category = CANONICAL_MESSAGE_CATEGORIES[index.categoryCodes[record]];
    categoryCounts[category] += 1;
    if (index.eligibleFlags[record] === 1) {
      eligibleTextCount += 1;
      eligibleTextCodePointCount += index.textLengths[record];
      tokenCount +=
        index.recordOffsets[record + 1] - index.recordOffsets[record];
    }
    hourCounts[index.hours[record]] += 1;
    weekdayCounts[index.weekdays[record]] += 1;
  }
  return {
    eventCount,
    userMessageCount,
    eligibleTextCount,
    systemEventCount,
    messageCategoryCounts: categoryCounts,
    senderCounts,
    unknownSenderCount,
    eligibleTextCodePointCount,
    tokenCount,
    activeSessionThresholdHours,
    hourCounts,
    weekdayCounts,
  };
}

export function aggregateSummary(
  accumulator: SharedAggregateAccumulator,
): CanonicalAggregateSummary {
  return {
    eventCount: accumulator.eventCount,
    userMessageCount: accumulator.userMessageCount,
    eligibleTextCount: accumulator.eligibleTextCount,
    systemEventCount: accumulator.systemEventCount,
    messageCategoryCounts: accumulator.messageCategoryCounts,
    senderCounts: accumulator.senderCounts,
    unknownSenderCount: accumulator.unknownSenderCount,
    eligibleTextCodePointCount: accumulator.eligibleTextCodePointCount,
    tokenCount: accumulator.tokenCount,
  };
}

export async function createSharedAggregateAsync(
  index: CanonicalIndex,
  filters: CanonicalAnalysisFilters,
  checkpoint: () => Promise<void>,
): Promise<SharedAggregateAccumulator> {
  const start = canonicalDateCode(filters.startDate);
  const end = canonicalDateCode(filters.endDate);
  const activeSessionThresholdHours = activateSessionIndex(
    index,
    filters.sessionThresholdHours,
  ).thresholdHours;
  const categoryCounts = emptyCategoryCounts();
  const senderCounts = { owner: 0, other: 0 };
  const hourCounts = new Uint32Array(24);
  const weekdayCounts = new Uint32Array(7);
  let eventCount = 0;
  let userMessageCount = 0;
  let eligibleTextCount = 0;
  let systemEventCount = 0;
  const unknownSenderCount = 0;
  let eligibleTextCodePointCount = 0;
  let tokenCount = 0;
  for (let record = 0; record < index.summary.indexedRecordCount; record += 1) {
    const date = index.calendarDates[record];
    if (date >= start && date <= end) {
      const senderCode = index.senderCodes[record];
      const isSystem = senderCode === SYSTEM_SENDER_CODE;
      if (isSystem) {
        eventCount += 1;
        systemEventCount += 1;
      } else {
        if (senderCode === OWNER_SENDER_CODE) {
          senderCounts.owner += 1;
        } else {
          senderCounts.other += 1;
        }
        if (!matchesSender(senderCode, filters.sender)) {
          continue;
        }
        eventCount += 1;
        userMessageCount += 1;
        const category = CANONICAL_MESSAGE_CATEGORIES[
          index.categoryCodes[record]
        ];
        categoryCounts[category] += 1;
        if (index.eligibleFlags[record] === 1) {
          eligibleTextCount += 1;
          eligibleTextCodePointCount += index.textLengths[record];
          tokenCount +=
            index.recordOffsets[record + 1] - index.recordOffsets[record];
        }
        hourCounts[index.hours[record]] += 1;
        weekdayCounts[index.weekdays[record]] += 1;
      }
    }
    if ((record + 1) % 4096 === 0) {
      await checkpoint();
    }
  }
  await checkpoint();
  return {
    eventCount,
    userMessageCount,
    eligibleTextCount,
    systemEventCount,
    messageCategoryCounts: categoryCounts,
    senderCounts,
    unknownSenderCount,
    eligibleTextCodePointCount,
    tokenCount,
    activeSessionThresholdHours,
    hourCounts,
    weekdayCounts,
  };
}
