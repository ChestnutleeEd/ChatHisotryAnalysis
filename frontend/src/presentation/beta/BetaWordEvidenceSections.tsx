import { useMemo, useState, type CSSProperties } from "react";

import type { CanonicalAnalysisResult } from "../../worker-analysis/analytics-contract";
import type {
  WorkerWordFrequencyDtoV1,
  WordFrequencyRole,
} from "../../worker-analysis/word-frequency-contract";
import { Badge, BetaButton, MethodologyDisclosure, ToggleChip } from "./primitives";
import { BetaWordCloud } from "./BetaWordCloud";
import {
  BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION,
  readVocabularyCleanMode,
  writeVocabularyCleanMode,
} from "./clean-vocabulary";
import {
  classifyVocabularyComposition,
  createKeywordPresentation,
  createWordFrequencyPresentation,
  KEYWORD_FIELD_SLOT_COUNT,
  keywordFieldSlot,
  mergeCustomHiddenWords,
  parseCustomHiddenWords,
  readCustomHiddenWords,
  writeCustomHiddenWords,
  type KeywordPresentationItem,
  type WordFrequencyPresentationItem,
  type WordFrequencyMetric,
} from "./word-presentation";

const ROLE_LABELS: Readonly<Record<WordFrequencyRole, string>> = {
  both: "双方",
  owner: "Owner",
  other: "Other",
};

const DEFAULT_VISIBLE_WORDS = 8;

function formatWordMetric(item: WordFrequencyPresentationItem, metric: WordFrequencyMetric): string {
  return metric === "raw-count"
    ? `${item.count.toLocaleString("zh-CN")} 次`
    : `${item.ratePer10000.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} / 万`;
}

function FrequencyRanking({
  items,
  metric,
  onHideWord,
  className = "beta-word-ranking",
}: {
  readonly items: readonly WordFrequencyPresentationItem[];
  readonly metric: WordFrequencyMetric;
  readonly onHideWord: (token: string) => void;
  readonly className?: string;
}) {
  return (
    <ol className={className} aria-label="当前范围常用词排名">
      {items.map((item) => (
        <li key={item.normalizedToken} data-rank={item.displayRank}>
          <span className="beta-word-rank">{item.displayRank}</span>
          <strong>{item.displayToken}</strong>
          <span className="beta-word-count">{formatWordMetric(item, metric)}</span>
          <BetaButton variant="tertiary" onClick={() => onHideWord(item.normalizedToken)}>隐藏</BetaButton>
        </li>
      ))}
    </ol>
  );
}

function FrequencyPodium({
  items,
  metric,
  onHideWord,
}: {
  readonly items: readonly WordFrequencyPresentationItem[];
  readonly metric: WordFrequencyMetric;
  readonly onHideWord: (token: string) => void;
}) {
  return (
    <ol className="v3-frequent-heroes" aria-label="当前范围常用词前三名">
      {items.map((item) => (
        <li key={item.normalizedToken} data-rank={item.displayRank} style={{ "--v3-word-rank": item.displayRank } as CSSProperties}>
          <span className="v3-frequent-rank" aria-hidden="true">{String(item.displayRank).padStart(2, "0")}</span>
          <strong title={item.displayToken}>{item.displayToken}</strong>
          <span className="v3-frequent-evidence">第 {item.displayRank} 名 · {formatWordMetric(item, metric)}</span>
          <BetaButton variant="tertiary" aria-label={`隐藏常用词 ${item.displayToken}`} onClick={() => onHideWord(item.normalizedToken)}>隐藏</BetaButton>
        </li>
      ))}
    </ol>
  );
}

function KeywordRanking({
  items,
  onHideWord,
  className = "beta-keyword-ranking",
}: {
  readonly items: readonly KeywordPresentationItem[];
  readonly onHideWord: (token: string) => void;
  readonly className?: string;
}) {
  return (
    <ol className={className} aria-label="年度关键词固定位置展示">
      {items.map((item) => (
        <li
          key={item.normalizedToken}
          data-rank={item.displayRank}
          data-keyword-slot={keywordFieldSlot(item.displayRank)}
          style={{ "--v3-keyword-index": item.displayRank } as CSSProperties}
        >
          <span className="beta-keyword-rank">{item.displayRank}</span>
          <strong>{item.displayToken}</strong>
          <small>{item.count.toLocaleString("zh-CN")} 次 · 年度区分候选</small>
          <BetaButton variant="tertiary" aria-label={`隐藏年度关键词 ${item.displayToken}`} onClick={() => onHideWord(item.normalizedToken)}>隐藏</BetaButton>
        </li>
      ))}
    </ol>
  );
}

export function BetaWordEvidenceSections({
  result,
  frequency,
  requestedRole,
  requestedYear,
  pending,
  error,
  onRoleChange,
  onSelectYear,
}: {
  readonly result: CanonicalAnalysisResult;
  readonly frequency?: WorkerWordFrequencyDtoV1;
  readonly requestedRole: WordFrequencyRole;
  readonly requestedYear?: number | null;
  readonly pending: boolean;
  readonly error?: string;
  readonly onRoleChange: (role: WordFrequencyRole) => void;
  readonly onSelectYear?: () => void;
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
  const currentFrequency = error === undefined ? scopedFrequency : undefined;
  const frequencyPresentation = useMemo(
    () => createWordFrequencyPresentation(currentFrequency, customHiddenWords, metric, undefined, cleanMode),
    [cleanMode, currentFrequency, customHiddenWords, metric],
  );
  const keywordPresentation = useMemo(
    () => createKeywordPresentation(result, customHiddenWords, undefined, cleanMode),
    [cleanMode, customHiddenWords, result],
  );
  const visibleFrequencyItems = frequencyPresentation.items.slice(0, DEFAULT_VISIBLE_WORDS);
  const visibleKeywordItems = keywordPresentation.items.slice(0, KEYWORD_FIELD_SLOT_COUNT);
  const scopeIsRefreshing = pending && frequency !== undefined && scopedFrequency === undefined;
  const keywordAvailable = keywordPresentation.year !== null && keywordPresentation.mode !== "unavailable";
  const composition = classifyVocabularyComposition({
    pending: scopeIsRefreshing || pending,
    hasError: error !== undefined,
    frequencyStatus: frequencyPresentation.status,
    frequentCount: visibleFrequencyItems.length,
    keywordAvailable,
    keywordCount: visibleKeywordItems.length,
  });
  const wordCloudShellState = composition.state === "error"
    ? "error"
    : composition.state === "loading"
      ? "loading"
      : currentFrequency === undefined || frequencyPresentation.status !== "ready"
        ? "unavailable"
        : "ready";

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
    <div
      className="v3-vocabulary-stage"
      data-vocabulary-state={composition.state}
      data-vocabulary-composition={composition.mode}
      data-layout-mode={composition.primaryLayout === "12" ? "full" : "asymmetric"}
    >
      <div className="v3-vocabulary-control-strip" aria-label="词汇展示控制">
        <div className="v3-vocabulary-control-context">
          <span>展示范围</span>
          <strong>{ROLE_LABELS[requestedRole]} · {requestedYear === null ? "全部年份" : requestedYear === undefined ? "当前范围" : `${requestedYear} 年`}</strong>
        </div>
        <div className="beta-word-evidence-heading">
          <Badge tone={pending ? "partial" : "privacy"}>{pending ? "更新中" : "本地词频"}</Badge>
        </div>
        <div className="beta-vocabulary-control-bar" aria-label="词汇控制">
          <fieldset className="beta-word-control-group" disabled={pending}>
            <legend>发送方</legend>
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
            <legend>口径</legend>
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
            <legend>展示</legend>
            <ToggleChip
              className="v3-clean-toggle"
              label="净化常用词"
              checked={cleanMode}
              onChange={changeCleanMode}
              description={cleanMode
                ? "只改变展示候选，不改变分析结果。"
                : "显示所有通过基础质量规则的词语。"}
            />
          </fieldset>
        </div>

        <p className="v3-vocabulary-control-note">角色会更新当前词频范围；次数 / 每万词频率与净化开关只改变展示方式。</p>
      </div>

      <div className="v3-vocabulary-primary-grid" data-layout-mode={composition.primaryLayout}>
      <section id="frequent-words" className="v3-frequent-ledger" data-v3-geometry-cell="vocabulary-frequent" data-v3-cell-mode={composition.primaryLayout === "12" ? "full" : "asymmetric"}>
        <header className="v3-vocabulary-beat-heading">
          <p className="beta-type-eyebrow">常用词 · 13</p>
          <h3 className="beta-type-title beta-word-section-heading">这一范围最常提到什么？</h3>
          <p className="beta-type-secondary">词与排名优先；次数或每万词频率作为精确证据保留。</p>
        </header>

        {scopeIsRefreshing && frequency !== undefined ? (
          <p className="beta-word-status" role="status">
            正在更新为{ROLE_LABELS[requestedRole]}{requestedYear === null ? "全部年份" : requestedYear === undefined ? "" : `${requestedYear} 年`}范围；旧范围词频与词云不会显示。
          </p>
        ) : null}
        {error !== undefined ? <p className="beta-word-status" role="alert">{error}</p> : frequencyPresentation.status === "unavailable" ? (
          <p className="beta-word-status" role="status">{pending ? "正在计算当前范围的有界词频列表…" : "当前词频证据尚未就绪。"}</p>
        ) : frequencyPresentation.status === "empty" ? (
          <p className="beta-word-status" role="status">当前年份、角色与已提交范围内没有符合内置质量策略的词元。</p>
        ) : (
          <>
            <FrequencyPodium items={visibleFrequencyItems.slice(0, 3)} metric={metric} onHideWord={hideWord} />
            {visibleFrequencyItems.length > 3 ? (
              <FrequencyRanking items={visibleFrequencyItems.slice(3)} metric={metric} onHideWord={hideWord} className="beta-word-ranking beta-word-ranking-remaining" />
            ) : null}
            {frequencyPresentation.items.length > visibleFrequencyItems.length ? (
              <details className="beta-word-ranking-disclosure">
                <summary>查看全部 {frequencyPresentation.items.length} 个</summary>
                <FrequencyRanking items={frequencyPresentation.items} metric={metric} onHideWord={hideWord} className="beta-word-ranking beta-word-ranking-full" />
              </details>
            ) : null}
            {frequencyPresentation.boundedPoolExhausted ? (
              <p className="beta-word-status">展示过滤已耗尽部分有界候选池，因此当前列表少于目标数量；分析分母与排名未改变。</p>
            ) : null}
            {frequencyPresentation.hiddenCandidateCount > 0 ? (
              <p className="beta-word-status">
                当前展示隐藏 {frequencyPresentation.hiddenCandidateCount} 个候选（净化 {frequencyPresentation.cleanHiddenCandidateCount} 个，自定义 {frequencyPresentation.customHiddenCandidateCount} 个），并已按底层顺序补位。
              </p>
            ) : null}
            {composition.mode === "frequent-sparse-keywords-rich" || composition.mode === "both-sparse-or-empty" ? (
              <p className="v3-vocabulary-sparse-note" role="note">
                当前范围可展示的常用词较少；这里仅保留实际结果，不以空位补足版面。年度关键词仍按已有证据呈现。
              </p>
            ) : null}
          </>
        )}

      </section>

      <section id="distinctive-keywords" className="v3-keyword-field" data-v3-geometry-cell="vocabulary-keywords" data-v3-cell-mode="asymmetric" data-keyword-year={keywordPresentation.year ?? "all-years"}>
        {keywordPresentation.year === null ? (
          <div className="beta-keyword-empty-notice" role="status">
            <div>
              <p className="beta-type-eyebrow">年度关键词 · 14</p>
              <h3 className="beta-type-title beta-word-section-heading">年度关键词</h3>
              <p className="beta-type-report-lead">选择一个具体年份后，可查看该年相对其他年份更具区分度的词。</p>
              <p className="beta-type-secondary">{keywordPresentation.explanation}</p>
            </div>
            {onSelectYear !== undefined ? (
              <BetaButton variant="tertiary" onClick={onSelectYear}>选择具体年份</BetaButton>
            ) : null}
          </div>
        ) : (
          <>
            <header className="v3-vocabulary-beat-heading">
              <p className="beta-type-eyebrow">年度关键词 · 14</p>
              <h3 className="beta-type-title beta-word-section-heading">哪些词更能代表这一年？</h3>
            </header>
            <p className="beta-type-report-lead">{keywordPresentation.explanation}</p>
            <p className="beta-type-metadata">年度关键词展示范围：{keywordPresentation.year} 年</p>
            {composition.mode === "keywords-sparse" ? (
              <p className="v3-vocabulary-sparse-note" role="note">
                当前范围可展示的年度关键词较少；以下仅呈现已有证据。
              </p>
            ) : null}
            {keywordPresentation.items.length === 0 ? (
              <p className="beta-word-status">当前没有可展示的年度关键词证据。</p>
            ) : (
              <>
                <KeywordRanking items={visibleKeywordItems} onHideWord={hideWord} />
                {keywordPresentation.items.length > visibleKeywordItems.length ? (
                  <details className="beta-word-ranking-disclosure">
                    <summary>查看全部 {keywordPresentation.items.length} 个</summary>
                    <KeywordRanking items={keywordPresentation.items} onHideWord={hideWord} className="beta-keyword-ranking beta-keyword-ranking-full" />
                  </details>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
      </div>

      <BetaWordCloud
        frequency={composition.state === "error" || composition.state === "loading" ? undefined : currentFrequency}
        metric={metric}
        customHiddenWords={customHiddenWords}
        cleanMode={cleanMode}
        shellState={wordCloudShellState}
        onHideWord={hideWord}
      />

      <div className="v3-vocabulary-secondary" data-v3-geometry-cell="vocabulary-secondary">
        <details className="beta-hidden-word-review">
          <summary>管理自定义隐藏词（{customHiddenWords.length}）</summary>
          <p>这里只过滤最多 200 个有界候选项，不会触发重新统计，也不会改变分析排名、次数、rate 或分母。</p>
          <label htmlFor="v3-hidden-word-input">
            <span>批量添加（逗号或换行分隔）</span>
          </label>
          <textarea id="v3-hidden-word-input" name="custom-hidden-words" autoComplete="off" value={bulkValue} onChange={(event) => setBulkValue(event.currentTarget.value)} onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && parseCustomHiddenWords(bulkValue).length > 0) {
              event.preventDefault();
              addBulkWords();
            }
          }} />
          <div className="beta-hidden-word-actions">
            <BetaButton variant="secondary" disabled={parseCustomHiddenWords(bulkValue).length === 0} onClick={addBulkWords}>添加隐藏词</BetaButton>
            <BetaButton variant="tertiary" disabled={customHiddenWords.length === 0} onClick={() => commitHidden([])}>清空自定义隐藏</BetaButton>
          </div>
          {customHiddenWords.length > 0 ? (
            <ul className="beta-hidden-word-list" aria-label="当前自定义隐藏词">
              {customHiddenWords.map((word) => (
                <li key={word}><span>{word}</span><BetaButton variant="tertiary" aria-label={`恢复显示隐藏词 ${word}`} onClick={() => restoreWord(word)}>恢复显示</BetaButton></li>
              ))}
            </ul>
          ) : <p>当前没有自定义隐藏词。</p>}
        </details>

        <MethodologyDisclosure summary="查看词汇统计口径" chips={["NFKC", "每万词频率", keywordPresentation.mode === "log-odds" ? "年度对比统计" : "频次回退 / 不适用", cleanMode ? "净化展示开启" : "完整展示"]}>
          <p>原始次数是当前范围内的出现次数；每万词频率以当前角色、年份和内置词汇策略过滤后的 {frequencyPresentation.denominator?.eligibleTokenCount.toLocaleString("zh-CN") ?? "当前"} 个符合条件词元为分母。</p>
          <p>年度关键词继续使用现有 Stage7 候选阈值与年度对比统计；常用词频率与关键词区分度保持独立语义。</p>
          <p>净化常用词使用 {BETA_VOCABULARY_CLEAN_PRESENTATION_VERSION} 本地启发式列表，只过滤展示候选；不会改变次数、频率、分母、底层排名或词频结果标识。</p>
        </MethodologyDisclosure>
      </div>
    </div>
  );
}
