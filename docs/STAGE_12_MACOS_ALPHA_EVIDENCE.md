# Stage 12 macOS Alpha 合成验收记录

本记录只描述合成/公开 fixture 验证，不构成真实数据验收，也不包含真实路径、姓名、
正文、联系人或私有统计。最终 artifact 的绝对路径和 SHA-256 只在本地交付报告中提供。

## 真实 Stage 12 范围

真实标题为 **Synthetic End-to-End, Capacity, Documentation, and Authorization Gates**，
任务为 12.1–12.9。D.1–D.10 是后置 Release hardening；Stage 13.10 和 Stage 15.10
仍是用户明确授权的真实数据边界。

| Task | Alpha 状态 | 证据边界 |
| --- | --- | --- |
| 12.1 | 合成 fixture gate | Python、Worker、metric、filter、threshold、empty/partial/duplicate/cross-boundary 矩阵 |
| 12.2 | 完成（Alpha synthetic boundary/representative gate） | 已运行 100,000-event representative 与 2,000,000-event/约 512 MiB boundary profile；记录 phase、取消、restart、cache、typed-array/RSS；不把 D.9 formal certification 写成已完成 |
| 12.3 | synthetic desktop gate | 多文件、verification、dedupe、media-only、failure/retry、multi-year handoff、close/recovery、export、offline |
| 12.4 | 完成 | Windows 只记录 target-built sidecar、Unicode path、Job Object、cache、signing、installer 后续要求 |
| 12.5 | 完成 | 用户手册、release notes、build/verify 入口和版本身份文档 |
| 12.6 | 完成 | 规范/代码/测试/授权边界复核；未执行真实数据 checkpoint |
| 12.7 | USER-MANUAL — NOT EXECUTED BY AGENT | 不发现、不打开 `data/private`，等待单独授权 |
| 12.8 | USER-MANUAL — NOT EXECUTED BY AGENT | 不执行 Stage 15.10 或 full productized real-data acceptance |
| 12.9 | 完成 | final synthetic matrix、package、offline、OpenSpec、Git hygiene |

## Multi-year handoff correction batch

The correction is validated only with generated fixtures. A five-source
2022–2026 case publishes 11 raw accepted events as 10 canonical events and 1
duplicate, with `sourceCount=5`; the manifest event count equals the sum of its
chunk descriptors, and the fixed publication marker is present. Additional
synthetic probes covered a 60,000-event five-source publication, a forced
8,192-byte chunk profile with 60,005 canonical events and 10,750 duplicates
across 1,924 chunks, and a literal-comparison content case (`1 < 2`). Python
publication and Rust host verification accepted all three regenerated outputs.

The host keeps the main UI code `DATASET_HANDOFF_INVALID` and exposes only
stable reason codes such as `HANDOFF_PUBLICATION_INCOMPLETE`,
`HANDOFF_CHUNK_MISSING`, `HANDOFF_EVENT_COUNT_MISMATCH`,
`HANDOFF_HASH_MISMATCH`, and `HANDOFF_DUPLICATE_IDENTITY_INVALID`. Source
failures remain in the separate `SOURCE_*` namespace. No path, raw content,
identifier, hash, or traceback is included in the public diagnostic.

The packaged synthetic smoke remains the vertical integration gate. A real
2022–2026 CipherTalk import, real-data analytics result, and any user-visible
behavioral confirmation remain manual work under 12.7/12.8.

## Synthetic capacity evidence

最终 2,000,000-event profile 使用现场生成的 synthetic canonical v2 chunks，未将完整
dataset 保留在测试夹具内：

| Field | Observed value |
| --- | --- |
| Engine / host | Node v26.3.0 + Vitest；macOS arm64；16 GiB |
| Input | 2,000,000 events；16 chunks；535,502,549 bytes / 510.70 MiB；32 MiB chunk cap respected |
| Time span | synthetic multi-year calendar range |
| Load / first query | 23,972 ms / 5,929 ms |
| Restart | 24,485 ms；same typed-array summary and DTO determinism |
| Retained typed-array bytes | 157,934,276 |
| Peak test-process RSS | 1,073,446,912 bytes |
| Cancellation acknowledgement | 2.57 ms；passed |
| Cached query p95 | 0 ms in the deterministic cache harness |
| Main-thread heartbeat | not measured by this direct runtime harness; production runtime is a Web Worker |
| Direct harness event-loop gap | 2,710.85 ms; this is not product main-thread evidence |

This is Alpha boundary/representative evidence only. The formal browser/renderer heartbeat,
peak-memory, cancellation-latency, and p95 certification remains D.9/deferred Release work;
the Alpha does not claim machine-independent maximum-capacity or Release readiness.

## 自动验证约束

- 输入全部是仓库公开 mock 或测试运行时临时生成的 synthetic fixture；
- 只允许对 `data/private` 执行 `git check-ignore -v data/private`；
- 不执行 Stage 13.10、Stage 15.10，不读取真实 CipherTalk JSON；
- `.app`、`.dmg`、`target/`、`dist/`、sidecar build/cache 和测试导出均保持 Git ignored；
- artifact 使用 package manifest 的相对名称交付，绝对路径和 hash 由本地最终报告给出。

## Alpha 与 Release 边界

Alpha 验收要求 packaged sidecar、Tauri host、Worker、Dashboard、export、offline、
cleanup/relaunch 和合成容量 representative path 可供用户手动测试；Developer ID、
notarization、stapling、formal clean-machine Release、exhaustive tamper/lifecycle/IPC
矩阵、D.9 的正式 512 MiB/p95/resource/heartbeat certification 和 Windows 均保持 deferred。
