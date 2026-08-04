import type {
  DesktopFailureCode,
  DesktopPhase,
  DesktopState,
} from "../desktop/ipc-contract";
import type { WorkerPhase } from "../worker-analysis/protocol";

export const DESKTOP_STATE_LABELS: Readonly<Record<DesktopState, string>> = {
  idle: "等待选择",
  selecting: "正在选择源文件",
  ready: "源文件已准备好",
  preprocessing: "正在验证并整理源文件",
  handoff: "正在准备本地分析数据",
  analyzing: "正在计算本地统计",
  complete: "结果已准备好",
  cancelling: "正在取消本地分析",
  failed: "本地分析未完成",
  discarding: "正在清理本地临时数据",
  closing: "正在关闭并清理",
};

export const DESKTOP_PHASE_LABELS: Readonly<Record<DesktopPhase, string>> = {
  selection: "选择源文件",
  validation: "验证选择",
  preprocessing: "验证、合并、排序和去重",
  handoff: "准备本地分析数据",
  transport: "读取本地数据通道",
  hash: "校验数据完整性",
  parse: "解析 canonical records",
  index: "构建共享索引",
  tokenization: "构建文本统计索引",
  aggregation: "计算统计结果",
  cleanup: "清理本地临时数据",
};

const FAILURE_MESSAGES: Readonly<Partial<Record<DesktopFailureCode, string>>> = {
  UNSUPPORTED_PROTOCOL_VERSION: "应用协议版本不兼容，请重新启动应用。",
  INVALID_REQUEST: "这次本地操作无效，请重新开始。",
  COMMAND_NOT_ALLOWED: "这项操作在当前应用状态不可用。",
  INVALID_SESSION: "本地分析会话已失效，请重新选择文件。",
  INVALID_GENERATION: "本地分析代次已失效，请重新开始。",
  INVALID_STATE: "当前状态不能执行这项操作。",
  STALE_GENERATION: "较早的本地分析已被忽略，请查看当前结果。",
  STALE_EVENT: "较早的状态更新已被忽略。",
  WINDOW_NOT_AUTHORIZED: "当前窗口无法执行这项本地操作。",
  CONTRACT_ONLY: "这项操作只用于本地协议校验。",
  SESSION_BUSY: "已有本地分析正在进行。",
  SESSION_STALE: "本地分析会话已过期，请重新选择文件。",
  SIDECAR_UNAVAILABLE: "本地预处理组件不可用，请重试或重新启动应用。",
  SIDECAR_VERIFICATION_FAILED: "本地预处理组件校验失败，请重新启动应用。",
  SIDECAR_SPAWN_FAILED: "本地预处理进程未能启动，请重试。",
  SIDECAR_START_FAILED: "本地预处理未能启动，请重试。",
  SIDECAR_HANDSHAKE_TIMEOUT: "本地预处理响应超时，请重试。",
  PREPROCESSING_STALLED: "本地预处理长时间没有进展，已安全停止，可重试。",
  SIDECAR_PROTOCOL_MISMATCH: "本地预处理协议不兼容，请重试。",
  SIDECAR_PROTOCOL_FAILED: "本地预处理通信失败，可重试。",
  SIDECAR_EXITED: "本地预处理已结束但没有完成结果，请重试。",
  SIDECAR_EXITED_UNEXPECTEDLY: "本地预处理意外退出，可重试。",
  SESSION_CANCELLED: "本次本地分析已取消。",
  SESSION_CLEANUP_FAILED: "本地临时数据尚未清理完成，可在应用内重试。",
  PROCESS_IDENTITY_MISMATCH: "本地任务身份发生变化，已安全停止。",
  SIDECAR_PROTOCOL_INVALID: "本地预处理返回了无效结果，请重试。",
  SIDECAR_CRASHED: "本地预处理异常退出，可重试。",
  DATASET_TRANSPORT_INVALID: "本地分析数据通道校验失败，可重试。",
  MEMORY_PRESSURE: "本地分析需要更多可用内存，请减少文件范围后重试。",
  WORKER_RUNTIME_FAILED: "本地统计 Worker 未完成，可重试。",
  CLEANUP_REQUIRED: "本地临时数据需要再次清理，可在应用内重试。",
  NO_SOURCE_SELECTED: "请先选择至少一个年度 CipherTalk JSON。",
  SOURCE_COUNT_EXCEEDED: "选择的年度源数量超过当前 Alpha 上限。",
  UNSUPPORTED_FILE_TYPE: "仅支持 CipherTalk detailed JSON 文件。",
  SOURCE_UNREADABLE: "选择的源文件无法读取或已发生变化。",
  DUPLICATE_SOURCE: "同一个源文件不能承担多个源角色。",
  SOURCE_SET_INVALID: "源文件集合未通过本地校验，请重新选择。",
  SELECTION_STALE: "源选择已过期，请重新选择文件。",
  DISK_SPACE_INSUFFICIENT: "应用缓存空间不足，未提交本地分析数据。",
  DATASET_HANDOFF_INVALID: "本地分析数据交接校验失败，可重试。",
  DATASET_TAMPERED: "本地分析数据完整性校验失败，可重试。",
  DIALOG_UNAVAILABLE: "当前平台无法打开原生文件选择器。",
  EXPORT_BUSY: "已有导出正在进行，请等待当前保存流程结束。",
  EXPORT_RESULT_PENDING: "当前聚合结果仍在计算，请等待完整结果后重试。",
  EXPORT_STALE_RESULT: "当前导出结果已过期，请回到最新结果后重试。",
  EXPORT_SCHEMA_INVALID: "当前聚合结果未通过导出契约校验，请重试本地统计。",
  EXPORT_LIMIT_EXCEEDED: "导出结果超过本地文件大小或行数限制。",
  EXPORT_RENDER_FAILED: "批准的图表无法渲染为 PNG，请重试。",
  EXPORT_PERMISSION_DENIED: "保存位置不可写，请选择其他本地位置。",
  EXPORT_DISK_FULL: "保存位置空间不足，请选择其他本地位置。",
  EXPORT_WRITE_FAILED: "本地导出写入失败，请重试。",
  EXPORT_FLUSH_FAILED: "本地导出未能完成落盘，请重试。",
  EXPORT_DURABILITY_UNCERTAIN: "本地导出已写入但持久化状态不确定，请检查目标文件后再继续。",
  EXPORT_RENAME_FAILED: "本地导出未能安全替换目标文件，请重试。",
  EXPORT_CLEANUP_REQUIRED: "导出临时文件需要清理，请重试导出。",
  EXPORT_RESULT_NOT_FOUND: "当前导出结果不存在，请重新运行本地统计。",
};

export function desktopFailureMessage(code: DesktopFailureCode | undefined): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  return FAILURE_MESSAGES[code] ?? "本地操作未完成，可重试或重新选择文件。";
}

export function desktopPhaseLabel(phase: DesktopPhase): string {
  return DESKTOP_PHASE_LABELS[phase];
}

export function workerPhaseLabel(phase: WorkerPhase): string {
  const labels: Readonly<Record<WorkerPhase, string>> = {
    transport: "读取本地数据通道",
    manifest: "验证 manifest",
    hash: "校验数据完整性",
    parse: "解析 canonical records",
    index: "构建共享索引",
    wasm: "初始化本地分词",
    records: "验证 canonical records",
    tokenization: "构建文本统计索引",
    base: "计算共享基础聚合",
    sessionization: "按阈值划分会话",
    derived: "整理本地统计结果",
    aggregation: "计算统计结果",
  };
  return labels[phase];
}

export function desktopStateLabel(state: DesktopState): string {
  return DESKTOP_STATE_LABELS[state];
}

export function isDesktopCancellableState(state: DesktopState): boolean {
  return ["preprocessing", "handoff", "analyzing"].includes(state);
}

export function isDesktopResultState(state: DesktopState): boolean {
  return state === "complete";
}

export function durationBucket(elapsedMilliseconds: number): string {
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 5_000) {
    return "刚刚开始";
  }
  if (elapsedMilliseconds < 30_000) {
    return "正在处理";
  }
  if (elapsedMilliseconds < 120_000) {
    return "处理时间较长，仍在本地进行";
  }
  return "处理仍在本地进行，可以取消";
}
