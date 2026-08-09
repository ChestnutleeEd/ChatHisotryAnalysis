import { useMemo, useState } from "react";

import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import type {
  WorkerWordFrequencyDtoV1,
  WordFrequencyRole,
} from "../../worker-analysis/word-frequency-contract";
import { Badge, BaseCard, BetaButton, MethodologyDisclosure } from "./primitives";
import { BetaWordCloud } from "./BetaWordCloud";
import {
  BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION,
  readVocabularyCleanMode,
  writeVocabularyCleanMode,
} from "./clean-vocabulary";
import {
  createKeywordPresentation,
  createWordFrequencyPresentation,
  mergeCustomHiddenWords,
  parseCustomHiddenWords,
  readCustomHiddenWords,
  writeCustomHiddenWords,
  type WordFrequencyMetric,
} from "./word-presentation";

const ROLE_LABELS: Readonly<Record<WordFrequencyRole, string>> = {
  both: "双方",
  owner: "Owner",
  other: "Other",
};

export function BetaWordEvidenceSections({
  result,
  frequency,
  requestedRole,
  requestedYear,
  pending,
  error,
  onRoleChange,
}: {
  readonly result: CanonicalAnalysisResult;
  readonly frequency?: WorkerWordFrequencyDtoV1;
  readonly requestedRole: WordFrequencyRole;
  readonly requestedYear?: number | null;
  readonly pending: boolean;
  readonly error?: string;
  readonly onRoleChange: (role: WordFrequencyRole) => void;
}) {
  const [metric, setMetric] = useState<WordFrequencyMetric>("raw-count");
  const [cleanMode, setCleanMode] = useState(readVocabularyCleanMode);
  const [customHiddenWords, setCustomHiddenWords] = useState<readonly string[]>(readCustomHiddenWords);
  const [bulkValue, setBulkValue] = useState("");
  const scopedFrequency = frequency !== undefined &&
    frequency.identity.baseQueryKey === result.queryKey &&
    frequency.identity.datasetId === result.datasetId &&
    frequency.identity.generation === result.generation &&
    frequency.scope.year === result.filters.selectedYear &&
    frequency.scope.role === requestedRole
    ? frequency
    : undefined;
  const frequencyPresentation = useMemo(
    () => createWordFrequencyPresentation(scopedFrequency, customHiddenWords, metric, undefined, cleanMode),
    [cleanMode, customHiddenWords, metric, scopedFrequency],
  );
  const keywordPresentation = useMemo(
    () => createKeywordPresentation(result, customHiddenWords, undefined, cleanMode),
    [cleanMode, customHiddenWords, result],
  );
  const scopeIsRefreshing = pending && frequency !== undefined && scopedFrequency === undefined;

  function commitHidden(words: readonly string[]): void {
    setCustomHiddenWords(writeCustomHiddenWords(words));
  }

  function hideWord(token: string): void {
    commitHidden(mergeCustomHiddenWords(customHiddenWords, [token]));
  }

  function restoreWord(token: string): void {
    commitHidden(customHiddenWords.filter((word) => word !== token));
  }

  function addBulkWords(): void {
    commitHidden(mergeCustomHiddenWords(customHiddenWords, parseCustomHiddenWords(bulkValue)));
    setBulkValue("");
  }

  function changeCleanMode(enabled: boolean): void {
    setCleanMode(writeVocabularyCleanMode(enabled));
  }

  return (
    <div className="beta-word-evidence-scenes">
      <BaseCard id="frequent-words" variant="metric" className="beta-word-evidence-card">
        <div className="beta-word-evidence-heading">
          <div>
            <p className="beta-type-eyebrow">常用词 · 13</p>
            <h2 className="beta-type-heading">这一范围最常提到什么？</h2>
            <p className="beta-type-secondary">同一份本地词频结果同时保留出现次数与每万词频率；切换展示口径不会重新统计。</p>
          </div>
          <Badge tone={pending ? "partial" : "privacy"}>{pending ? "更新中" : "本地词频"}</Badge>
        </div>

        <fieldset className="beta-word-control-group" disabled={pending}>
          <legend>发送方范围</legend>
          {(["both", "owner", "other"] as const).map((role) => (
            <label key={role}>
              <input
                type="radio"
                name="beta-word-role"
                value={role}
                checked={requestedRole === role}
                onChange={() => onRoleChange(role)}
              />
              <span>{ROLE_LABELS[role]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="beta-word-control-group">
          <legend>显示口径</legend>
          <label>
            <input
              type="radio"
              name="beta-word-metric"
              checked={metric === "raw-count"}
              onChange={() => setMetric("raw-count")}
            />
            <span>原始次数</span>
          </label>
          <label>
            <input
              type="radio"
              name="beta-word-metric"
              checked={metric === "per-10000-eligible-tokens"}
              onChange={() => setMetric("per-10000-eligible-tokens")}
            />
            <span>每万词频率</span>
          </label>
        </fieldset>

        <fieldset className="beta-word-control-group beta-clean-mode-control">
          <legend>词汇展示</legend>
          <label>
            <input
              type="checkbox"
              checked={cleanMode}
              aria-describedby="beta-clean-mode-description"
              onChange={(event) => changeCleanMode(event.currentTarget.checked)}
            />
            <span>{cleanMode ? "已净化常用词" : "显示全部词"}</span>
          </label>
          <small id="beta-clean-mode-description">
            {cleanMode
              ? "已隐藏常见虚词和连接表达，只影响当前展示。"
              : "包含所有通过基础质量规则的词语。"}
          </small>
        </fieldset>

        {scopeIsRefreshing && frequency !== undefined ? (
          <p className="beta-word-status" role="status">
            正在更新为{ROLE_LABELS[requestedRole]}{requestedYear === null ? "全部年份" : requestedYear === undefined ? "" : `${requestedYear} 年`}范围；旧范围词频与词云不会显示。
          </p>
        ) : null}
        {error !== undefined ? <p className="beta-word-status" role="alert">{error}</p> : null}
        {frequencyPresentation.status === "unavailable" ? (
          <p className="beta-word-status" role="status">{pending ? "正在计算当前范围的有界词频列表。" : "当前词频证据尚未就绪。"}</p>
        ) : frequencyPresentation.status === "empty" ? (
          <p className="beta-word-status" role="status">当前年份、角色与已提交范围内没有符合内置质量策略的 eligible token。</p>
        ) : (
          <>
            <ol className="beta-word-ranking" aria-label="当前范围常用词排名">
              {frequencyPresentation.items.map((item) => (
                <li key={item.normalizedToken}>
                  <span className="beta-word-rank">{item.displayRank}</span>
                  <strong>{item.displayToken}</strong>
                  <span>
                    {metric === "raw-count"
                      ? `${item.count.toLocaleString("zh-CN")} 次`
                      : `${item.ratePer10000.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} / 万`}
                  </span>
                  <BetaButton variant="tertiary" onClick={() => hideWord(item.normalizedToken)}>隐藏</BetaButton>
                </li>
              ))}
            </ol>
            {frequencyPresentation.boundedPoolExhausted ? (
              <p className="beta-word-status">展示过滤已耗尽部分有界候选池，因此当前列表少于目标数量；分析分母与排名未改变。</p>
            ) : null}
            {frequencyPresentation.hiddenCandidateCount > 0 ? (
              <p className="beta-word-status">
                当前展示隐藏 {frequencyPresentation.hiddenCandidateCount} 个候选（净化 {frequencyPresentation.cleanHiddenCandidateCount} 个，自定义 {frequencyPresentation.customHiddenCandidateCount} 个），并已按底层顺序补位。
              </p>
            ) : null}
          </>
        )}

        <details className="beta-hidden-word-review">
          <summary>管理自定义隐藏词（{customHiddenWords.length}）</summary>
          <p>这里只过滤最多 400 个有界候选项，不会触发重新统计，也不会改变分析排名、次数、rate 或分母。</p>
          <label>
            <span>批量添加（逗号或换行分隔）</span>
            <textarea value={bulkValue} onChange={(event) => setBulkValue(event.currentTarget.value)} />
          </label>
          <div className="beta-hidden-word-actions">
            <BetaButton variant="secondary" disabled={parseCustomHiddenWords(bulkValue).length === 0} onClick={addBulkWords}>添加隐藏词</BetaButton>
            <BetaButton variant="tertiary" disabled={customHiddenWords.length === 0} onClick={() => commitHidden([])}>清空自定义隐藏</BetaButton>
          </div>
          {customHiddenWords.length > 0 ? (
            <ul className="beta-hidden-word-list" aria-label="当前自定义隐藏词">
              {customHiddenWords.map((word) => (
                <li key={word}><span>{word}</span><BetaButton variant="tertiary" onClick={() => restoreWord(word)}>恢复显示</BetaButton></li>
              ))}
            </ul>
          ) : <p>当前没有自定义隐藏词。</p>}
        </details>

        <MethodologyDisclosure summary="查看常用词统计口径" chips={["NFKC", "每万词频率", "最多 400 候选", cleanMode ? "净化展示开启" : "完整展示"]}>
          <p>原始次数是当前范围内的出现次数；每万词频率以当前角色、年份和内置词汇策略过滤后的 {frequencyPresentation.denominator?.eligibleTokenCount.toLocaleString("zh-CN") ?? "当前"} 个 eligible tokens 为分母。</p>
          <p>内置中英文停用词、纯数字、URL、标点/符号/emoji、单字符、不可见/控制字符、超过 32 个 code points、固定扩展名和无效 mixed fragments 会参与 eligibility 与分母。</p>
          <p>token 化后不能可靠还原全部邮箱或路径来源，因此只采用保守 token-shape 规则；不做 stemming、lemmatization、NER 或姓名推断，缩写默认保留。</p>
          <p>净化常用词使用 {BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION} 本地启发式列表，只过滤展示候选；不会改变原始次数、每万词频率、分母、底层排名或 frequencyDtoKey。</p>
        </MethodologyDisclosure>
      </BaseCard>

      <BaseCard id="distinctive-keywords" variant="narrative" className="beta-word-evidence-card" data-keyword-year={keywordPresentation.year ?? "all-years"}>
        <p className="beta-type-eyebrow">年度关键词 · 14</p>
        <h2 className="beta-type-heading">哪些词更能代表这一年？</h2>
        <p className="beta-type-report-lead">{keywordPresentation.explanation}</p>
        <p className="beta-type-metadata">年度关键词展示范围：{keywordPresentation.year === null ? "全部年份（不适用）" : `${keywordPresentation.year} 年`}</p>
        {keywordPresentation.items.length === 0 ? (
          <p className="beta-word-status">当前没有可展示的年度关键词证据。</p>
        ) : (
          <ol className="beta-keyword-ranking" aria-label="年度关键词展示排名">
            {keywordPresentation.items.map((item) => (
              <li key={item.normalizedToken}>
                <span>{item.displayRank}</span>
                <strong>{item.displayToken}</strong>
                <small>{item.count.toLocaleString("zh-CN")} 次</small>
                <BetaButton variant="tertiary" onClick={() => hideWord(item.normalizedToken)}>隐藏</BetaButton>
              </li>
            ))}
          </ol>
        )}
        <MethodologyDisclosure summary="查看年度关键词统计口径" chips={[keywordPresentation.mode === "frequency-fallback" ? "频次回退" : keywordPresentation.mode === "log-odds" ? "year-vs-rest log-odds" : "当前范围不适用"]}>
          <p>年度关键词继续使用现有 Stage7 的候选阈值与平滑 year-vs-rest log-odds。常用词的 count/rate 与关键词的 distinctiveness score 是两种独立语义。</p>
          <p>净化常用词只隐藏展示行并从既有候选顺序补位，不重新计算或改写 score、count、DF 与底层排名。</p>
        </MethodologyDisclosure>
      </BaseCard>

      <BetaWordCloud
        frequency={scopedFrequency}
        metric={metric}
        customHiddenWords={customHiddenWords}
        cleanMode={cleanMode}
        pending={pending}
        onHideWord={hideWord}
      />
    </div>
  );
}
