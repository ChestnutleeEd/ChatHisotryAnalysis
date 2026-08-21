# V3 Final Synthetic Evidence Inventory + Standard Candidate Regeneration Handoff

模型：Luna Max
日期：2026-08-21
范围：Beta Visual Experience V3 的最终 synthetic/package evidence inventory 与 user handoff preparation，并记录确认 startup crash 修复后的 Standard packaged user candidate regeneration。本批不做 implementation、remediation、OpenSpec 变更或 7.4 release stop gate。

Freshness 约定：`RE-RUN IN 7.3` 只表示本批实际重新执行；`REUSED FROM COMPLETED 7.2 ACCEPTANCE` 表示沿用已完成 7.2 的有效 synthetic evidence，本批没有为了写报告重复整套重型 suite。

## 1. Result

```text
PASS
7_3_HANDOFF_READY=true
STANDARD_CANDIDATE_REGENERATED=true
PREVIOUS_STANDARD_CANDIDATE_OBSOLETE=true
V3_READY=false
REAL_DATA_USER_ACCEPTANCE_PENDING=true
7.4 NOT STARTED
```

本批没有 frontend/product behavior change，也没有把 synthetic/package acceptance 误写成真实数据最终产品验收完成。Packaging flow 只刷新了与当前 source revision 绑定的 sidecar trust anchor，并生成新的 Standard artifact。

## 2. Repository Baseline

- initial HEAD：`789c384bc16e5cfe96756803c27d0999c919fed2`
- reference HEAD：`789c384bc16e5cfe96756803c27d0999c919fed2`
- branch：`feat/implement-local-chat-wordcloud-mvp`
- initial workspace：clean；`git status --short` 无输出
- initial upstream：`git rev-list --left-right --count HEAD...@{upstream}` → `1 0`
- recent HEAD commits：`789c384 fix: repair pre-existing macOS cache permissions`、`fb79b07 docs: pass v3 release stop gate`、`8033f18 docs: finalize v3 acceptance evidence`
- privacy boundary command：`git check-ignore -v data/private` → `.gitignore:4:data/private/	data/private`

除该 ignore check 外，本批没有列出、搜索、遍历、打开或读取 `data/private`，没有导入真实 JSON、真实聊天、联系人、关键词或统计。

## 3. OpenSpec 7.3

7.3 exact wording：

> 7.3 [Luna Max] Update the final evidence inventory and handoff with exact commands, results, known non-blocking limitations, and an explicit statement that real-data final product acceptance belongs to the user in the local application.

结果：满足。OpenSpec progress 为 `43/45` → 本批勾选后 `44/45`。

7.4 exact wording（未执行、未勾选）：

> 7.4 [Sol xHigh — RELEASE STOP GATE] Review the bounded fixes and final evidence, confirm all blockers closed and all functional/privacy authorities preserved, stage only exact approved paths, commit, push, verify clean worktree and upstream `0 0`, then hand control to the user for real-data acceptance.

## 4. Final Package Candidate

用户进行 real-data acceptance 的主候选是 **Standard final packaged-offline acceptance package**：

`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z`

原因是 packaging authority 的 Standard 路径最终 app 以 `--no-default-features --bin chat-history-analysis` 构建，不编译 synthetic-dialog test-only IPC，也不使用 B5 feature。正常 harness 的 adapter 只位于独立的 ignored selection-smoke target，不会进入 Standard app 或 DMG。该 root 的 Standard manifest 记录了 arm64、bundle-relative sidecar、selection/worker/packaged vertical smoke、offline block 和 clean host close 均通过；本批另行执行了 DMG fresh-copy、正常关闭/重启和 0755 cache-root repair regression。

B5 package 是受保护的 acceptance evidence package，不是主候选：它使用 `--b5-acceptance` 与 `packaged-b5-acceptance` feature，专门证明 protected Share Preview/native AppKit save/cancel/retry/readback。它保留用于 7.4 review 和 Share regression 对照。

## 5. Package Paths

Standard final candidate：

- root：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z`
- 可交给用户的 copied app：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/clean-install/Applications-like/Chat History Analysis.app`
- fresh-install regression copy：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/startup-regression/fresh-install/Applications-like/Chat History Analysis.app`
- DMG 内 staging app：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/dmg-staging/Chat History Analysis.app`
- DMG：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/Chat History Analysis Prototype.dmg`
- manifest：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/package-manifest.json`

B5 protected package：

- root：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z`
- copied app：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z/clean-install/Applications-like/Chat History Analysis.app`
- DMG：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z/Chat History Analysis Prototype.dmg`
- manifest：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z/package-manifest.json`

两个 root、manifest、DMG、staging app 和 clean-install app 均已在本批确认仍存在。manifest 的 `app.relativePath` 是 package/staging 内部 bundle name，不代表 root 顶层必须另有一个 `.app`。

## 6. Package Integrity

两份 manifest 都记录：macOS arm64、minimum macOS `11.0`、bundle identifier `com.chathistoryanalysis.desktop`、version `0.1.0`、bundleVersion `1`、60 个 arm64 Mach-O member、bundle-relative sidecar、DMG `verified=true`、`mountedCopiedUnmounted=true`、tampered member rejected、wrong-architecture member rejected。

| Package | manifest app SHA-256 | manifest executable SHA-256 | manifest DMG SHA-256 | independent verification |
| --- | --- | --- | --- | --- |
| B5 | `97e820fb686b3d717801002c78bd4d9ae08fe794a3143b2b0d5112c66b4b5c65` | `1a939958b0f9666bc36df3f40692bd32ad7ae5c7899f5bd3800eefaa13dabc76` | `b2523592d6b5f7d0c9807c64e7b294f49963ed015f65e1e82513f4f6924fea5f` | app tree, executable and DMG all equal |
| Standard (new candidate) | `790be9015e22d7361dec11f1f60b3ea0e4dc399a707796af37fcfb46678147b8` | `183b0b53d476b2e5f10eec4f2af571c52597e2fb0192694393e4d94fbdbfae94` | `5e29d2c3d14e5453f93e36c3b2dcbeb06524244eb9db56603cf06e1be8344512` | app tree, executable and DMG all equal |

`RE-RUN IN FINAL STANDARD REGENERATION` commands/results：

- `jq . <package>/package-manifest.json`：两份 manifest 均可解析。
- `shasum -a 256 <B5 DMG> <Standard DMG>`：分别得到上表 DMG hash。
- 独立重算 app tree hash（按 manifest 的 relative-path + NUL + file bytes 规则）与 executable hash：两份 app hash、byte count、executable hash 均与 manifest 一致。
- `codesign --verify --deep --strict --verbose=1 <copied .app>`：B5、Standard 均 `valid on disk` / `satisfies their Designated Requirement`。
- `hdiutil verify <B5 DMG>`、`hdiutil verify <Standard DMG>`：两者均 `VALID`。
- `file -b <copied .app>/Contents/MacOS/chat-history-analysis`：两者均 `Mach-O 64-bit executable arm64`。

## 7. Package Sizes

| Package | app bytes (manifest) | copied app `du -sk` | DMG bytes | package root `du -sk` |
| --- | ---: | ---: | ---: | ---: |
| B5 | `38,062,089` | `37,312 KiB` | `16,613,964` | `229,736 KiB` |
| Standard (new candidate) | `37,995,945` | `37,248 KiB` | `16,594,769` | `1,432,564 KiB` |

Standard root 较大主要因为保留了 `selection-smoke-target` 的构建产物；这是当前 successful package inventory 的一部分，本批不删除。

## 8. B5 Protected Package

B5 用途：protected B5 Share Preview acceptance，包括 vocabulary off/on、Canvas/PNG RGBA parity、native `NSSavePanel` save/cancel、overwrite retry、offline sandbox、bundle-relative artwork、quit/restart 和 temporary PNG cleanup。

- root：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z`
- DMG SHA-256：`b2523592d6b5f7d0c9807c64e7b294f49963ed015f65e1e82513f4f6924fea5f`
- app SHA-256：`97e820fb686b3d717801002c78bd4d9ae08fe794a3143b2b0d5112c66b4b5c65`
- manifest 的 B5 synthetic evidence：`sharePreview=passed`、`vocabularyOff=passed`、`vocabularyOn=passed`、native AppKit save/cancel/retry 均标记 `actual-packaged-AppKit`、`networkAttempts=0`、`temporaryPngCleanup=passed`。

它与 Standard 的区别是 acceptance feature surface，而不是用户功能语义；B5 的 test-only capability 只为该 synthetic packaged smoke 编译，不能替代最终用户 app。

## 9. F-01 Closure Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`，证据文件：`frontend/tests/browser/beta-v36-remediation.spec.ts`，并由 7.3 重读测试代码与 commit `6d52b4c`/`5554f7a` 确认。

- Annual effective-width authority：`container-type:inline-size`、`container-name:annual-workspace`；无 JS layout measurement。
- true `760×900` + `documentElement.zoom=2`：Opening PASS、Rhythm PASS、Vocabulary PASS、Closing PASS。
- true zoom 下 Rhythm Weekday/Hour、Vocabulary Frequent/Keywords/Cloud、Closing copy/art 均按 Narrow flow；控件/CTA 至少 44px；无 page overflow。
- normal `1180×760`、`760×900`、`380×900` smoke：PASS。
- no Worker authority change、no Canvas geometry change、no Share authority change。

## 10. F-02 Closure Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`，证据文件：`frontend/tests/browser/beta-v36-remediation.spec.ts`。

All → draft `2025` → route switch → return → draft persists → Apply → committed `2025`，PASS。Committed context 在 explicit Apply 前保持 All，Apply 后才更新；没有 implicit Apply，也没有 query/analytics semantics change。

## 11. F-03 Closure Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`，实现和单元证据：`frontend/src/presentation/analytics-error-classifier.ts`、`frontend/tests/analytics-error-classification.test.ts`。

classification contract：

- cancellation：`WorkerClientCancelledError`
- known Worker/recoverable failure：`WorkerClientError`
- known analytics contract failure：`INVALID_RESULT`、`INVALID_REPLY_SESSION_RESULT`
- unexpected error：保留 diagnostics，并在既有 `updateAnalyticsFilters` catch boundary cleanup 后 rethrow

测试覆盖每类、cleanup ordering 和 unexpected programmer error rethrow，PASS。

## 12. Home Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`，证据文件：`frontend/tests/browser/beta-v35-cross-product.spec.ts`、`frontend/tests/browser/beta-shell.spec.ts` 与 Standard packaged selection smoke。

Synthetic completed dataset 下 Home ready、Annual CTA、Detailed CTA、reselect、focus transfer、responsive composition、true zoom/Narrow entry 均 PASS。稳定 test locator 是 `data-testid="beta-home-annual-report"`；它只服务于 presentation-neutral smoke 定位，visible wording 和行为未改变。

## 13. Annual Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`。Opening、Scale、Rhythm、Balance、Conversation、Vocabulary、Closing 七场顺序、logical anchors、exact alternatives、sparse/partial state、responsive composition 和 reduced-motion final state 均 PASS。

重点 closure：Opening provenance/range、Scale message total + active days/streak、Rhythm month/weekday/hour、Balance Owner/Other + length/type、Conversation session/reply、Vocabulary frequent/keywords/cloud、Closing poster/Share/Detailed CTA。F-01 true zoom fix 已关闭；没有重新定义视觉历史，也没有改变事实或 authority。

## 14. Detailed Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`。8 routes 均 PASS：Overview、Trends、Comparison、Activity、Words & Years、Message Types、Replies & Sessions、Export。

覆盖：Draft/Apply、year、session threshold、known error resilience、route switching、representative charts/tables、responsive collapse、200% equivalent viewport、labelled local table scroll、keyboard route semantics 和 exact alternatives。

## 15. Share Protected Evidence

Browser Share acceptance：**PASS**，证据文件：`frontend/tests/browser/beta-share-preview.spec.ts`。

Packaged B5 Share acceptance：**PASS**，证据为 B5 `package-manifest.json` 的 `cleanUserSynthetic` 和 `previewRenderEvidence`。

两层 evidence 覆盖：ready、Vocabulary opt-in/off/on、hidden-word/clean state、cancel、retry、native save、RGBA/PNG decode、opaque output、forbidden PNG chunks absent、focus entry/return、offline sandbox。B5 manifest 记录 PNG `1200×1500`、`opaque=true`、actual packaged AppKit save/cancel/retry；Canvas/PNG/native save authority 未被 V3.6 或 7.3 改写。

## 16. Worker / Canvas Evidence

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`，证据文件：`frontend/tests/word-cloud-layout-diagnostics.test.ts`、`frontend/tests/word-cloud-layout.test.ts`、`frontend/tests/word-cloud-layout-integration.test.ts`、`frontend/tests/browser/beta-word-cloud.spec.ts`、`frontend/tests/browser/v3-geometry.spec.ts`。

- determinism：synthetic layout request 的 seed/rank/order 与 repeated layout 结果稳定。
- authority：Word Cloud placement 在 Worker；Canvas 只负责已放置 geometry 的 presentation/draw。
- stale fencing：新 digest/取消/隐藏 document/unmount/input 会取消或丢弃旧 presentation，不提交 stale result。
- `mainThreadLayoutCalls=0`：PASS。
- long tasks：7.2 browser preview evidence 记录 Word Cloud long-task count `0`；diagnostic inventory 的 `longTasks=[]`。
- Canvas accessible alternative：Canvas `aria-hidden`，完整 ranked list 保留 token/rank/count/rate/role/year evidence。

## 17. Responsive / True 200%

固定 synthetic matrix：`1440×900`、`1180×760`、`760×900`、`380×900`，以及 200% equivalent/Narrow。各目标 viewport 的 Home、Annual 七场、Vocabulary states、Detailed routes、Share smoke 均有 7.2 PASS evidence；page-level overflow、covered heading、clipped focus、two-dimensional page scroll 均未成为 blocker。

F-01 的真实 `760×900` + `documentElement.zoom=2` 是额外 closure，已在第 9 节记录；true zoom blocker 已关闭。

## 18. Accessibility

`REUSED FROM COMPLETED 7.2 ACCEPTANCE`：

- semantic structure：headings、landmarks、nav、fieldsets、labels、figures、tables、details/disclosures；
- keyboard：Home → Annual → Detailed、dock/chapter、native selects、Vocabulary controls、Share dialog、8 route tabs；
- focus：`:focus-visible`、dialog/disclosure focus return、anchor clears dock；
- 200% zoom/reflow：Narrow controls and CTAs remain reachable and at least 44px where required；
- reduced motion：same final semantic state, geometry and focus without animation；
- chart alternatives：exact ordered list/table/definition remains available；
- Canvas list：Canvas is decorative/presentation-only, ranked alternative is complete；
- Detailed tables：only labelled local scroll regions may scroll horizontally；
- role/selection/status/peak/partial meaning is not color-only；
- F-01 true zoom blocker：closed。

## 19. Offline Evidence

- Browser offline evidence：`REUSED FROM COMPLETED 7.2 ACCEPTANCE`；dev/preview runner 的 non-loopback HTTP(S)/WebSocket block and no-remote-request assertions PASS。
- Packaged B5 network sandbox：manifest `networkBlocked=passed`、`networkAttempts=0`；B5 uses `deny network*` and still passes Share/PNG smoke。
- Standard packaged network-block smoke：manifest `networkBlocked=passed`、`privacy.networkDependency=false`；Standard manifest 没有记录 numeric `networkAttempts`，本报告不把它伪写成 `0`。

## 20. Backend/Core Evidence

除第 20 节最后一行外，均为 `REUSED FROM COMPLETED 7.2 ACCEPTANCE`，没有在 7.3 重跑完整 backend suite。

| Area | Exact command | Result |
| --- | --- | --- |
| Python repository standard | `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3.12 -m unittest discover -s tests -v` | `208 passed, 22 skipped` |
| Rust format | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| Rust library/integration | `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --tests` | `73 library passed, 21 integration passed, 3 ignored` |
| Stage11 focused source contract | `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3.12 -m unittest tests.test_stage11_productization -v` | **RE-RUN IN 7.3：9 passed** |

Python invocation 使用 repository-standard `python3.12 -m unittest discover`，没有把裸 Python collection error 作为推荐命令。Rust ignored tests 是 packaged AppKit runtime boundary，不是本批新失败。

## 21. Frontend Evidence

均为 `REUSED FROM COMPLETED 7.2 ACCEPTANCE`；7.3 未重复全套 frontend/browser suite。

| Area | Exact command | Result |
| --- | --- | --- |
| Type-check | `npm --prefix frontend run type-check` | PASS |
| Lint | `npm --prefix frontend run lint` | PASS |
| Unit | `npm --prefix frontend run test` | `289 passed, 1 skipped` |
| Browser dev | `npm --prefix frontend run test:browser:dev` | `52 passed` |
| Browser preview | `npm --prefix frontend run test:browser:preview` | `52 passed` |

Focused F-01/F-02 browser evidence is in `beta-v36-remediation.spec.ts`; F-03 unit evidence is in `analytics-error-classification.test.ts`; Word Cloud/geometry/Share evidence paths are listed above. Screenshot and geometry files are generated acceptance artifacts rather than newly tracked source files; 7.3 inventories the completed 7.2 evidence and does not fabricate a fresh screenshot run.

## 22. Synthetic IPC / Test-Only Boundary

本批实际读取了 `src-tauri/src/ipc.rs`、`src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、HEAD diff 以及 `scripts/package_macos_prototype.py`。

- `ipc.rs` 的 `record_selection_smoke`、`record_selection_smoke_checkpoint`、`record_selection_smoke_host_state`、`record_b5_render_evidence` 均标记 `#[cfg(feature = "synthetic-dialog-adapter")]`；checkpoint 是固定 allowlist，render evidence 只接受固定 dimensions/size/digest，不接受 renderer path/content。
- `lib.rs` 的 injected packaged smoke script 与 synthetic command registration 同样受 `synthetic-dialog-adapter` feature gate 约束。
- `Cargo.toml` 定义 `packaged-b5-acceptance = ["synthetic-dialog-adapter"]`、`packaged-b6-acceptance = ["synthetic-dialog-adapter"]`；production/default app 的 invoke handler 走 `#[cfg(not(feature = "synthetic-dialog-adapter"))]` 分支。
- Standard final app 的 packaging command 以 `--no-default-features --bin chat-history-analysis` 构建；selection smoke adapter 是单独的 temporary build target，不是最终 user app。
- B5 需要该 feature 是因为 packaged Share acceptance 必须在 synthetic app 内记录固定 checkpoints、render digest 和 native save evidence；这不扩大 production security/privacy authority。

结论：synthetic capability gating、production/default exposure judgment 和 packaged need 均可由当前 code/script 证明；没有新增 blocker，也不需要因“无法解释”添加额外 7.4 debt。7.4 仍应按其 stop-gate scope 复核这项敏感 evidence。

## 23. Packaging Harness Changes

HEAD 的 packaging harness 变化已实际读取，目的如下：

- stable Home selector：`BetaHome.tsx` 的 `data-testid="beta-home-annual-report"`，Rust smoke 使用该 presentation-neutral selector，避免依赖可见文案；visible wording/behavior unchanged；
- `ApplePersistenceIgnoreState`：统一 Finder-equivalent、B5、B6、Standard smoke 的 launch arguments，避免 macOS persisted UI state 影响 synthetic acceptance；
- failure diagnostics：packaged B5/Standard smoke 将 stdout/stderr 收集到明确 root，失败后移除已知临时日志；
- manifest hashes：增加 app tree SHA-256、main executable SHA-256/bytes、DMG SHA-256/bytes，便于后续 handoff/integrity review。

这些变化没有弱化 B5 Share acceptance、selection smoke 或 offline sandbox；B5 仍执行 actual packaged AppKit save/cancel/retry 和 `deny network*`，Standard 仍执行 packaged selection/worker smoke。

## 24. Privacy

所有 Agent acceptance、browser fixture、package smoke、manifest evidence 和本报告均为 **synthetic-only**。

- Agent 没有读取真实数据。
- Agent 没有选择、打开、解析、截图、复制、分析或保存真实聊天内容。
- Agent 没有使用真实联系人、真实关键词、真实统计或真实 source path。
- 真实数据最终产品验收必须由用户本人在本地 packaged application 中执行。
- `REAL_DATA_USER_ACCEPTANCE_PENDING=true`；不得把它改为 synthetic completion 的副作用。

## 25. Known Non-Blocking Limitations

仅列当前 HEAD 和 7.1 frozen scope 中仍真实存在的项目：

- Vocabulary zero-state duplicate copy；
- Sparse Trends；
- Detailed 380 density；
- existing `>500k` frontend bundle warning；
- release signing/notarization 尚未完成。

这些不是本批新 blocker，也没有在 7.3 自行修复或扩大 scope。

## 26. Release Boundary

当前 artifact 是 **Beta/local user acceptance candidate**，不是 public release artifact。

manifest truth：`signing.mode=ad-hoc`、`developerId=false`、`notarized=false`、`stapled=false`；generated Tauri config 的 `hardenedRuntime=false`，minimum macOS `11.0`。因此本报告不使用 production-signed、Apple notarized、release-ready、public distribution 等表述。

本批未启动 notarization、Developer ID、updater、Windows、release distribution 或 7.4。

## 27. User Real-Data Acceptance Checklist

以下步骤只由用户本人执行，Agent 不读取结果、不截图、不分析、不复制、不保存真实内容，也不要求用户把真实数据发给 Agent：

1. 安装/打开第 28 节的 new Standard user candidate app。
2. 在本地 app 内手动选择真实聊天 JSON。
3. 确认 Home 正常进入 ready。
4. 打开 Annual。
5. 检查 Opening、Rhythm、Vocabulary、Closing。
6. 视需要切换 year、role；测试 Clean Mode 和 hidden words。
7. 打开 Detailed。
8. 检查 route switching、year Draft/Apply、threshold、representative charts。
9. 打开 Share Preview。
10. 测试 Vocabulary opt-in，以及 PNG save/cancel。
11. 确认无明显空白、无错位、无 crash，且数据范围正确。

发现问题时只保留用户自己的本地复现信息和脱敏错误码；不要上传聊天正文、原始 JSON、截图或导出文件。

## 28. User Package Instructions

主候选 DMG：

`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/Chat History Analysis Prototype.dmg`

SHA-256：

`5e29d2c3d14e5453f93e36c3b2dcbeb06524244eb9db56603cf06e1be8344512`

使用步骤：

1. 双击或 mount DMG。
2. 将 `Chat History Analysis.app` copy/open 到本地 Applications-like 目录。
3. 如 macOS 对 ad-hoc prototype 显示 unverified developer/Gatekeeper 提示，按本地 Finder 的 Open/Privacy & Security 流程确认；这不代表 notarization。
4. 打开 app，在 app 内手动 select 文件并按第 27 节执行真实数据验收。该真实数据验收仍由用户手动执行。

没有 Developer ID/notarization 承诺；用户不需要也不应把真实文件交给 Agent。

## 29. Storage / Cleanup Notes

本批没有删除任何文件或目录。

必须保留：

- 当前 successful B5 root：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260817T070634Z`；
- 当前 Standard candidate root：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z`；
- 本批 startup regression evidence：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260821T070254Z/startup-regression`；
- protected historical B5：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/b5-rebuild-4/final-release`；
- protected historical B6：`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/b6-final-acceptance/final-release`。

真实数据验收完成后，`/Users/chestnut/Projects/ChatHisotryAnalysis/build/stage11/macos-arm64/package-20260810T065335Z` 可由用户决定是否成为 cleanup candidate；本批不执行删除。当前 Standard root 内的 selection-smoke-target 也不在 7.3 删除。

## 30. Evidence / Handoff Files

本批实际修改的 handoff/evidence 与 packaging-integrity 文件：

- `docs/BETA_FINAL_ACCEPTANCE.md`：更新为 V3 7.3 final evidence inventory + user handoff。
- `src-tauri/resources/sidecar-trust-anchor.json`：由锁定 packaging flow 刷新为当前 source revision 的 sidecar trust anchor。

本批只读核对的 evidence/artifact source 包括新 Standard package manifest/root、DMG copied app、`scripts/build_macos_alpha.sh`、`scripts/package_macos_prototype.py`、`scripts/verify_macos_alpha.sh`、最终 executable 与 startup regression logs；没有 stage `.app`、`.dmg`、screenshots、traces 或 build root。

## 31. Validation

本批执行并记录：

- `scripts/build_macos_alpha.sh` → PASS；新 Standard root `package-20260821T070254Z`。
- `scripts/verify_macos_alpha.sh build/stage11/macos-arm64/package-20260821T070254Z/package-manifest.json` → PASS；DMG `hdiutil verify`、mount/copy/unmount、signature and manifest checks passed。
- independent app-tree/executable/DMG hash comparison → PASS。
- copied executable `file`/`lipo` → `Mach-O 64-bit executable arm64` / `arm64`。
- copied app `codesign --verify --deep --strict` → PASS。
- Standard startup regression → PASS：fresh DMG copy, Home window present, normal close exit code `0`, same-cache relaunch exit code `0`, pre-existing cache root `0755 → 0700`, no panic/abort markers。
- `git diff --check` → PASS；

本批没有重跑完整 product suite，也没有修改 OpenSpec；真实数据验收仍是用户手动职责。

## 32. Changed Files

本批精确修改路径：

- `/Users/chestnut/Projects/ChatHisotryAnalysis/docs/BETA_FINAL_ACCEPTANCE.md`
- `/Users/chestnut/Projects/ChatHisotryAnalysis/src-tauri/resources/sidecar-trust-anchor.json`

不得 stage `.app`、`.dmg`、screenshots、traces、build root。

## 33. OpenSpec

- 本批 OpenSpec：unchanged；无需记录 packaging artifact update。
- 7.4：before unchecked → after unchanged unchecked；
- V3 readiness：仍 `V3_READY=false`；真实数据状态仍 `REAL_DATA_USER_ACCEPTANCE_PENDING=true`。

## 34. Commit / Push

本节在验证通过后由 7.3 执行：

- exact staging：只 stage 上述两个路径；
- commit message：`build: regenerate Standard macOS candidate`；
- push target：`origin/feat/implement-local-chat-wordcloud-mvp`；
- commit hash 与 push result 记录在最终 handoff/final report。

## 35. Final Git State

预期并在 commit/push 后复核：

- HEAD：Standard candidate regeneration commit；
- workspace：clean；
- `git rev-list --left-right --count HEAD...@{upstream}`：`0 0`；
- branch：`feat/implement-local-chat-wordcloud-mvp`。

## 36. Next Step

若本报告的 validation、commit、push 和 final Git state 全部 PASS，下一授权步骤是：

**7.4 — RELEASE STOP GATE**
**Model: Sol xHigh**

7.4 未在本批开始。完成 handoff 后停止，等待 7.4 reviewer；真实数据验收仍由用户本人执行。
