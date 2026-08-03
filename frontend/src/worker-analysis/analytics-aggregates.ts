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
  OWNER_SENDER_CODE,
  SYSTEM_SENDER_CODE,
  type CanonicalIndex,
} from "./canonical-index";
import type { SessionThresholdHours } from "./analytics-contract";
import {
  buildConversationSessionIndex,
  buildConversationSessionIndexAsync,
  type ConversationSessionIndex,
} from "./reply-session-metrics";

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
  readonly conversationIndex: ConversationSessionIndex;
  readonly hourCounts: Uint32Array;
  readonly weekdayCounts: Uint32Array;
  readonly selectedDayCounts: ReadonlyMap<number, number>;
  readonly yearlyTokenEvidence: ReadonlyMap<number, YearTokenAggregate>;
  readonly eligibleTextLengths: EligibleTextLengthAggregate;
}

export interface YearTokenAggregate {
  readonly year: number;
  readonly messageCount: number;
  readonly tokenTotal: number;
  readonly tokenCounts: ReadonlyMap<number, number>;
  readonly messageFrequencies: ReadonlyMap<number, number>;
}

export interface EligibleTextLengthAggregate {
  readonly overall: readonly number[];
  readonly owner: readonly number[];
  readonly other: readonly number[];
}

interface MutableYearTokenAggregate {
  readonly year: number;
  messageCount: number;
  tokenTotal: number;
  readonly tokenCounts: Map<number, number>;
  readonly messageFrequencies: Map<number, number>;
}

interface MutableEligibleTextLengthAggregate {
  readonly overall: number[];
  readonly owner: number[];
  readonly other: number[];
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

function addStage7Evidence(
  index: CanonicalIndex,
  record: number,
  years: Map<number, MutableYearTokenAggregate>,
  lengths: MutableEligibleTextLengthAggregate,
): void {
  const year = index.years[record];
  const state = years.get(year) ?? {
    year,
    messageCount: 0,
    tokenTotal: 0,
    tokenCounts: new Map<number, number>(),
    messageFrequencies: new Map<number, number>(),
  };
  state.messageCount += 1;
  years.set(year, state);
  if (index.eligibleFlags[record] !== 1) {
    return;
  }
  const length = index.textLengths[record];
  lengths.overall.push(length);
  if (index.senderCodes[record] === OWNER_SENDER_CODE) {
    lengths.owner.push(length);
  } else {
    lengths.other.push(length);
  }
  const seen = new Set<number>();
  for (
    let cursor = index.recordOffsets[record];
    cursor < index.recordOffsets[record + 1];
    cursor += 1
  ) {
    const tokenId = index.tokenIds[cursor];
    state.tokenTotal += 1;
    state.tokenCounts.set(tokenId, (state.tokenCounts.get(tokenId) ?? 0) + 1);
    seen.add(tokenId);
  }
  for (const tokenId of seen) {
    state.messageFrequencies.set(
      tokenId,
      (state.messageFrequencies.get(tokenId) ?? 0) + 1,
    );
  }
}

function finishStage7Evidence(
  years: Map<number, MutableYearTokenAggregate>,
  lengths: MutableEligibleTextLengthAggregate,
): {
  readonly yearlyTokenEvidence: ReadonlyMap<number, YearTokenAggregate>;
  readonly eligibleTextLengths: EligibleTextLengthAggregate;
} {
  return {
    yearlyTokenEvidence: new Map(
      [...years.entries()].map(([year, state]) => [year, {
        year: state.year,
        messageCount: state.messageCount,
        tokenTotal: state.tokenTotal,
        tokenCounts: state.tokenCounts,
        messageFrequencies: state.messageFrequencies,
      }]),
    ),
    eligibleTextLengths: {
      overall: lengths.overall,
      owner: lengths.owner,
      other: lengths.other,
    },
  };
}

export function createSharedAggregate(
  index: CanonicalIndex,
  filters: CanonicalAnalysisFilters,
): SharedAggregateAccumulator {
  const start = canonicalDateCode(filters.startDate);
  const end = canonicalDateCode(filters.endDate);
  const conversationIndex = buildConversationSessionIndex(
    index,
    filters.sessionThresholdHours,
  );
  const categoryCounts = emptyCategoryCounts();
  const senderCounts = { owner: 0, other: 0 };
  const hourCounts = new Uint32Array(24);
  const weekdayCounts = new Uint32Array(7);
  const selectedDayCounts = new Map<number, number>();
  const yearlyTokenEvidence = new Map<number, MutableYearTokenAggregate>();
  const eligibleTextLengths: MutableEligibleTextLengthAggregate = {
    overall: [],
    owner: [],
    other: [],
  };
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
    addStage7Evidence(index, record, yearlyTokenEvidence, eligibleTextLengths);
    if (index.eligibleFlags[record] === 1) {
      eligibleTextCount += 1;
      eligibleTextCodePointCount += index.textLengths[record];
      tokenCount +=
        index.recordOffsets[record + 1] - index.recordOffsets[record];
    }
    hourCounts[index.hours[record]] += 1;
    weekdayCounts[index.weekdays[record]] += 1;
    const day = index.calendarDays[record];
    selectedDayCounts.set(day, (selectedDayCounts.get(day) ?? 0) + 1);
  }
  const stage7Evidence = finishStage7Evidence(
    yearlyTokenEvidence,
    eligibleTextLengths,
  );
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
    activeSessionThresholdHours: conversationIndex.thresholdHours,
    conversationIndex,
    hourCounts,
    weekdayCounts,
    selectedDayCounts,
    ...stage7Evidence,
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
  conversationIndex?: ConversationSessionIndex,
): Promise<SharedAggregateAccumulator> {
  const start = canonicalDateCode(filters.startDate);
  const end = canonicalDateCode(filters.endDate);
  const activeConversationIndex =
    conversationIndex ??
    (await buildConversationSessionIndexAsync(
      index,
      filters.sessionThresholdHours,
      async () => {
        await checkpoint();
      },
    ));
  const categoryCounts = emptyCategoryCounts();
  const senderCounts = { owner: 0, other: 0 };
  const hourCounts = new Uint32Array(24);
  const weekdayCounts = new Uint32Array(7);
  const selectedDayCounts = new Map<number, number>();
  const yearlyTokenEvidence = new Map<number, MutableYearTokenAggregate>();
  const eligibleTextLengths: MutableEligibleTextLengthAggregate = {
    overall: [],
    owner: [],
    other: [],
  };
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
        addStage7Evidence(index, record, yearlyTokenEvidence, eligibleTextLengths);
        if (index.eligibleFlags[record] === 1) {
          eligibleTextCount += 1;
          eligibleTextCodePointCount += index.textLengths[record];
          tokenCount +=
            index.recordOffsets[record + 1] - index.recordOffsets[record];
        }
        hourCounts[index.hours[record]] += 1;
        weekdayCounts[index.weekdays[record]] += 1;
        const day = index.calendarDays[record];
        selectedDayCounts.set(day, (selectedDayCounts.get(day) ?? 0) + 1);
      }
    }
    if ((record + 1) % 4096 === 0) {
      await checkpoint();
    }
  }
  await checkpoint();
  const stage7Evidence = finishStage7Evidence(
    yearlyTokenEvidence,
    eligibleTextLengths,
  );
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
    activeSessionThresholdHours: activeConversationIndex.thresholdHours,
    conversationIndex: activeConversationIndex,
    hourCounts,
    weekdayCounts,
    selectedDayCounts,
    ...stage7Evidence,
  };
}
