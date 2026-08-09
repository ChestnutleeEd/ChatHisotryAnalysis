import type { DatasetId, Generation } from "../../desktop/ipc-contract";
import { canonicalQueryKey } from "../../worker-analysis/analytics-contract";
import {
  WORD_FREQUENCY_SCHEMA_VERSION,
  WORD_FREQUENCY_TIMEZONE,
  frequencyDtoKey,
  type WorkerWordFrequencyDtoV1,
  type WordFrequencyRole,
} from "../../worker-analysis/word-frequency-contract";
import {
  BETA_VOCABULARY_DENOMINATOR_DEFINITION,
  BETA_VOCABULARY_POLICY_HASH,
  BETA_VOCABULARY_POLICY_VERSION,
} from "../../worker-analysis/vocabulary-policy";

const FIXTURE_DATASET_ID =
  "dat_000000000000000000000000000000f1" as DatasetId;
const FIXTURE_GENERATION = 1 as Generation;

export function syntheticBetaWordCloudFrequency(
  year: number | null,
  role: WordFrequencyRole,
): WorkerWordFrequencyDtoV1 {
  const filters = {
    startDate: year === null ? "2024-01-01" : year === 2025 ? "2025-02-01" : `${year}-01-01`,
    endDate: year === null ? "2025-12-31" : `${year}-12-31`,
    sender: "both" as const,
    selectedYear: year,
    sessionThresholdHours: 6 as const,
  };
  const baseQueryKey = canonicalQueryKey(
    FIXTURE_DATASET_ID,
    FIXTURE_GENERATION,
    filters,
  );
  const denominator = year === null ? 18_400 : year === 2024 ? 8_900 : 9_500;
  const cleanWords = ["但是", "然后", "所以", "这个", "已经", "就是", "其实", "还有", "the", "and"];
  const scopeWords = year === 2024
    ? ["海边计划", "相册整理", "冬日散步", "旧城地图", "周末路线", "照片备份", "晚餐清单", "阅读笔记", "电影片单", "旅行手册"]
    : year === 2025
      ? ["本地版本", "年度报告", "词云布局", "发布计划", "测试矩阵", "界面修订", "离线分析", "范围同步", "性能记录", "隐私边界"]
      : ["共同回顾", "年度趋势", "本地分析", "消息节奏", "长期计划", "内容主题", "时间分布", "双方词频", "离线报告", "数据年鉴"];
  const candidateWords = [
    ...cleanWords,
    ...scopeWords,
    ...Array.from({ length: 30 }, (_, index) => `synthetic${year ?? "all"}${String(index).padStart(2, "0")}`),
  ];
  const items = candidateWords.slice(0, 42).map((token, index) => {
    const count = 420 - index * 7 + (role === "owner" ? 18 : role === "other" ? 9 : 0);
    const category = /^[\p{Script=Han}]+$/u.test(token)
      ? "han"
      : /^[a-z]+$/u.test(token)
        ? "latin"
        : "mixed";
    return {
      normalizedToken: token,
      count,
      ratePer10000: (count * 10_000) / denominator,
      rank: index + 1,
      category,
      qualityFlags: [],
    } as const;
  });
  return {
    schemaVersion: WORD_FREQUENCY_SCHEMA_VERSION,
    identity: {
      datasetId: FIXTURE_DATASET_ID,
      generation: FIXTURE_GENERATION,
      baseQueryKey,
      frequencyDtoKey: frequencyDtoKey(
        FIXTURE_DATASET_ID,
        FIXTURE_GENERATION,
        baseQueryKey,
        role,
      ),
    },
    scope: {
      timezone: WORD_FREQUENCY_TIMEZONE,
      year,
      role,
    },
    denominator: {
      eligibleTokenCount: denominator,
      definition: BETA_VOCABULARY_DENOMINATOR_DEFINITION,
      status: "ready",
      emptyReason: null,
    },
    policy: {
      version: BETA_VOCABULARY_POLICY_VERSION,
      builtInPolicyHash: BETA_VOCABULARY_POLICY_HASH,
    },
    items,
  };
}
