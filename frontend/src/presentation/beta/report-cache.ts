import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import {
  betaReportQueryKey,
  createBetaReportQuery,
  type BetaReportDtoV1,
  type BetaReportMode,
} from "./report-contract";
import {
  buildBetaReportDto,
  type BetaReportAdapterOptions,
} from "./report-adapter";

export const BETA_REPORT_CACHE_LIMIT = 8 as const;

export interface BetaReportCacheKeyInput {
  readonly datasetId: CanonicalAnalysisResult["datasetId"];
  readonly generation: CanonicalAnalysisResult["generation"];
  readonly baseQueryKey: string;
  readonly mode: BetaReportMode;
  readonly year: number | null;
}

function cacheKey(input: BetaReportCacheKeyInput): string {
  return betaReportQueryKey(createBetaReportQuery(
    input.datasetId,
    input.generation,
    input.baseQueryKey,
    input.mode,
    input.year,
  ));
}

export class BetaReportFactsCache {
  private readonly entries = new Map<string, BetaReportDtoV1>();

  get(input: BetaReportCacheKeyInput): BetaReportDtoV1 | undefined {
    const key = cacheKey(input);
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(input: BetaReportCacheKeyInput, dto: BetaReportDtoV1): BetaReportDtoV1 {
    const key = cacheKey(input);
    this.entries.delete(key);
    this.entries.set(key, dto);
    while (this.entries.size > BETA_REPORT_CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
    return dto;
  }

  getOrCreate(
    input: BetaReportCacheKeyInput,
    create: () => BetaReportDtoV1,
  ): BetaReportDtoV1 {
    return this.get(input) ?? this.set(input, create());
  }

  getForResult(
    result: CanonicalAnalysisResult,
    options: BetaReportAdapterOptions,
  ): BetaReportDtoV1 {
    const input: BetaReportCacheKeyInput = {
      datasetId: result.datasetId,
      generation: result.generation,
      baseQueryKey: result.queryKey,
      mode: options.mode,
      year: options.year,
    };
    return this.getOrCreate(input, () => buildBetaReportDto(result, options));
  }

  clear(): void {
    this.entries.clear();
  }

  clearForDatasetGeneration(
    datasetId: CanonicalAnalysisResult["datasetId"],
    generation: CanonicalAnalysisResult["generation"],
  ): void {
    for (const [key, dto] of this.entries) {
      if (dto.identity.datasetId === datasetId && dto.identity.generation === generation) {
        this.entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export function betaReportCacheKey(input: BetaReportCacheKeyInput): string {
  return cacheKey(input);
}
