import { useEffect, useRef, useState } from "react";

import {
  acceptDesktopEvent,
  type DesktopEvent,
  type DesktopFailureCode,
  type DesktopState,
  type EventCursor,
  type Generation,
  type SessionId,
} from "../desktop/ipc-contract";
import { desktopApi, listenForDesktopEvents } from "../desktop/runtime";

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
  const [session, setSession] = useState<{
    readonly sessionId: SessionId;
    readonly generation: Generation;
  }>();

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
          break;
        case "failure":
          setFailure(event.payload);
          break;
        case "cancelled":
          setFailure({ code: "SESSION_CANCELLED", retryable: false });
          break;
        case "cleanup":
          break;
        case "closed":
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
    cursorRef.current = resetCursorForNewSession(cursorRef.current);
    void run(() =>
      desktopApi.startAnalysis(requestId() as never, selectionId as never),
    );
  }

  function cancel() {
    if (session === undefined) {
      return;
    }
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
    void run(() =>
      desktopApi.discardSession(
        requestId() as never,
        session.sessionId,
        session.generation,
      ),
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
            Worker 阶段尚未在本 Stage 启用。
          </p>
        </section>
      )}
    </main>
  );
}
