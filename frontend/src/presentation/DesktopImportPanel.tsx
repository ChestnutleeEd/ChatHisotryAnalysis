import { useEffect, useRef, useState } from "react";

import {
  acceptDesktopEvent,
  type DesktopEvent,
  type DesktopFailureCode,
  type DesktopState,
  type DatasetId,
  type EventCursor,
  type Generation,
  type SessionId,
} from "../desktop/ipc-contract";
import { desktopApi, listenForDesktopEvents } from "../desktop/runtime";
import {
  AnalysisWorkerClient,
  WorkerClientCancelledError,
  WorkerClientError,
} from "../worker-analysis/worker-client";
import type {
  CanonicalAnalysisFilters,
  CanonicalAnalysisResult,
} from "../worker-analysis/analytics-contract";
import { ActivityMetricsPanel } from "./ActivityMetricsPanel";
import { ReplySessionMetricsPanel } from "./ReplySessionMetricsPanel";
import { Stage7MetricsPanel } from "./Stage7MetricsPanel";

const WINDOW_ID = "main";

const FAILURE_MESSAGES: Readonly<Partial<Record<DesktopFailureCode, string>>> = {
  NO_SOURCE_SELECTED: "请先选择至少一个年度原始 JSON。",
  SOURCE_COUNT_EXCEEDED: "一次最多选择 20 个原始 JSON。",
  UNSUPPORTED_FILE_TYPE: "仅支持 JSON 原始导出文件。",
  SOURCE_UNREADABLE: "源文件不可读或已发生变化。",
  DUPLICATE_SOURCE: "同一个文件不能同时承担多个源角色。",
  SOURCE_SET_INVALID: "源集合未通过本地校验。",
  SELECTION_STALE: "源选择已过期，请重新选择。",
  DISK_SPACE_INSUFFICIENT: "应用缓存空间不足，未写入私有数据。",
  DATASET_HANDOFF_INVALID: "canonical dataset handoff 校验失败。",
  DATASET_TAMPERED: "canonical dataset 完整性校验失败。",
  DIALOG_UNAVAILABLE: "当前平台无法打开原生文件选择器。",
  SIDECAR_UNAVAILABLE: "本地预处理 sidecar 不可用。",
  SIDECAR_VERIFICATION_FAILED: "本地 sidecar 信任校验失败。",
  SIDECAR_START_FAILED: "无法启动本地预处理。",
  SIDECAR_PROTOCOL_INVALID: "本地预处理协议无效。",
  SIDECAR_CRASHED: "本地预处理异常退出，可重试。",
  SESSION_CANCELLED: "本次本地分析已取消。",
  SESSION_CLEANUP_FAILED: "本地临时数据清理失败，请稍后重试。",
  CLEANUP_REQUIRED: "本地临时数据需要再次清理。",
};

const INITIAL_CURSOR: EventCursor = {
  windowId: WINDOW_ID,
  sessionId: null,
  generation: 0 as Generation,
  sequence: 0,
  state: "idle",
  terminal: false,
};

type FailureState = {
  readonly code: DesktopFailureCode;
  readonly retryable: boolean;
};

function requestId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return "req_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorCode(error: unknown): DesktopFailureCode {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code as DesktopFailureCode;
  }
  return "INVALID_STATE";
}

function eventStatus(event: DesktopEvent): string | undefined {
  if (event.type === "state") {
    return event.payload.state;
  }
  if (event.type === "progress") {
    return event.payload.phase + " · " + Math.round(event.payload.percentage) + "%";
  }
  if (event.type === "dataset-ready") {
    return "canonical dataset ready";
  }
  if (event.type === "cleanup") {
    return event.payload.status === "complete" ? "已清理" : "需要清理";
  }
  return undefined;
}

function resetCursorForSelection(cursor: EventCursor): EventCursor {
  return {
    ...INITIAL_CURSOR,
    generation: cursor.generation,
  };
}

function resetCursorForNewSession(cursor: EventCursor): EventCursor {
  return {
    ...cursor,
    sessionId: null,
    sequence: 0,
    state: "idle",
    terminal: false,
    terminalOutcome: undefined,
    cleanupStatus: undefined,
    closed: false,
  };
}

export function DesktopImportPanel() {
  const cursorRef = useRef<EventCursor>(INITIAL_CURSOR);
  const [selectionId, setSelectionId] = useState<string>();
  const [annualCount, setAnnualCount] = useState(0);
  const [verificationCount, setVerificationCount] = useState(0);
  const [desktopState, setDesktopState] = useState<DesktopState>("idle");
  const [progress, setProgress] = useState<string>();
  const [status, setStatus] = useState("等待本地源选择");
  const [failure, setFailure] = useState<FailureState>();
  const [dataset, setDataset] = useState<{
    readonly datasetId: string;
    readonly resultId: string;
    readonly recordCount: number;
    readonly chunkCount: number;
    readonly minimumCalendarDate: string;
    readonly maximumCalendarDate: string;
  }>();
  const [pending, setPending] = useState(false);
  const analyticsClientRef = useRef<AnalysisWorkerClient | undefined>(undefined);
  const analyticsAttemptRef = useRef(0);
  const [analyticsResult, setAnalyticsResult] =
    useState<CanonicalAnalysisResult>();
  const [analyticsPending, setAnalyticsPending] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string>();
  const [session, setSession] = useState<{
    readonly sessionId: SessionId;
    readonly generation: Generation;
  }>();
  const mountedRef = useRef(true);

  function resetAnalytics(): void {
    analyticsAttemptRef.current += 1;
    analyticsClientRef.current?.dispose();
    analyticsClientRef.current = undefined;
    setAnalyticsResult(undefined);
    setAnalyticsPending(false);
    setAnalyticsError(undefined);
  }

  function analyticsClient(): AnalysisWorkerClient {
    analyticsClientRef.current ??= new AnalysisWorkerClient();
    return analyticsClientRef.current;
  }

  function analyticsProgress(
    sessionId: SessionId,
    generation: Generation,
    phase: string,
    percentage: number,
  ): void {
    if (
      !mountedRef.current ||
      cursorRef.current.sessionId !== sessionId ||
      cursorRef.current.generation !== generation
    ) {
      return;
    }
    setProgress(`analytics · ${phase} · ${Math.round(percentage)}%`);
  }

  function analyticsFailureMessage(error: unknown): string {
    if (error instanceof WorkerClientCancelledError) {
      return "本地 analytics 计算已取消。";
    }
    if (error instanceof WorkerClientError) {
      if (error.code === "MEMORY_PRESSURE") {
        return "本地 analytics Worker 内存不足，未提交部分结果。";
      }
      if (error.code === "DATASET_TRANSPORT_INVALID") {
        return "本地 canonical dataset 通道校验失败。";
      }
      if (error.code === "MANIFEST_VERSION_UNSUPPORTED") {
        return "当前 dataset 版本不支持 Stage 6–8 产品化统计。";
      }
    }
    return "本地 analytics Worker 未完成，当前结果未替换。";
  }

  async function startDesktopAnalytics(
    sessionId: SessionId,
    generation: Generation,
    datasetId: DatasetId,
  ): Promise<void> {
    resetAnalytics();
    const attempt = analyticsAttemptRef.current;
    setAnalyticsPending(true);
    setStatus("正在由本地 analytics Worker 构建统计");
    try {
      const accepted = await analyticsClient().loadDesktopDataset(
        {
          sessionId,
          generation,
          datasetId,
        },
        (next) => {
          analyticsProgress(sessionId, generation, next.phase, next.percentage);
        },
      );
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        cursorRef.current.sessionId !== sessionId ||
        cursorRef.current.generation !== generation
      ) {
        return;
      }
      if (!("activity" in accepted.result)) {
        throw new WorkerClientError("MANIFEST_VERSION_UNSUPPORTED");
      }
      setAnalyticsResult(accepted.result as CanonicalAnalysisResult);
      setAnalyticsError(undefined);
      setStatus("本地活动、回复与会话统计已就绪");
      setProgress(undefined);
    } catch (error) {
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        error instanceof WorkerClientCancelledError
      ) {
        return;
      }
      setAnalyticsError(analyticsFailureMessage(error));
      setStatus("本地活动统计未完成");
    } finally {
      if (mountedRef.current && attempt === analyticsAttemptRef.current) {
        setAnalyticsPending(false);
      }
    }
  }

  async function updateAnalyticsFilters(
    filters: CanonicalAnalysisFilters,
  ): Promise<void> {
    const current = analyticsResult;
    const currentSession = cursorRef.current.sessionId;
    const currentGeneration = cursorRef.current.generation;
    if (
      current === undefined ||
      currentSession === null ||
      current.sessionId !== currentSession ||
      current.generation !== currentGeneration ||
      analyticsClientRef.current === undefined
    ) {
      return;
    }
    analyticsAttemptRef.current += 1;
    const attempt = analyticsAttemptRef.current;
    setAnalyticsPending(true);
    setAnalyticsError(undefined);
    try {
      const next = await analyticsClientRef.current.analyzeCanonical(
        { kind: "canonical-v2", ...filters },
        (progressEvent) => {
          analyticsProgress(
            currentSession,
            currentGeneration,
            progressEvent.phase,
            progressEvent.percentage,
          );
        },
      );
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        cursorRef.current.sessionId !== currentSession ||
        cursorRef.current.generation !== currentGeneration ||
        next.sessionId !== currentSession
      ) {
        return;
      }
      setAnalyticsResult(next);
      setStatus("本地活动、回复与会话统计已更新");
      setProgress(undefined);
    } catch (error) {
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        error instanceof WorkerClientCancelledError
      ) {
        return;
      }
      setAnalyticsError(analyticsFailureMessage(error));
      setStatus("筛选未完成，保留上一次统计结果");
    } finally {
      if (mountedRef.current && attempt === analyticsAttemptRef.current) {
        setAnalyticsPending(false);
      }
    }
  }

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    void listenForDesktopEvents((payload) => {
      if (!mounted) {
        return;
      }
      const accepted = acceptDesktopEvent(cursorRef.current, payload, WINDOW_ID);
      if (!accepted.accepted) {
        return;
      }
      cursorRef.current = accepted.cursor;
      const event = accepted.event;
      const nextStatus = eventStatus(event);
      if (nextStatus !== undefined) {
        setStatus(nextStatus);
      }
      switch (event.type) {
        case "selection-ready":
          resetAnalytics();
          setSelectionId(event.payload.selectionId);
          setAnnualCount(event.payload.annualSourceCount);
          setVerificationCount(event.payload.verificationSourceCount);
          setSession(undefined);
          setProgress(undefined);
          setFailure(undefined);
          setDataset(undefined);
          setDesktopState("ready");
          break;
        case "state":
          setDesktopState(event.payload.state);
          break;
        case "progress":
          setProgress(
            event.payload.phase + " · " + Math.round(event.payload.percentage) + "%",
          );
          break;
        case "dataset-ready":
          setDataset(event.payload);
          setFailure(undefined);
          if (event.sessionId !== null) {
            void startDesktopAnalytics(
              event.sessionId,
              event.generation,
              event.payload.datasetId,
            );
          }
          break;
        case "failure":
          resetAnalytics();
          setFailure(event.payload);
          break;
        case "cancelled":
          resetAnalytics();
          setFailure({ code: "SESSION_CANCELLED", retryable: false });
          break;
        case "cleanup":
          break;
        case "closed":
          resetAnalytics();
          setSession(undefined);
          break;
        case "exported":
          break;
      }
    }).then((remove) => {
      if (mounted) {
        unlisten = remove;
      } else {
        remove();
      }
    });
    return () => {
      mounted = false;
      mountedRef.current = false;
      analyticsAttemptRef.current += 1;
      analyticsClientRef.current?.dispose();
      analyticsClientRef.current = undefined;
      unlisten?.();
    };
  }, []);

  async function run(command: () => Promise<unknown>) {
    setPending(true);
    setFailure(undefined);
    try {
      await command();
    } catch (error) {
      setFailure({ code: errorCode(error), retryable: true });
    } finally {
      setPending(false);
    }
  }

  function selectSources(kind: "annual" | "verification") {
    resetAnalytics();
    cursorRef.current = resetCursorForSelection(cursorRef.current);
    void run(
      kind === "annual"
        ? () => desktopApi.selectAnnualSources(requestId() as never)
        : () => desktopApi.selectVerificationSources(requestId() as never),
    );
  }

  function start() {
    if (selectionId === undefined) {
      setFailure({ code: "NO_SOURCE_SELECTED", retryable: false });
      return;
    }
    resetAnalytics();
    cursorRef.current = resetCursorForNewSession(cursorRef.current);
    void run(() =>
      desktopApi.startAnalysis(requestId() as never, selectionId as never),
    );
  }

  function cancel() {
    if (session === undefined) {
      return;
    }
    resetAnalytics();
    void run(() =>
      desktopApi.cancelAnalysis(
        requestId() as never,
        session.sessionId,
        session.generation,
      ),
    );
  }

  function retry() {
    if (session === undefined) {
      if (
        failure?.code === "CLEANUP_REQUIRED" ||
        failure?.code === "SESSION_CLEANUP_FAILED"
      ) {
        selectSources("annual");
      }
      return;
    }
    resetAnalytics();
    cursorRef.current = resetCursorForNewSession(cursorRef.current);
    void run(() =>
      desktopApi.retryAnalysis(
        requestId() as never,
        session.sessionId,
        session.generation,
      ),
    );
  }

  function discard() {
    if (session === undefined) {
      return;
    }
    resetAnalytics();
    void run(() =>
      desktopApi.discardSession(
        requestId() as never,
        session.sessionId,
        session.generation,
      ),
    );
  }

  function retryAnalytics(): void {
    const currentSession = cursorRef.current.sessionId;
    if (currentSession === null || dataset === undefined) {
      return;
    }
    void startDesktopAnalytics(
      currentSession,
      cursorRef.current.generation,
      dataset.datasetId as DatasetId,
    );
  }

  useEffect(() => {
    if (cursorRef.current.sessionId !== null) {
      setSession({
        sessionId: cursorRef.current.sessionId,
        generation: cursorRef.current.generation,
      });
    }
  }, [desktopState, dataset, failure, progress]);

  const failureMessage =
    failure === undefined
      ? undefined
      : FAILURE_MESSAGES[failure.code] ?? "本地流程失败：" + failure.code;
  const canStart = selectionId !== undefined && annualCount > 0 && !pending;
  const canCancel =
    session !== undefined &&
    !pending &&
    !["complete", "failed", "cancelling", "closing"].includes(desktopState);

  return (
    <main className="app-shell desktop-shell">
      <section className="masthead desktop-masthead">
        <div className="masthead-copy">
          <p className="product-label">LOCAL / DESKTOP / V2 HANDOFF</p>
          <h1>把原始记录留在你的电脑里。</h1>
          <p>
            原生选择器只把文件交给本机 host。渲染层只接收源数量、状态和
            opaque dataset 句柄；不会显示文件名、路径或原始内容。
          </p>
        </div>
        <div className="privacy-mark" aria-label="本地隐私边界">
          <span>原始 JSON 不上传</span>
          <span>无远程请求</span>
          <span>owner-only 临时目录</span>
        </div>
      </section>

      <section className="selection-panel desktop-selection-panel">
        <div>
          <p className="section-number">01 / SOURCES</p>
          <h2>选择本地原始源</h2>
          <p>
            年度源是必选的；验证源可选且单独标记。选择、替换或取消都不会在
            点击“开始本地分析”前创建 session 或私有输出。
          </p>
        </div>
        <div className="selection-actions">
          <button
            className="primary-button"
            type="button"
            disabled={pending}
            onClick={() => selectSources("annual")}
          >
            选择年度原始 JSON
          </button>
          <button
            className="file-button secondary"
            type="button"
            disabled={pending}
            onClick={() => selectSources("verification")}
          >
            选择可选验证源
          </button>
          <p className="selection-help">
            年度源 {annualCount} 个 · 验证源 {verificationCount} 个
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={!canStart}
            onClick={start}
          >
            开始本地分析
          </button>
        </div>
      </section>

      <section className="dataset-summary desktop-status-panel" aria-live="polite">
        <div>
          <p className="section-number">02 / SUPERVISED SESSION</p>
          <h2>{status}</h2>
          <p>
            当前阶段：<strong>{desktopState}</strong>
            {progress === undefined ? "" : " · " + progress}
          </p>
        </div>
        <div className="desktop-controls">
          <button
            className="file-button secondary"
            type="button"
            disabled={!canCancel}
            onClick={cancel}
          >
            取消
          </button>
          <button
            className="file-button secondary"
            type="button"
            disabled={failure?.retryable !== true || pending}
            onClick={retry}
          >
            重试
          </button>
          <button
            className="file-button secondary"
            type="button"
            disabled={session === undefined || pending}
            onClick={discard}
          >
            清理并替换
          </button>
        </div>
      </section>

      {failureMessage !== undefined && (
        <section className="results-panel desktop-result-panel" role="alert">
          <p className="section-number">LOCAL FAILURE</p>
          <h2>{failureMessage}</h2>
          <p>错误代码：{failure?.code}。本地 raw source 未被渲染层读取。</p>
        </section>
      )}

      {dataset !== undefined && (
        <section className="results-panel desktop-result-panel" aria-live="polite">
          <p className="section-number">03 / VERIFIED HANDOFF</p>
          <h2>canonical dataset 已准备好</h2>
          <dl className="desktop-dataset-details">
            <div>
              <dt>records</dt>
              <dd>{dataset.recordCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>chunks</dt>
              <dd>{dataset.chunkCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>calendar</dt>
              <dd>
                {dataset.minimumCalendarDate} → {dataset.maximumCalendarDate}
              </dd>
            </div>
          </dl>
          <p>
            dataset/result 句柄已由 host 绑定到当前 generation；后续 analytics
            Worker 会复用这个 opaque dataset 计算 Stage 6 活动、Stage 7
            词频/长度/关键词/摘要/消息类型，以及 Stage 8 回复间隔与会话统计。
          </p>
        </section>
      )}

      {analyticsError !== undefined && (
        <section className="results-panel desktop-result-panel" role="alert">
          <p className="section-number">ANALYTICS FAILURE</p>
          <h2>本地统计未提交</h2>
          <p>{analyticsError} 可以重试当前本地分析；没有部分或旧 generation 结果被显示。</p>
          <button
            className="file-button secondary"
            type="button"
            disabled={analyticsPending}
            onClick={retryAnalytics}
          >
            重试本地统计
          </button>
        </section>
      )}

      {analyticsResult !== undefined && (
        <>
          <ActivityMetricsPanel
            result={analyticsResult}
            pending={analyticsPending}
            onFilterChange={(filters) => {
              void updateAnalyticsFilters(filters);
            }}
          />
          <Stage7MetricsPanel
            result={analyticsResult}
            pending={analyticsPending}
            onFilterChange={(filters) => {
              void updateAnalyticsFilters(filters);
            }}
          />
          <ReplySessionMetricsPanel
            result={analyticsResult}
            pending={analyticsPending}
            onFilterChange={(filters) => {
              void updateAnalyticsFilters(filters);
            }}
          />
        </>
      )}
    </main>
  );
}
