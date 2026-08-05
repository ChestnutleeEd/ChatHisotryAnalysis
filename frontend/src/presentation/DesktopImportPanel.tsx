import { useEffect, useRef, useState } from "react";

import {
  acceptDesktopEvent,
  type AnalysisCommandAck,
  type AnalysisStatusAck,
  type DesktopEvent,
  type DesktopFailureCode,
  type DesktopPhase,
  type DesktopState,
  type DatasetId,
  type EventCursor,
  type Generation,
  type OperationId,
  type ReportFormat,
  type ApprovedChartKey,
  type SessionId,
  type SelectionCommandAck,
} from "../desktop/ipc-contract";
import {
  desktopApi,
  listenForDesktopEvents,
  listenForDesktopWorkerControl,
} from "../desktop/runtime";
import { isWorkerPreparationAck } from "../desktop/ipc";
import { applySelectionCommand } from "../desktop/selection-state";
import {
  AnalysisWorkerClient,
  WorkerClientCancelledError,
  WorkerClientError,
} from "../worker-analysis/worker-client";
import type {
  CanonicalAnalysisFilters,
  CanonicalAnalysisResult,
} from "../worker-analysis/analytics-contract";
import { canonicalQueryKey } from "../worker-analysis/analytics-contract";
import type { WorkerProgress } from "../worker-analysis/protocol";
import { DesktopDashboard } from "./DesktopDashboard";
import {
  desktopFailureMessage,
  desktopPhaseLabel,
  desktopStateLabel,
  durationBucket,
  isDesktopCancellableState,
  workerPhaseLabel,
} from "./desktop-workflow";
import { createDashboardViewModel, validateDashboardFilters } from "./desktop-dashboard";

const WINDOW_ID = "main";
const ONBOARDING_STORAGE_KEY = "chat-history-analysis.desktop.onboarding.v1";

const INITIAL_CURSOR: EventCursor = {
  windowId: WINDOW_ID,
  sessionId: null,
  generation: 0 as Generation,
  sequence: 0,
  state: "idle",
  terminal: false,
};

interface FailureState {
  readonly code: DesktopFailureCode;
  readonly retryable: boolean;
}

interface ActiveOperation {
  readonly operationId: OperationId;
  readonly sessionId: SessionId;
  readonly generation: Generation;
  readonly cancelAvailable: boolean;
}

interface ProgressView {
  readonly source: "desktop" | "analytics";
  readonly phase: string;
  readonly completed: number;
  readonly total: number;
  readonly percentage: number;
  readonly startedAt: number;
}

interface DatasetState {
  readonly datasetId: DatasetId;
  readonly resultId?: string;
  readonly recordCount: number;
  readonly chunkCount: number;
  readonly minimumCalendarDate: string;
  readonly maximumCalendarDate: string;
  readonly sessionId: SessionId;
  readonly generation: Generation;
}

function requestId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type SyntheticSmokeWindow = Window & {
  readonly __CHAT_HISTORY_ANALYSIS_SYNTHETIC_SMOKE__?: boolean;
  readonly __TAURI_INTERNALS__?: {
    invoke(command: string, args?: unknown): Promise<unknown>;
  };
};

function recordSyntheticSmokeCheckpoint(checkpoint: string): void {
  const smokeWindow = window as SyntheticSmokeWindow;
  if (
    smokeWindow.__CHAT_HISTORY_ANALYSIS_SYNTHETIC_SMOKE__ !== true ||
    smokeWindow.__TAURI_INTERNALS__ === undefined
  ) {
    return;
  }
  void smokeWindow.__TAURI_INTERNALS__.invoke(
    "record_selection_smoke_checkpoint",
    { checkpoint },
  ).catch(() => undefined);
}

function readOnboardingPreference(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "acknowledged";
  } catch {
    return false;
  }
}

function writeOnboardingPreference(): void {
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "acknowledged");
  } catch {
    // A missing preference only means the explanation appears again next time.
  }
}

function eventStatus(event: DesktopEvent): string | undefined {
  if (event.type === "state") {
    return desktopStateLabel(event.payload.state);
  }
  if (event.type === "progress") {
    return desktopPhaseLabel(event.payload.phase);
  }
  if (event.type === "dataset-ready") {
    return "本地分析数据已准备好";
  }
  if (event.type === "failure") {
    return "本地分析未完成，可重试或重新选择文件";
  }
  if (event.type === "cleanup") {
    return event.payload.status === "complete" ? "本地临时数据已清理" : "需要再次清理本地临时数据";
  }
  if (event.type === "exported") {
    return "聚合结果已保存到本地";
  }
  if (event.type === "closed") {
    return event.payload.status === "complete" ? "应用正在关闭" : "应用关闭需要再次清理";
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

function workerProgressView(
  progress: WorkerProgress,
  startedAt: number,
): ProgressView {
  return {
    source: "analytics",
    phase: progress.phase,
    completed: progress.completed,
    total: progress.total,
    percentage: Math.max(0, Math.min(100, progress.percentage)),
    startedAt,
  };
}

export function DesktopImportPanel() {
  const cursorRef = useRef<EventCursor>(INITIAL_CURSOR);
  const mountedRef = useRef(true);
  const progressStartedAtRef = useRef<number | undefined>(undefined);
  const replacementPendingRef = useRef(false);
  const analyticsClientRef = useRef<AnalysisWorkerClient | undefined>(undefined);
  const analyticsAttemptRef = useRef(0);
  const latestSelectionIdRef = useRef<string | undefined>(undefined);
  const operationRef = useRef<ActiveOperation | undefined>(undefined);
  const exportAttemptRef = useRef<{ readonly format: ReportFormat; readonly chartKey: ApprovedChartKey }>(undefined);
  const exportOutcomeRef = useRef<string>("unknown");
  const [onboardingSeen, setOnboardingSeen] = useState(readOnboardingPreference);
  const [onboardingOpen, setOnboardingOpen] = useState(!readOnboardingPreference());
  const [selectionId, setSelectionId] = useState<string>();
  const [annualCount, setAnnualCount] = useState(0);
  const [verificationCount, setVerificationCount] = useState(0);
  const [desktopState, setDesktopState] = useState<DesktopState>("idle");
  const [status, setStatus] = useState("等待本地源选择");
  const [progress, setProgress] = useState<ProgressView>();
  const [failure, setFailure] = useState<FailureState>();
  const [dataset, setDataset] = useState<DatasetState>();
  const [session, setSession] = useState<{ readonly sessionId: SessionId; readonly generation: Generation }>();
  const [operation, setOperation] = useState<ActiveOperation>();
  const [analyticsResult, setAnalyticsResult] = useState<CanonicalAnalysisResult>();
  const [analyticsPending, setAnalyticsPending] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string>();
  const [pendingCommand, setPendingCommand] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState<string>();

  function updateOperation(next: ActiveOperation | undefined): void {
    operationRef.current = next;
    setOperation(next);
  }

  useEffect(() => {
    if (!onboardingOpen && !closeDialogOpen) {
      return;
    }
    const layer = document.querySelector<HTMLElement>(".desktop-dialog-layer");
    if (layer === null) {
      return;
    }
    const focusable = () =>
      Array.from(
        layer.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    const initial = focusable()[0];
    initial?.focus();
    function trapFocus(event: KeyboardEvent): void {
      if (event.key === "Escape" && closeDialogOpen) {
        event.preventDefault();
        setCloseDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [closeDialogOpen, onboardingOpen]);

  async function stopAnalyticsWorker(
    sessionId: SessionId | null = cursorRef.current.sessionId,
    generation: Generation = cursorRef.current.generation,
  ): Promise<void> {
    const client = analyticsClientRef.current;
    try {
      if (client !== undefined) {
        await client.stop();
      }
    } finally {
      if (sessionId !== null) {
        try {
          await desktopApi.acknowledgeWorkerStop(
            requestId() as never,
            sessionId,
            generation,
          );
        } catch {
          // The host may already have invalidated the operation during close.
        }
        try {
          await desktopApi.cancelAggregateResult(
            requestId() as never,
            sessionId,
            generation,
          );
        } catch {
          // Session cleanup remains the host-side authority if the renderer is stale.
        }
      }
      if (client !== undefined) {
        client.dispose();
        if (analyticsClientRef.current === client) {
          analyticsClientRef.current = undefined;
        }
      }
    }
  }

  async function resetAnalytics(clearResult = true): Promise<void> {
    analyticsAttemptRef.current += 1;
    await stopAnalyticsWorker();
    setAnalyticsPending(false);
    setAnalyticsError(undefined);
    if (clearResult) {
      setAnalyticsResult(undefined);
    }
  }

  function analyticsClient(): AnalysisWorkerClient {
    analyticsClientRef.current ??= new AnalysisWorkerClient();
    return analyticsClientRef.current;
  }

  function setProgressFromWorker(next: WorkerProgress, sessionId: SessionId, generation: Generation): void {
    if (
      !mountedRef.current ||
      cursorRef.current.sessionId !== sessionId ||
      cursorRef.current.generation !== generation
    ) {
      return;
    }
    const startedAt = progressStartedAtRef.current ?? Date.now();
    progressStartedAtRef.current = startedAt;
    setProgress(workerProgressView(next, startedAt));
  }

  function analyticsFailureMessage(error: unknown): string {
    const code =
      error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? (error.code as DesktopFailureCode)
        : undefined;
    const contractMessage = desktopFailureMessage(code);
    if (contractMessage !== undefined && code?.startsWith("EXPORT_") === true) {
      return contractMessage;
    }
    if (error instanceof WorkerClientCancelledError) {
      return "本地统计计算已取消；上一次完整结果仍保留。";
    }
    if (error instanceof WorkerClientError) {
      if (error.code === "MEMORY_PRESSURE") {
        return "本地统计需要更多可用内存，未提交部分结果。";
      }
      if (error.code === "DATASET_TRANSPORT_INVALID") {
        return "本地分析数据通道校验失败，未提交部分结果。";
      }
      if (error.code === "MANIFEST_VERSION_UNSUPPORTED") {
        return "当前 canonical dataset 版本不支持这些产品统计。";
      }
    }
    return "本地统计 Worker 未完成，未替换上一次完整结果。";
  }

  async function startDesktopAnalytics(
    sessionId: SessionId,
    generation: Generation,
    datasetId: DatasetId,
    minimumCalendarDate: string,
    maximumCalendarDate: string,
    replaceResult: boolean,
  ): Promise<void> {
    await resetAnalytics(replaceResult);
    const attempt = analyticsAttemptRef.current;
    const startedAt = Date.now();
    progressStartedAtRef.current = startedAt;
    setAnalyticsPending(true);
    setAnalyticsError(undefined);
    setStatus("正在由本地 analytics Worker 构建统计");
    recordSyntheticSmokeCheckpoint("worker-started");
    try {
      const initialFilters: CanonicalAnalysisFilters = {
        startDate: minimumCalendarDate,
        endDate: maximumCalendarDate,
        sender: "both",
        selectedYear: null,
        sessionThresholdHours: 6,
      };
      const preparation = await desktopApi.prepareAggregateResult(
        requestId() as never,
        sessionId,
        generation,
        canonicalQueryKey(datasetId, generation, initialFilters),
      );
      if (
        !isWorkerPreparationAck(preparation) ||
        preparation.capability.sessionId !== sessionId ||
        preparation.capability.generation !== generation ||
        preparation.capability.datasetId !== datasetId
      ) {
        throw new WorkerClientError("WORKER_COMMIT_REJECTED");
      }
      recordSyntheticSmokeCheckpoint("worker-prepared");
      const client = analyticsClient();
      const accepted = await client.loadDesktopDataset(
        {
          sessionId,
          generation,
          datasetId,
          workerCapability: preparation.capability,
        },
        (next) => setProgressFromWorker(next, sessionId, generation),
      );
      recordSyntheticSmokeCheckpoint("worker-load-accepted");
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
      const nextResult = await client.analyzeCanonical(
        { kind: "canonical-v2", ...initialFilters },
        (next) => setProgressFromWorker(next, sessionId, generation),
        preparation.capability,
      );
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        cursorRef.current.sessionId !== sessionId ||
        cursorRef.current.generation !== generation ||
        nextResult.sessionId !== sessionId ||
        nextResult.generation !== generation
      ) {
        return;
      }
      createDashboardViewModel(nextResult);
      recordSyntheticSmokeCheckpoint("worker-dashboard-model");
      const committedResultId = client.committedResultId;
      if (committedResultId === undefined) {
        throw new WorkerClientError("WORKER_COMMIT_REJECTED");
      }
      if (!mountedRef.current || attempt !== analyticsAttemptRef.current) {
        return;
      }
      setDataset((current) =>
        current !== undefined && current.sessionId === sessionId && current.generation === generation
          ? { ...current, resultId: committedResultId }
          : current,
      );
      setAnalyticsResult(nextResult);
      recordSyntheticSmokeCheckpoint("worker-result-ready");
      setAnalyticsError(undefined);
      setStatus("本地统计已就绪");
      setProgress(undefined);
    } catch (error) {
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current
      ) {
        return;
      }
      if (error instanceof WorkerClientCancelledError) {
        setStatus("本地统计已取消");
      } else {
        setAnalyticsError(analyticsFailureMessage(error));
        setStatus("本地统计未完成");
      }
      try {
        await stopAnalyticsWorker(sessionId, generation);
      } catch {
        // Session cleanup remains the host-side authority if the renderer is stale.
      }
    } finally {
      if (mountedRef.current && attempt === analyticsAttemptRef.current) {
        setAnalyticsPending(false);
      }
    }
  }

  async function updateAnalyticsFilters(filters: CanonicalAnalysisFilters): Promise<void> {
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
    const validation = validateDashboardFilters(filters, current.dataset);
    if (validation.filters === undefined) {
      setAnalyticsError("筛选条件无效，未开始新的本地计算。");
      return;
    }
    analyticsAttemptRef.current += 1;
    const client = analyticsClientRef.current;
    const cancellationAcknowledged =
      client !== undefined && (await client.cancelActiveAndWait());
    if (!cancellationAcknowledged) {
      try {
        await stopAnalyticsWorker(currentSession, currentGeneration);
      } catch {
        // The host close/recovery path remains authoritative on a failed stop.
      }
      setAnalyticsError("本地 Worker 未确认取消，未开始新的筛选计算。");
      setAnalyticsPending(false);
      return;
    }
    await desktopApi.acknowledgeWorkerStop(
      requestId() as never,
      currentSession,
      currentGeneration,
    );
    await desktopApi.cancelAggregateResult(
      requestId() as never,
      currentSession,
      currentGeneration,
    );
    const attempt = analyticsAttemptRef.current;
    const startedAt = Date.now();
    progressStartedAtRef.current = startedAt;
    setAnalyticsPending(true);
    setAnalyticsError(undefined);
    setStatus("正在由本地 Worker 应用筛选");
    try {
    const preparation = await desktopApi.prepareAggregateResult(
      requestId() as never,
      currentSession,
      currentGeneration,
      canonicalQueryKey(current.datasetId, currentGeneration, validation.filters),
    );
    if (
      !isWorkerPreparationAck(preparation) ||
      preparation.capability.sessionId !== currentSession ||
      preparation.capability.generation !== currentGeneration ||
      preparation.capability.datasetId !== current.datasetId
    ) {
      throw new WorkerClientError("WORKER_COMMIT_REJECTED");
    }
    const next = await client.analyzeCanonical(
      { kind: "canonical-v2", ...validation.filters },
      (nextProgress) => setProgressFromWorker(nextProgress, currentSession, currentGeneration),
      preparation.capability,
    );
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current ||
        cursorRef.current.sessionId !== currentSession ||
        cursorRef.current.generation !== currentGeneration ||
        next.sessionId !== currentSession ||
        next.generation !== currentGeneration
      ) {
        return;
      }
      createDashboardViewModel(next);
      const committedResultId = client.committedResultId;
      if (committedResultId === undefined) {
        throw new WorkerClientError("WORKER_COMMIT_REJECTED");
      }
      if (!mountedRef.current || attempt !== analyticsAttemptRef.current) {
        return;
      }
      setDataset((currentDataset) =>
        currentDataset !== undefined &&
        currentDataset.sessionId === currentSession &&
        currentDataset.generation === currentGeneration
          ? { ...currentDataset, resultId: committedResultId }
          : currentDataset,
      );
      setAnalyticsResult(next);
      setStatus("本地筛选统计已更新");
      setProgress(undefined);
    } catch (error) {
      if (
        !mountedRef.current ||
        attempt !== analyticsAttemptRef.current
      ) {
        return;
      }
      if (error instanceof WorkerClientCancelledError) {
        setStatus("筛选已取消，保留上一次完整结果");
      } else {
        setAnalyticsError(analyticsFailureMessage(error));
        setStatus("筛选未完成，保留上一次完整结果");
      }
      try {
        await stopAnalyticsWorker(currentSession, currentGeneration);
      } catch {
        // The host cleanup path is authoritative when a renderer request is stale.
      }
    } finally {
      if (mountedRef.current && attempt === analyticsAttemptRef.current) {
        setAnalyticsPending(false);
      }
    }
  }

  function applyDesktopEvent(event: DesktopEvent): void {
    const nextStatus = eventStatus(event);
    if (nextStatus !== undefined) {
      setStatus(nextStatus);
    }
    if (event.sessionId !== null) {
      setSession({ sessionId: event.sessionId, generation: event.generation });
    }
    switch (event.type) {
      case "selection-ready":
        latestSelectionIdRef.current = event.payload.selectionId;
        void resetAnalytics(true);
        setSelectionId(event.payload.selectionId);
        setAnnualCount(event.payload.annualSourceCount);
        setVerificationCount(event.payload.verificationSourceCount);
        setSession(undefined);
        updateOperation(undefined);
        setDataset(undefined);
        setFailure(undefined);
        setExportMessage(undefined);
        setProgress(undefined);
        setDesktopState("ready");
        break;
      case "state":
        setDesktopState(event.payload.state);
        if (event.payload.state === "complete") {
          setProgress(undefined);
        }
        break;
      case "progress": {
        const startedAt = progressStartedAtRef.current ?? Date.now();
        progressStartedAtRef.current = startedAt;
        setProgress({
          source: "desktop",
          phase: event.payload.phase,
          completed: event.payload.completed,
          total: event.payload.total,
          percentage: event.payload.percentage,
          startedAt,
        });
        break;
      }
      case "dataset-ready":
        if (event.sessionId !== null) {
          setDataset({
            ...event.payload,
            sessionId: event.sessionId,
            generation: event.generation,
          });
          setFailure(undefined);
          void startDesktopAnalytics(
            event.sessionId,
            event.generation,
            event.payload.datasetId,
            event.payload.minimumCalendarDate,
            event.payload.maximumCalendarDate,
            true,
          );
        }
        break;
      case "failure":
        setFailure(event.payload);
        setDesktopState("failed");
        if (operationRef.current !== undefined) {
          updateOperation({ ...operationRef.current, cancelAvailable: false });
        }
        setProgress(undefined);
        break;
      case "cancelled":
        recordSyntheticSmokeCheckpoint("cancelled-event");
        setFailure(undefined);
        setDesktopState("ready");
        setStatus("本地分析已取消，可重新开始");
        setSession(undefined);
        updateOperation(undefined);
        setProgress(undefined);
        break;
      case "cleanup":
        if (event.payload.status === "complete" && replacementPendingRef.current) {
          replacementPendingRef.current = false;
          cursorRef.current = resetCursorForSelection(cursorRef.current);
          setTimeout(() => {
            void selectSources("annual");
          }, 0);
        }
        break;
      case "exported":
        exportOutcomeRef.current = "saved";
        setExportMessage("聚合结果已通过本地保存流程写入。");
        break;
      case "closed":
        setDesktopState("closing");
        setSession(undefined);
        updateOperation(undefined);
        setProgress(undefined);
        break;
    }
  }

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    let unlistenWorker: (() => void) | undefined;
    void listenForDesktopEvents((payload) => {
      if (!mounted) {
        return;
      }
      const accepted = acceptDesktopEvent(cursorRef.current, payload, WINDOW_ID);
      if (!accepted.accepted) {
        return;
      }
      const event = accepted.event;
      if (
        event.type === "selection-ready" &&
        latestSelectionIdRef.current !== undefined &&
        event.payload.selectionId !== latestSelectionIdRef.current
      ) {
        return;
      }
      cursorRef.current = accepted.cursor;
      applyDesktopEvent(event);
    }).then((remove) => {
      if (mounted) {
        unlisten = remove;
      } else {
        remove();
      }
    });
    void listenForDesktopWorkerControl((payload) => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        return;
      }
      const control = payload as Record<string, unknown>;
      if (
        (control.kind !== "cancel" && control.kind !== "force-terminate") ||
        control.sessionId !== cursorRef.current.sessionId ||
        control.generation !== cursorRef.current.generation
      ) {
        return;
      }
      const client = analyticsClientRef.current;
      void (async () => {
        try {
          if (client !== undefined) {
            await client.stop();
          }
          await desktopApi.acknowledgeWorkerStop(
            requestId() as never,
            control.sessionId as SessionId,
            control.generation as Generation,
          );
        } catch {
          client?.dispose();
        }
      })();
    }).then((remove) => {
      if (mounted) {
        unlistenWorker = remove;
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
      unlistenWorker?.();
    };
  }, []);

  useEffect(() => {
    if (operation === undefined) {
      return;
    }
    const current = operation;
    let stopped = false;
    const poll = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      let authoritative: AnalysisStatusAck;
      try {
        authoritative = await desktopApi.getAnalysisStatus(
          requestId() as never,
          current.operationId,
          cursorRef.current.sequence,
        );
      } catch {
        return;
      }
      if (
        stopped ||
        !authoritative.registered ||
        authoritative.operationId !== current.operationId ||
        authoritative.sessionId === null ||
        authoritative.sessionId !== current.sessionId ||
        authoritative.generation !== current.generation
      ) {
        return;
      }
      for (const event of authoritative.events) {
        const accepted = acceptDesktopEvent(cursorRef.current, event, WINDOW_ID);
        if (accepted.accepted) {
          cursorRef.current = accepted.cursor;
          applyDesktopEvent(accepted.event);
        }
      }
      if (
        stopped ||
        operationRef.current?.operationId !== current.operationId
      ) {
        return;
      }
      setSession({
        sessionId: authoritative.sessionId,
        generation: authoritative.generation,
      });
      if (operationRef.current?.operationId === current.operationId) {
        updateOperation({
          ...operationRef.current,
          cancelAvailable: authoritative.cancelAvailable,
        });
      }
      setDesktopState(authoritative.state);
      if (
        authoritative.state !== "complete" &&
        authoritative.state !== "failed" &&
        authoritative.terminal !== "cancelled" &&
        authoritative.progress !== null
      ) {
        const startedAt = progressStartedAtRef.current ?? Date.now();
        progressStartedAtRef.current = startedAt;
        setProgress({
          source: "desktop",
          phase: authoritative.progress.phase,
          completed: authoritative.progress.completed,
          total: authoritative.progress.total,
          percentage: authoritative.progress.percentage,
          startedAt,
        });
      } else if (
        authoritative.state === "complete" ||
        authoritative.state === "failed" ||
        authoritative.terminal === "cancelled"
      ) {
        setProgress(undefined);
      }
      if (
        authoritative.state === "preprocessing" &&
        authoritative.progress === null
      ) {
        setStatus(
          authoritative.heartbeat === "starting"
            ? "正在等待本地预处理响应"
            : "正在验证并整理源文件",
        );
      }
      if (
        authoritative.state === "complete" ||
        authoritative.state === "failed" ||
        authoritative.terminal === "cancelled"
      ) {
        stopped = true;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [operation?.operationId]);

  async function runCommand<T>(
    command: () => Promise<T>,
    options: { readonly preserveResult?: boolean; readonly clearFailure?: boolean } = {},
  ): Promise<T | undefined> {
    const preserveResult = options.preserveResult ?? false;
    setPendingCommand(true);
    if (options.clearFailure ?? true) {
      setFailure(undefined);
    }
    try {
      return await command();
    } catch (error) {
      const code =
        error instanceof WorkerClientError
          ? (error.code as unknown as DesktopFailureCode)
          : error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code as DesktopFailureCode
            : "INVALID_STATE";
      setFailure({ code, retryable: true });
      if (!preserveResult) {
        setDesktopState("failed");
      }
      return undefined;
    } finally {
      setPendingCommand(false);
    }
  }

  async function selectSources(kind: "annual" | "verification"): Promise<void> {
    const previous = {
      cursor: cursorRef.current,
      selectionId,
      annualCount,
      verificationCount,
      desktopState,
      status,
      failure,
    };
    const previousWasLive = ["preprocessing", "handoff", "analyzing", "cancelling"].includes(previous.desktopState);
    cursorRef.current = resetCursorForSelection(cursorRef.current);
    cursorRef.current = { ...cursorRef.current, state: "selecting" };
    setDesktopState("selecting");
    setStatus("正在打开本地文件选择器");
    const completed = await runCommand<SelectionCommandAck>(
      kind === "annual"
        ? () => desktopApi.selectAnnualSources(requestId() as never)
        : () => desktopApi.selectVerificationSources(requestId() as never),
      { preserveResult: true, clearFailure: false },
    );
    if (completed === undefined) {
      cursorRef.current = previous.cursor;
      if (previousWasLive) {
        setSession(undefined);
        updateOperation(undefined);
        setDataset(undefined);
        setDesktopState("failed");
        setStatus("旧本地分析已安全停止；选择失败，请根据错误码重试");
      } else if (previous.selectionId !== undefined) {
        setDesktopState(previous.desktopState);
        setStatus("选择失败，保留上一次有效选择");
      } else {
        setDesktopState("failed");
        setStatus("选择失败，请根据错误码重试");
      }
      return;
    }
    if (completed.outcome === "cancelled" || completed.selection === null) {
      if (previousWasLive) {
        cursorRef.current = resetCursorForSelection(previous.cursor);
        setSession(undefined);
        updateOperation(undefined);
        setDataset(undefined);
        setFailure(undefined);
        setProgress(undefined);
        setDesktopState("ready");
        setStatus("旧本地分析已安全停止，可重新选择文件或开始分析");
        return;
      }
      cursorRef.current = previous.cursor;
      setSelectionId(previous.selectionId);
      setAnnualCount(previous.annualCount);
      setVerificationCount(previous.verificationCount);
      setDesktopState(previous.desktopState);
      setStatus(previous.status);
      setFailure(previous.failure);
      return;
    }
    await resetAnalytics(true);
    const next = applySelectionCommand(
      {
        selectionId: previous.selectionId as never,
        annualCount: previous.annualCount,
        verificationCount: previous.verificationCount,
        desktopState: "selecting",
        status: "正在打开本地文件选择器",
      },
      completed,
    );
    latestSelectionIdRef.current = next.selectionId;
    cursorRef.current = {
      ...resetCursorForSelection(cursorRef.current),
      state: "ready",
      sequence: 1,
    };
    setSelectionId(next.selectionId as string);
    setAnnualCount(next.annualCount);
    setVerificationCount(next.verificationCount);
    setSession(undefined);
    updateOperation(undefined);
    setDataset(undefined);
    setFailure(undefined);
    setExportMessage(undefined);
    setProgress(undefined);
    setDesktopState(next.desktopState);
    setStatus(next.status);
  }

  async function start(): Promise<void> {
    if (selectionId === undefined) {
      setFailure({ code: "NO_SOURCE_SELECTED", retryable: false });
      return;
    }
    await resetAnalytics(true);
    cursorRef.current = resetCursorForNewSession(cursorRef.current);
    progressStartedAtRef.current = Date.now();
    setDesktopState("preprocessing");
    setStatus("正在验证、合并、排序和去重");
    const acknowledged = await runCommand<AnalysisCommandAck>(
      () => desktopApi.startAnalysis(requestId() as never, selectionId as never),
    );
    if (acknowledged !== undefined) {
      const nextOperation: ActiveOperation = {
        operationId: acknowledged.operationId,
        sessionId: acknowledged.sessionId,
        generation: acknowledged.generation,
        cancelAvailable: acknowledged.cancelAvailable,
      };
      updateOperation(nextOperation);
      setSession({
        sessionId: acknowledged.sessionId,
        generation: acknowledged.generation,
      });
      if (
        cursorRef.current.sessionId !== acknowledged.sessionId ||
        cursorRef.current.generation !== acknowledged.generation
      ) {
        cursorRef.current = {
          ...resetCursorForNewSession(cursorRef.current),
          sessionId: acknowledged.sessionId,
          generation: acknowledged.generation,
          state: "ready",
        };
      }
    }
  }

  async function cancel(): Promise<void> {
    if (session === undefined || operation === undefined) {
      return;
    }
    setDesktopState("cancelling");
    setStatus("正在取消本地分析");
    setProgress(undefined);
    const completed = await runCommand(() => desktopApi.cancelAnalysis(requestId() as never, operation.operationId));
    if (completed !== undefined) {
      void (window as SyntheticSmokeWindow).__TAURI_INTERNALS__?.invoke("record_selection_smoke_host_state").catch(() => undefined);
    }
  }

  async function retry(): Promise<void> {
    if (session === undefined) {
      await selectSources("annual");
      return;
    }
    await resetAnalytics(false);
    cursorRef.current = resetCursorForNewSession(cursorRef.current);
    setDesktopState("preprocessing");
    setStatus("正在用新的本地分析代次重试");
    const acknowledged = await runCommand<AnalysisCommandAck>(
      () => desktopApi.retryAnalysis(requestId() as never, session.sessionId, session.generation),
    );
    if (acknowledged !== undefined) {
      updateOperation({
        operationId: acknowledged.operationId,
        sessionId: acknowledged.sessionId,
        generation: acknowledged.generation,
        cancelAvailable: acknowledged.cancelAvailable,
      });
      setSession({
        sessionId: acknowledged.sessionId,
        generation: acknowledged.generation,
      });
      cursorRef.current = {
        ...resetCursorForNewSession(cursorRef.current),
        sessionId: acknowledged.sessionId,
        generation: acknowledged.generation,
        state: "ready",
      };
    }
  }

  async function discard(): Promise<void> {
    if (session === undefined) {
      return;
    }
    await resetAnalytics(true);
    setDesktopState("discarding");
    setStatus("正在清理本地临时数据");
    await runCommand(() => desktopApi.discardSession(requestId() as never, session.sessionId, session.generation));
  }

  async function analyzeOtherFiles(): Promise<void> {
    if (session === undefined) {
      await selectSources("annual");
      return;
    }
    replacementPendingRef.current = true;
    await discard();
  }

  function retryAnalytics(): void {
    if (dataset === undefined) {
      return;
    }
    void startDesktopAnalytics(
      dataset.sessionId,
      dataset.generation,
      dataset.datasetId,
      dataset.minimumCalendarDate,
      dataset.maximumCalendarDate,
      false,
    );
  }

  async function exportAggregate(
    format: ReportFormat,
    chartKey: ApprovedChartKey,
  ): Promise<void> {
    if (dataset === undefined || dataset.resultId === undefined || analyticsResult === undefined || analyticsPending) {
      return;
    }
    if (
      analyticsResult.sessionId !== dataset.sessionId ||
      analyticsResult.generation !== dataset.generation ||
      cursorRef.current.sessionId !== dataset.sessionId ||
      cursorRef.current.generation !== dataset.generation
    ) {
      setExportMessage("当前结果已经过期，不能导出旧代次。");
      return;
    }
    exportAttemptRef.current = { format, chartKey };
    exportOutcomeRef.current = "unknown";
    setExportMessage("正在打开本地保存流程；请在原生保存面板中确认位置。");
    const completed = await runCommand(
      () => desktopApi.exportAggregate(
        requestId() as never,
        dataset.sessionId,
        dataset.generation,
        format,
        dataset.resultId as never,
        chartKey,
      ),
      { preserveResult: true },
    );
    if (completed) {
      setExportMessage(
        exportOutcomeRef.current === "saved"
          ? "聚合结果已通过本地保存流程写入。"
          : "本地保存已取消，当前结果未改变。",
      );
    } else {
      setExportMessage("导出失败，可按错误说明重试当前聚合结果。");
    }
  }

  function completeOnboarding(): void {
    writeOnboardingPreference();
    setOnboardingSeen(true);
    setOnboardingOpen(false);
  }

  function openPrivacy(): void {
    setOnboardingOpen(true);
  }

  async function confirmClose(): Promise<void> {
    setCloseDialogOpen(false);
    setDesktopState("closing");
    setStatus("正在取消任务并清理本地临时数据");
    await runCommand(() => desktopApi.requestApplicationClose(requestId() as never, "cancel-and-close"));
  }

  const failureText = desktopFailureMessage(failure?.code);
  const isBusy = pendingCommand || analyticsPending || isDesktopCancellableState(desktopState) || desktopState === "cancelling" || desktopState === "closing";
  const canCancel = operation !== undefined && session !== undefined && operation.cancelAvailable && isDesktopCancellableState(desktopState) && !pendingCommand;
  const canStart = selectionId !== undefined && annualCount > 0 && !pendingCommand && !isBusy;
  const progressDuration = progress === undefined ? undefined : durationBucket(Date.now() - progress.startedAt);

  return (
    <main className="desktop-app" aria-busy={isBusy}>
      {onboardingOpen ? (
        <div className="desktop-dialog-layer">
          <section className="desktop-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-onboarding-heading" aria-describedby="privacy-onboarding-copy">
            <p className="dashboard-eyebrow">LOCAL ALPHA / PRIVACY</p>
            <h1 id="privacy-onboarding-heading">先了解本地分析</h1>
            <div id="privacy-onboarding-copy" className="onboarding-copy">
              <p>你主动选择的 CipherTalk JSON 只在本机处理；应用不会上传聊天记录。</p>
              <p>可以选择多个年度文件。应用会验证、合并、排序和确定性去重；分析可能需要一些时间，也可以随时取消。</p>
              <p>默认会在替换分析或退出应用时清理临时会话。当前版本是本地 Alpha，不是正式发布版本。</p>
            </div>
            <button className="dashboard-button dashboard-button-primary" type="button" autoFocus onClick={completeOnboarding}>继续到文件选择</button>
          </section>
        </div>
      ) : null}
      <header className="desktop-app-header">
        <div>
          <p className="dashboard-eyebrow">LOCAL CHAT ANALYSIS / DESKTOP ALPHA</p>
          <h1>本地分析</h1>
          <p>选择源文件、等待本地统计完成，然后在一个 Dashboard 中查看结果。</p>
        </div>
        <div className="desktop-header-actions">
          <span className="dashboard-local-badge">不上传聊天记录</span>
          {onboardingSeen ? <button className="dashboard-button" type="button" onClick={openPrivacy}>隐私说明</button> : null}
          <button className="dashboard-button" type="button" onClick={() => setCloseDialogOpen(true)}>退出应用</button>
        </div>
      </header>

      {analyticsResult === undefined ? (
        <section className="desktop-workflow-card" aria-labelledby="desktop-selection-heading">
          <div className="desktop-workflow-heading">
            <div>
              <p className="dashboard-eyebrow">01 / START</p>
              <h2 id="desktop-selection-heading">选择 CipherTalk JSON</h2>
              <p>年度源会进入统计；可选验证源只用于校验，不会贡献记录或日期。文件名、路径和消息正文不会显示在界面上。</p>
            </div>
            <span className={`workflow-state workflow-state-${desktopState}`}>{desktopStateLabel(desktopState)}</span>
          </div>
          <div className="desktop-source-actions">
            <button className="dashboard-button dashboard-button-primary" type="button" disabled={pendingCommand || !onboardingSeen} onClick={() => void selectSources("annual")}>选择年度源</button>
            <button className="dashboard-button" type="button" disabled={pendingCommand || !onboardingSeen} onClick={() => void selectSources("verification")}>选择可选验证源</button>
            <div className="source-counts" aria-live="polite"><span>年度源：{annualCount} 个</span><span>验证源：{verificationCount} 个</span></div>
            <p id="start-analysis-description" className="visually-hidden">当前已选择 {annualCount} 个年度源；数据只在本地处理，不上传聊天记录。</p>
            <button className="dashboard-button dashboard-button-primary" type="button" aria-describedby="start-analysis-description" disabled={!canStart} onClick={() => void start()}>开始分析</button>
          </div>
          <p className="desktop-privacy-note">本地处理 · 用户主动选择 · 多文件合并、排序和去重 · 可取消 · 本地 Alpha</p>
        </section>
      ) : null}

      <section className="desktop-status-card" aria-labelledby="desktop-status-heading" aria-live="polite">
        <div>
          <p className="dashboard-eyebrow">02 / WORKFLOW STATUS</p>
          <h2 id="desktop-status-heading">{status}</h2>
          <p className="desktop-status-copy">当前状态：{desktopStateLabel(desktopState)}{progress === undefined ? "" : ` · ${progress.source === "analytics" ? workerPhaseLabel(progress.phase as WorkerProgress["phase"]) : desktopPhaseLabel(progress.phase as DesktopPhase)}`}</p>
          {progress !== undefined ? (
            <div className="desktop-progress" aria-label="本地分析进度">
              <div className="desktop-progress-line"><span>{progress.source === "analytics" ? workerPhaseLabel(progress.phase as WorkerProgress["phase"]) : desktopPhaseLabel(progress.phase as DesktopPhase)}</span><strong>{Math.round(progress.percentage)}%</strong></div>
              <progress value={progress.percentage} max={100} aria-label={`${progress.source === "analytics" ? workerPhaseLabel(progress.phase as WorkerProgress["phase"]) : desktopPhaseLabel(progress.phase as DesktopPhase)} ${Math.round(progress.percentage)}%`} />
              <div className="desktop-progress-meta"><span>{progress.total > 0 ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}` : "阶段总量未知"}</span><span>{progressDuration}</span></div>
            </div>
          ) : null}
        </div>
        <div className="desktop-status-actions">
          <button className="dashboard-button" type="button" disabled={!canCancel} onClick={() => void cancel()}>取消</button>
          {failure?.retryable === true && !failure.code.startsWith("EXPORT_") ? <button className="dashboard-button" type="button" disabled={pendingCommand} onClick={() => void retry()}>重试</button> : null}
          {failure !== undefined && !failure.code.startsWith("EXPORT_") ? <button className="dashboard-button" type="button" disabled={pendingCommand} onClick={() => void selectSources("annual")}>重新选择</button> : null}
        </div>
      </section>

      {failureText !== undefined ? (
        <section className="desktop-alert" role="alert" aria-labelledby="desktop-error-heading">
          <h2 id="desktop-error-heading">{failureText}</h2>
          <p className="desktop-error-code">错误码：<code>{failure?.code}</code></p>
          <p>应用只显示稳定的本地错误说明，不显示路径、命令、日志、正文或内部堆栈。</p>
          {failure?.code.startsWith("EXPORT_") && exportAttemptRef.current !== undefined ? (
            <button className="dashboard-button" type="button" disabled={pendingCommand} onClick={() => void exportAggregate(exportAttemptRef.current!.format, exportAttemptRef.current!.chartKey)}>重试导出</button>
          ) : null}
          {failure?.code === "CLEANUP_REQUIRED" || failure?.code === "SESSION_CLEANUP_FAILED" ? <button className="dashboard-button" type="button" disabled={pendingCommand} onClick={() => void retry()}>重试清理</button> : null}
        </section>
      ) : null}

      {analyticsError !== undefined ? (
        <section className="desktop-alert" role="alert" aria-labelledby="analytics-error-heading">
          <h2 id="analytics-error-heading">本地统计未提交</h2>
          <p>{analyticsError}</p>
          <button className="dashboard-button" type="button" disabled={analyticsPending} onClick={retryAnalytics}>重试本地统计</button>
        </section>
      ) : null}

      {analyticsResult !== undefined ? (
        <DesktopDashboard
          result={analyticsResult}
          pending={analyticsPending || pendingCommand}
          onFilterChange={(filters) => void updateAnalyticsFilters(filters)}
          onAnalyzeOtherFiles={() => void analyzeOtherFiles()}
          onExport={(format, chartKey) => void exportAggregate(format, chartKey)}
        />
      ) : null}

      {dataset !== undefined && analyticsResult === undefined && !analyticsPending ? (
        <section className="desktop-handoff-card" aria-live="polite">
          <p className="dashboard-eyebrow">03 / VERIFIED DATASET</p>
          <h2>本地分析数据已准备，等待结果</h2>
          <p>Worker 正在使用 opaque dataset capability；界面不会接触操作系统路径或消息内容。</p>
        </section>
      ) : null}

      {exportMessage !== undefined ? <p className="desktop-export-status" role="status" aria-live="polite">{exportMessage}</p> : null}

      {closeDialogOpen ? (
        <div className="desktop-dialog-layer">
          <section className="desktop-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-heading">
            <p className="dashboard-eyebrow">APPLICATION CLOSE</p>
            <h2 id="close-dialog-heading">退出并清理本地会话？</h2>
            <p>活动中的本地任务会先取消；应用会等待受控清理完成，或显示需要再次清理的状态。</p>
            <div className="desktop-dialog-actions"><button className="dashboard-button" type="button" onClick={() => setCloseDialogOpen(false)}>继续使用</button><button className="dashboard-button dashboard-button-primary" type="button" onClick={() => void confirmClose()}>退出并清理</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
