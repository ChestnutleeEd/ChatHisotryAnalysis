import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  BrowserSelectionError,
  filesFromDataTransfer,
  stageBrowserCandidate,
  type BrowserSelectionFailureCode,
} from "../browser-input/port";
import type { DatasetSummary } from "../normalized/schema";
import {
  type AnalysisResult,
  type AnalysisSettings,
  type WorkerFailureCode,
  type WorkerProgress,
} from "../worker-analysis/protocol";
import {
  AnalysisWorkerClient,
  WorkerClientCancelledError,
  WorkerClientError,
} from "../worker-analysis/worker-client";
import {
  MAXIMUM_DISPLAYED_WORDS,
  MAXIMUM_MINIMUM_FREQUENCY,
} from "../worker-analysis/worker-runtime";
import {
  createWordCloudChart,
  type WordCloudChart,
} from "./word-cloud-chart";

type AttemptState =
  | "idle"
  | "loading"
  | "analyzing"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "stopped"
  | "failed";

type SafeFailureCode =
  | BrowserSelectionFailureCode
  | WorkerFailureCode;

interface AcceptedState {
  readonly files: readonly File[];
  readonly summary: DatasetSummary;
  readonly result: AnalysisResult;
  readonly synthetic: boolean;
  readonly cacheAvailable: boolean;
}

interface ControlValues {
  readonly sender: "all" | "owner" | "other";
  readonly startDate: string;
  readonly endDate: string;
  readonly maximumWords: string;
  readonly minimumFrequency: string;
}

interface ControlErrors {
  readonly dates?: string;
  readonly maximumWords?: string;
  readonly minimumFrequency?: string;
}

const FAILURE_MESSAGES: Readonly<Record<SafeFailureCode, string>> = {
  NO_FILES_SELECTED: "请选择 manifest 和所有 referenced chunks。",
  MANIFEST_MISSING: "选择中缺少 manifest 或 normalized chunk。",
  MANIFEST_DUPLICATE: "只能选择一个 manifest。",
  RAW_EXPORT_UNSUPPORTED:
    "不支持原始 CipherTalk detailed JSON。请先运行本地预处理命令。",
  DUPLICATE_FILE_NAME: "选择包含重复文件名，候选数据集已拒绝。",
  UNEXPECTED_FILE: "选择包含 normalized dataset 之外的文件。",
  CHUNK_TOO_LARGE: "有 chunk 超出浏览器支持的 32 MiB 上限。",
  MANIFEST_TOO_LARGE: "manifest 超出支持的大小上限。",
  DATASET_TOO_LARGE: "候选数据集超出浏览器支持的 128 MiB 上限。",
  WORKER_CREATION_FAILED: "无法创建本地分析 Worker，可重试。",
  WORKER_RUNTIME_FAILED: "本地分析 Worker 异常终止，可重试。",
  WORKER_TERMINATED: "本地分析 Worker 已停止。",
  WORKER_TIMEOUT: "本地分析超时，Worker 已释放。",
  WASM_INITIALIZATION_FAILED: "本地 Jieba WASM 初始化失败，可重试。",
  MEMORY_PRESSURE: "浏览器内存不足，候选数据集未被接受。",
  MANIFEST_INVALID: "manifest 结构无效。",
  MANIFEST_VERSION_UNSUPPORTED: "manifest 或 normalized schema 版本不兼容。",
  FILE_SET_INVALID: "manifest 与所选文件集合不一致。",
  FILE_NAME_INVALID: "manifest 包含非法或不安全的 chunk 名称。",
  DATASET_LIMIT_EXCEEDED: "候选数据集超过 normalized capacity。",
  CHUNK_LIMIT_EXCEEDED: "候选 chunk 超出 32 MiB 上限。",
  HASH_MISMATCH: "chunk 完整性校验失败。",
  UTF8_INVALID: "normalized 文件不是严格 UTF-8。",
  NDJSON_INVALID: "normalized chunk 的 NDJSON 语法无效。",
  RECORD_SCHEMA_INVALID: "normalized record 不符合 exact allow-list。",
  RECORD_ORDER_INVALID: "normalized record 顺序或 canonical index 无效。",
  COUNT_MISMATCH: "manifest 与实际 record count 不一致。",
  RANGE_MISMATCH: "manifest 与实际时间范围不一致。",
  PRIVACY_VALIDATION_FAILED: "normalized privacy validation 失败。",
  SETTINGS_INVALID: "分析条件无效。",
  NO_ACCEPTED_DATASET: "Worker 中没有可分析的数据集，请重新开始。",
  DATASET_TRANSPORT_INVALID: "桌面数据通道校验失败，候选数据集未被接受。",
  STALE_OPERATION: "本地分析请求已过期，请重新开始。",
};

const PHASE_LABELS: Readonly<Record<WorkerProgress["phase"], string>> = {
  manifest: "验证 manifest",
  hash: "校验 chunk 完整性",
  wasm: "初始化本地分词",
  records: "验证 normalized records",
  tokenization: "分词并构建 compact cache",
  aggregation: "计算词频",
};

function initialControls(summary: DatasetSummary): ControlValues {
  return {
    sender: "all",
    startDate: summary.minimumCalendarDate,
    endDate: summary.maximumCalendarDate,
    maximumWords: "100",
    minimumFrequency: "1",
  };
}

function validCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function parseInteger(value: string): number | undefined {
  if (!/^[0-9]+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function settingsFromControls(
  values: ControlValues,
  summary: DatasetSummary,
): { readonly settings?: AnalysisSettings; readonly errors: ControlErrors } {
  const errors: {
    dates?: string;
    maximumWords?: string;
    minimumFrequency?: string;
  } = {};
  if (
    !validCalendarDate(values.startDate) ||
    !validCalendarDate(values.endDate) ||
    values.startDate < summary.minimumCalendarDate ||
    values.endDate > summary.maximumCalendarDate ||
    values.startDate > values.endDate
  ) {
    errors.dates = "日期必须位于数据范围内，且开始日期不能晚于结束日期。";
  }
  const maximumWords = parseInteger(values.maximumWords);
  if (
    maximumWords === undefined ||
    maximumWords < 1 ||
    maximumWords > MAXIMUM_DISPLAYED_WORDS
  ) {
    errors.maximumWords = `显示词数必须是 1–${MAXIMUM_DISPLAYED_WORDS} 的整数。`;
  }
  const minimumFrequency = parseInteger(values.minimumFrequency);
  if (
    minimumFrequency === undefined ||
    minimumFrequency < 1 ||
    minimumFrequency > MAXIMUM_MINIMUM_FREQUENCY
  ) {
    errors.minimumFrequency =
      "最低词频必须是 1–1,000,000 的整数。";
  }
  if (
    errors.dates !== undefined ||
    errors.maximumWords !== undefined ||
    errors.minimumFrequency !== undefined ||
    maximumWords === undefined ||
    minimumFrequency === undefined
  ) {
    return { errors };
  }
  return {
    settings: {
      sender: values.sender,
      startDate: values.startDate,
      endDate: values.endDate,
      maximumWords,
      minimumFrequency,
    },
    errors,
  };
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<WordCloudChart | undefined>(undefined);
  const clientRef = useRef<AnalysisWorkerClient | undefined>(undefined);
  const attemptIdRef = useRef(0);

  const [accepted, setAccepted] = useState<AcceptedState>();
  const [controls, setControls] = useState<ControlValues>();
  const [controlErrors, setControlErrors] = useState<ControlErrors>({});
  const [attemptState, setAttemptState] = useState<AttemptState>("idle");
  const [failureCode, setFailureCode] = useState<SafeFailureCode>();
  const [progress, setProgress] = useState<WorkerProgress>();
  const [syntheticSelection, setSyntheticSelection] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const busy =
    attemptState === "loading" || attemptState === "analyzing";

  useEffect(() => {
    const directoryInput = directoryInputRef.current;
    directoryInput?.setAttribute("webkitdirectory", "");
    directoryInput?.setAttribute("directory", "");
  }, []);

  const hasAcceptedDataset = accepted !== undefined;

  useEffect(() => {
    if (!hasAcceptedDataset) {
      return;
    }
    const container = chartContainerRef.current;
    if (container === null) {
      return;
    }
    const chart = createWordCloudChart(container);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = undefined;
    };
  }, [hasAcceptedDataset]);

  useEffect(() => {
    chartRef.current?.update(accepted?.result.words ?? []);
  }, [accepted?.result]);

  useEffect(
    () => () => {
      attemptIdRef.current += 1;
      clientRef.current?.dispose();
      clientRef.current = undefined;
    },
    [],
  );

  function client(): AnalysisWorkerClient {
    clientRef.current ??= new AnalysisWorkerClient();
    return clientRef.current;
  }

  function onProgress(next: WorkerProgress): void {
    setProgress(next);
  }

  async function importCandidate(
    selected: readonly File[],
    synthetic: boolean,
  ): Promise<void> {
    attemptIdRef.current += 1;
    const attemptId = attemptIdRef.current;
    clientRef.current?.cancelActive();
    setFailureCode(undefined);
    setControlErrors({});
    setProgress(undefined);

    let staged;
    try {
      staged = stageBrowserCandidate(selected);
    } catch (error) {
      if (attemptId !== attemptIdRef.current) {
        return;
      }
      const code =
        error instanceof BrowserSelectionError
          ? error.code
          : "UNEXPECTED_FILE";
      setFailureCode(code);
      setAttemptState("rejected");
      fileInputRef.current?.focus();
      return;
    } finally {
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      if (directoryInputRef.current !== null) {
        directoryInputRef.current.value = "";
      }
    }

    setAttemptState("loading");
    try {
      const next = await client().loadDataset(staged.files, onProgress);
      if (attemptId !== attemptIdRef.current) {
        return;
      }
      setAccepted({
        files: staged.files,
        summary: next.summary,
        result: next.result,
        synthetic,
        cacheAvailable: true,
      });
      setControls(initialControls(next.summary));
      setAttemptState("accepted");
      setFailureCode(undefined);
      setProgress(undefined);
    } catch (error) {
      if (attemptId !== attemptIdRef.current) {
        return;
      }
      if (error instanceof WorkerClientCancelledError) {
        setAttemptState("cancelled");
      } else {
        setAttemptState("rejected");
        setFailureCode(
          error instanceof WorkerClientError
            ? error.code
            : "WORKER_RUNTIME_FAILED",
        );
      }
      fileInputRef.current?.focus();
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    void importCandidate(
      [...(event.currentTarget.files ?? [])],
      syntheticSelection,
    );
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragActive(false);
    void importCandidate(
      filesFromDataTransfer(event.dataTransfer),
      syntheticSelection,
    );
  }

  async function stopWorker(): Promise<void> {
    attemptIdRef.current += 1;
    const currentAttempt = attemptIdRef.current;
    setAttemptState("cancelled");
    setProgress(undefined);
    await clientRef.current?.stop();
    if (currentAttempt !== attemptIdRef.current) {
      return;
    }
    clientRef.current = undefined;
    setAccepted((current) =>
      current === undefined
        ? undefined
        : { ...current, cacheAvailable: false },
    );
    setAttemptState("stopped");
    window.setTimeout(() => {
      (accepted === undefined
        ? fileInputRef.current
        : restartButtonRef.current
      )?.focus();
    }, 0);
  }

  async function restartWorker(): Promise<void> {
    if (accepted === undefined) {
      fileInputRef.current?.focus();
      return;
    }
    clientRef.current?.dispose();
    clientRef.current = undefined;
    await importCandidate(accepted.files, accepted.synthetic);
  }

  async function submitAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accepted === undefined || controls === undefined) {
      return;
    }
    const validation = settingsFromControls(
      controls,
      accepted.summary,
    );
    setControlErrors(validation.errors);
    if (validation.settings === undefined) {
      return;
    }
    if (!accepted.cacheAvailable) {
      setFailureCode("NO_ACCEPTED_DATASET");
      setAttemptState("failed");
      restartButtonRef.current?.focus();
      return;
    }

    attemptIdRef.current += 1;
    const attemptId = attemptIdRef.current;
    setFailureCode(undefined);
    setProgress(undefined);
    setAttemptState("analyzing");
    try {
      const result = await client().analyze(
        validation.settings,
        onProgress,
      );
      if (attemptId !== attemptIdRef.current) {
        return;
      }
      setAccepted((current) =>
        current === undefined ? current : { ...current, result },
      );
      setAttemptState("accepted");
      setProgress(undefined);
    } catch (error) {
      if (attemptId !== attemptIdRef.current) {
        return;
      }
      if (error instanceof WorkerClientCancelledError) {
        setAttemptState("cancelled");
      } else {
        const code =
          error instanceof WorkerClientError
            ? error.code
            : "WORKER_RUNTIME_FAILED";
        setFailureCode(code);
        setAttemptState("failed");
        if (
          code === "WORKER_RUNTIME_FAILED" ||
          code === "WORKER_TIMEOUT" ||
          code === "WORKER_TERMINATED"
        ) {
          setAccepted((current) =>
            current === undefined
              ? current
              : { ...current, cacheAvailable: false },
          );
        }
      }
    }
  }

  function exportPng(): void {
    if (
      accepted === undefined ||
      accepted.result.words.length === 0 ||
      chartRef.current === undefined
    ) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.download = "chat-wordcloud.png";
    anchor.href = chartRef.current.exportPng();
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  const result = accepted?.result;
  const summary = accepted?.summary;
  const failureMessage =
    failureCode === undefined ? undefined : FAILURE_MESSAGES[failureCode];

  return (
    <main className="app-shell" aria-busy={busy}>
      <header className="masthead">
        <div className="masthead-copy">
          <p className="product-label">本地聊天词频分析</p>
          <h1>从 normalized dataset 看见一段对话的语言纹理</h1>
          <p>
            文件只在本机浏览器中处理。原始 CipherTalk JSON 不会进入分析流程、上传或被自动发现。
          </p>
        </div>
        <div className="privacy-mark" aria-label="运行边界">
          <span>本地 File API</span>
          <span>Worker + Jieba WASM</span>
          <span>无外部请求</span>
        </div>
      </header>

      <section
        className={`selection-panel${dragActive ? " is-dragging" : ""}`}
        aria-labelledby="selection-heading"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setDragActive(false);
          }
        }}
        onDrop={handleDrop}
      >
        <div>
          <p className="section-number">01</p>
          <h2 id="selection-heading">选择 normalized dataset</h2>
          <p>
            一次选择一个 manifest 和其中引用的全部 NDJSON chunks，也可以拖放或选择整个文件夹。
          </p>
        </div>
        <div className="selection-actions">
          <label className="file-button">
            选择文件
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.ndjson,application/json"
              onChange={handleFileChange}
              aria-describedby="selection-help selection-feedback"
            />
          </label>
          <label className="file-button secondary">
            选择文件夹
            <input
              ref={directoryInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              aria-describedby="selection-help selection-feedback"
            />
          </label>
          <label className="synthetic-check">
            <input
              type="checkbox"
              checked={syntheticSelection}
              onChange={(event) => {
                setSyntheticSelection(event.currentTarget.checked);
              }}
            />
            这是公开合成测试数据
          </label>
        </div>
        <p id="selection-help" className="selection-help">
          不显示文件名、路径、联系人、账号或消息正文。失败候选不会替换上一次成功结果。
        </p>
        <div
          id="selection-feedback"
          className={`attempt-status state-${attemptState}`}
          role="status"
          aria-live="polite"
          data-testid="attempt-status"
        >
          <strong>
            {attemptState === "idle" && "等待选择"}
            {attemptState === "loading" && "正在验证候选数据集"}
            {attemptState === "analyzing" && "正在重新计算"}
            {attemptState === "accepted" && "数据集已接受"}
            {attemptState === "rejected" && "候选数据集已拒绝"}
            {attemptState === "cancelled" && "正在停止"}
            {attemptState === "stopped" && "Worker 已停止，cache 已释放"}
            {attemptState === "failed" && "分析未完成"}
          </strong>
          {failureMessage !== undefined && (
            <span role="alert" data-testid="safe-error">
              {failureMessage}
            </span>
          )}
          {progress !== undefined && (
            <div className="progress-wrap">
              <div className="progress-copy">
                <span>{PHASE_LABELS[progress.phase]}</span>
                <span>{progress.percentage}%</span>
              </div>
              <progress
                value={progress.percentage}
                max={100}
                aria-label={PHASE_LABELS[progress.phase]}
              />
              {progress.chunkOrdinal !== undefined && (
                <small>
                  chunk {progress.chunkOrdinal} / {progress.chunkCount}
                </small>
              )}
            </div>
          )}
          {busy && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                void stopWorker();
              }}
            >
              停止
            </button>
          )}
          {!busy &&
            accepted !== undefined &&
            accepted.cacheAvailable && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  void stopWorker();
                }}
              >
                停止并释放 cache
              </button>
            )}
          {!busy && accepted !== undefined && !accepted.cacheAvailable && (
            <button
              ref={restartButtonRef}
              className="text-button"
              type="button"
              onClick={() => {
                void restartWorker();
              }}
            >
              重新开始
            </button>
          )}
        </div>
      </section>

      {summary !== undefined && result !== undefined && controls !== undefined && (
        <>
          <section
            className="dataset-summary"
            aria-labelledby="dataset-heading"
          >
            <div className="summary-heading">
              <p className="section-number">02</p>
              <div>
                <h2 id="dataset-heading">已接受的数据集</h2>
                <p className="dataset-kind" data-testid="dataset-kind">
                  {accepted?.synthetic
                    ? "公开合成测试数据"
                    : "本地 data-minimized dataset"}
                  {" · "}
                  conversation fingerprint 仅作假名化身份校验，不代表匿名。
                </p>
              </div>
            </div>
            <div className="date-ribbon" data-testid="date-ribbon">
              <time>{summary.minimumCalendarDate}</time>
              <span aria-hidden="true" />
              <time>{summary.maximumCalendarDate}</time>
            </div>
            <dl className="metric-strip">
              <div>
                <dt>normalized records</dt>
                <dd data-testid="record-count">
                  {summary.normalizedRecordCount.toLocaleString("zh-CN")}
                </dd>
              </div>
              <div>
                <dt>chunks</dt>
                <dd>{summary.chunkCount.toLocaleString("zh-CN")}</dd>
              </div>
              <div>
                <dt>warnings</dt>
                <dd>{summary.warningCount.toLocaleString("zh-CN")}</dd>
              </div>
            </dl>
            {summary.warningCount > 0 && (
              <ul className="warning-list" aria-label="Aggregate warnings">
                {Object.entries(summary.warningsByReason).map(
                  ([reason, count]) => (
                    <li key={reason}>
                      <span>{reason}</span>
                      <strong>{count.toLocaleString("zh-CN")}</strong>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>

          <section className="analysis-layout">
            <form
              className="control-panel"
              aria-labelledby="controls-heading"
              onSubmit={(event) => {
                void submitAnalysis(event);
              }}
            >
              <div>
                <p className="section-number">03</p>
                <h2 id="controls-heading">分析条件</h2>
              </div>
              <label>
                发送方
                <select
                  value={controls.sender}
                  disabled={busy || !accepted?.cacheAvailable}
                  onChange={(event) => {
                    setControls({
                      ...controls,
                      sender: event.currentTarget.value as
                        | "all"
                        | "owner"
                        | "other",
                    });
                  }}
                >
                  <option value="all">全部</option>
                  <option value="owner">仅本人发送</option>
                  <option value="other">仅对方发送</option>
                </select>
              </label>
              <fieldset
                aria-describedby={
                  controlErrors.dates === undefined
                    ? undefined
                    : "date-error"
                }
              >
                <legend>日期范围（含首尾两天）</legend>
                <label>
                  开始
                  <input
                    type="date"
                    value={controls.startDate}
                    min={summary.minimumCalendarDate}
                    max={summary.maximumCalendarDate}
                    disabled={busy || !accepted?.cacheAvailable}
                    aria-invalid={controlErrors.dates !== undefined}
                    onChange={(event) => {
                      setControls({
                        ...controls,
                        startDate: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
                <label>
                  结束
                  <input
                    type="date"
                    value={controls.endDate}
                    min={summary.minimumCalendarDate}
                    max={summary.maximumCalendarDate}
                    disabled={busy || !accepted?.cacheAvailable}
                    aria-invalid={controlErrors.dates !== undefined}
                    onChange={(event) => {
                      setControls({
                        ...controls,
                        endDate: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
                {controlErrors.dates !== undefined && (
                  <span id="date-error" className="field-error">
                    {controlErrors.dates}
                  </span>
                )}
              </fieldset>
              <label>
                最多显示词数
                <input
                  type="number"
                  min={1}
                  max={MAXIMUM_DISPLAYED_WORDS}
                  step={1}
                  value={controls.maximumWords}
                  disabled={busy || !accepted?.cacheAvailable}
                  aria-invalid={controlErrors.maximumWords !== undefined}
                  aria-describedby={
                    controlErrors.maximumWords === undefined
                      ? undefined
                      : "maximum-words-error"
                  }
                  onChange={(event) => {
                    setControls({
                      ...controls,
                      maximumWords: event.currentTarget.value,
                    });
                  }}
                />
                {controlErrors.maximumWords !== undefined && (
                  <span id="maximum-words-error" className="field-error">
                    {controlErrors.maximumWords}
                  </span>
                )}
              </label>
              <label>
                最低词频
                <input
                  type="number"
                  min={1}
                  max={MAXIMUM_MINIMUM_FREQUENCY}
                  step={1}
                  value={controls.minimumFrequency}
                  disabled={busy || !accepted?.cacheAvailable}
                  aria-invalid={controlErrors.minimumFrequency !== undefined}
                  aria-describedby={
                    controlErrors.minimumFrequency === undefined
                      ? undefined
                      : "minimum-frequency-error"
                  }
                  onChange={(event) => {
                    setControls({
                      ...controls,
                      minimumFrequency: event.currentTarget.value,
                    });
                  }}
                />
                {controlErrors.minimumFrequency !== undefined && (
                  <span id="minimum-frequency-error" className="field-error">
                    {controlErrors.minimumFrequency}
                  </span>
                )}
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !accepted?.cacheAvailable}
              >
                更新分析
              </button>
            </form>

            <section className="results-panel" aria-labelledby="results-heading">
              <div className="results-heading">
                <div>
                  <p className="section-number">04</p>
                  <h2 id="results-heading">词频结果</h2>
                </div>
                <button
                  className="export-button"
                  type="button"
                  disabled={result.words.length === 0}
                  aria-describedby={
                    result.words.length === 0 ? "export-help" : undefined
                  }
                  onClick={exportPng}
                >
                  导出 PNG
                </button>
              </div>
              <p id="export-help" className="visually-hidden">
                仅在当前词云非空时可导出。
              </p>
              <dl className="result-metrics">
                <div>
                  <dt>分析消息</dt>
                  <dd data-testid="analyzed-message-count">
                    {result.analyzedMessageCount.toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>唯一词数</dt>
                  <dd data-testid="unique-token-count">
                    {result.uniqueTokenCount.toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>计入 tokens</dt>
                  <dd>{result.totalTokenCount.toLocaleString("zh-CN")}</dd>
                </div>
              </dl>
              <p className="active-scope" data-testid="active-scope">
                {result.sender === "all"
                  ? "全部发送方"
                  : result.sender === "owner"
                    ? "仅本人发送"
                    : "仅对方发送"}
                {" · "}
                {result.startDate} 至 {result.endDate}
                {" · "}
                最低词频 {result.minimumFrequency}
              </p>
              <div
                ref={chartContainerRef}
                className="word-cloud"
                role="img"
                aria-label="由当前 Worker 词频结果生成的词云"
                data-testid="word-cloud"
              />
              {result.words.length === 0 ? (
                <div className="empty-result" role="status">
                  当前条件下没有达到显示阈值的词。
                </div>
              ) : (
                <ol className="ranking" aria-label="精确词频排名">
                  {result.words.map((word) => (
                    <li key={word.token}>
                      <span>{word.token}</span>
                      <strong>{word.frequency.toLocaleString("zh-CN")}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </section>
        </>
      )}

      <footer>
        <span>所有 runtime assets 均由当前 loopback origin 提供。</span>
        <a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a>
      </footer>
    </main>
  );
}
