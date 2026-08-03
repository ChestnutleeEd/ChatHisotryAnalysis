import { METRIC_DEFINITION_VERSIONS } from "../canonical-v2/schema";
import type { DatasetId, Generation } from "../desktop/ipc-contract";
import type { CanonicalAnalysisFilters } from "./analytics-contract";

export const ANALYTICS_RESULT_CONTRACT_VERSION =
  "chat-history-analysis.analytics-result.v3" as const;
export const WORKER_QUERY_TIMEZONE = "UTC+08:00" as const;
export const WORKER_QUERY_REQUEST_VERSION =
  "chat-history-analysis.aggregate-query.v1" as const;

const WORKER_QUERY_METRIC_DEFINITIONS = [
  METRIC_DEFINITION_VERSIONS.population,
  METRIC_DEFINITION_VERSIONS.time,
  METRIC_DEFINITION_VERSIONS.tokens,
  METRIC_DEFINITION_VERSIONS.keywords,
  METRIC_DEFINITION_VERSIONS.sessions,
] as const;

const DATASET_ID_PATTERN = /^dat_[0-9a-f]{32}$/u;
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SENDERS = new Set(["both", "owner", "other"]);
const SESSION_THRESHOLDS = new Set([1, 3, 6, 12, 24]);

export function canonicalQueryKey(
  datasetId: DatasetId | null,
  generation: Generation,
  filters: CanonicalAnalysisFilters,
): string {
  return JSON.stringify([
    datasetId,
    generation,
    filters.startDate,
    filters.endDate,
    filters.sender,
    filters.selectedYear,
    filters.sessionThresholdHours,
    WORKER_QUERY_TIMEZONE,
    WORKER_QUERY_REQUEST_VERSION,
    ANALYTICS_RESULT_CONTRACT_VERSION,
    WORKER_QUERY_METRIC_DEFINITIONS,
  ]);
}

export function isCanonicalWorkerQueryKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return false;
  }
  if (JSON.stringify(parsed) !== value || !Array.isArray(parsed) || parsed.length !== 11) {
    return false;
  }
  const [datasetId, generation, startDate, endDate, sender, selectedYear, threshold, timezone, requestVersion, contractVersion, metricDefinitions] = parsed;
  return (
    (datasetId === null || (typeof datasetId === "string" && DATASET_ID_PATTERN.test(datasetId))) &&
    Number.isSafeInteger(generation) &&
    (generation as number) > 0 &&
    isCalendarDate(startDate) &&
    isCalendarDate(endDate) &&
    startDate <= endDate &&
    typeof sender === "string" &&
    SENDERS.has(sender) &&
    (selectedYear === null ||
      (Number.isSafeInteger(selectedYear) &&
        (selectedYear as number) >= 1 &&
        (selectedYear as number) <= 9999)) &&
    typeof threshold === "number" &&
    SESSION_THRESHOLDS.has(threshold) &&
    timezone === WORKER_QUERY_TIMEZONE &&
    requestVersion === WORKER_QUERY_REQUEST_VERSION &&
    contractVersion === ANALYTICS_RESULT_CONTRACT_VERSION &&
    Array.isArray(metricDefinitions) &&
    metricDefinitions.length === WORKER_QUERY_METRIC_DEFINITIONS.length &&
    metricDefinitions.every(
      (item, index) => item === WORKER_QUERY_METRIC_DEFINITIONS[index],
    )
  );
}

export function isWorkerQueryKeyBoundTo(
  value: unknown,
  datasetId: DatasetId,
  generation: Generation,
): value is string {
  if (!isCanonicalWorkerQueryKey(value)) {
    return false;
  }
  const parsed = JSON.parse(value) as unknown[];
  return parsed[0] === datasetId && parsed[1] === generation;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
