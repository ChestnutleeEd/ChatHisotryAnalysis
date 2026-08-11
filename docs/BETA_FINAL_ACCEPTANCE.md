# B6 Final Synthetic Packaged Beta Acceptance

本报告记录 B6 的合成验收边界。它证明当前 macOS arm64 本地原型适合进入用户的真实数据手动验收，不代表 Release、Production、Developer ID、notarization 或公发布就绪。

验收时间：2026-08-12
分支：`feat/implement-local-chat-wordcloud-mvp`
基线：`eb0bd993702d804e6b69aade7fdbd451d9b2ee4d`
B6 work root：`build/stage11/macos-arm64/b6-final-acceptance`
当前包目录：`build/stage11/macos-arm64/b6-final-acceptance/final-release`

## Status

```text
PASS WITH USER ACCEPTANCE PENDING
BETA_PACKAGE_READY_FOR_USER_TEST=true
RELEASE_READY=false
```

## Automated Source Gates

- Python：`PYTHONPATH=src /opt/anaconda3/bin/python3.12 -m unittest discover -s tests -v` — 229 passed, 22 intentionally skipped。
- Frontend：type-check、lint、Vitest — 37 files，262 passed，1 skipped。
- Browser preview：`npm --prefix frontend run test:browser:preview` — 22 passed；Word Cloud long-task count 0；main-thread layout calls 0。
- Rust/Tauri：fmt、check、lib/tests — 73 library tests passed、3 packaged-runtime tests skipped、21 integration tests passed；保留既有 `parse_stdout` dead-code warning。
- ACL/platform：Tauri ACL digest replay 与 platform-neutrality audit passed。
- OpenSpec 与 `git diff --check` 在最终提交前复核。

## Packaged Synthetic Gates

正式 artifact：

- `.app`：`build/stage11/macos-arm64/b6-final-acceptance/final-release/Chat History Analysis.app`
- `.dmg`：`build/stage11/macos-arm64/b6-final-acceptance/final-release/Chat History Analysis Prototype.dmg`
- manifest：`build/stage11/macos-arm64/b6-final-acceptance/final-release/package-manifest.json`
- DMG SHA-256：`ba63855d679fd828d13fae6770817cd4fe094f50d61fafab02c927f70637353f`

manifest 与 clean-install vertical 已验证：arm64 Mach-O、nested-first ad-hoc signature、tamper/错误架构拒绝、bundle-relative sidecar/art/font、`hdiutil verify`、mount/copy/unmount、仓库外隔离 HOME/TMPDIR、网络沙箱下 0 次网络尝试、Finder-equivalent launch、sidecar shutdown/restart，以及临时输出清理。

Fixture A 使用三个嵌入式多文件年度源，覆盖 overlap/dedup、Owner/Other、文本/图片/语音/system、活动/会话/回复、词汇和部分范围；Fixture B/C 的 sparse/malformed 约束与公开 fixture 清单保留在 `contracts/b6-fixtures/`，不读取真实聊天数据。

packaged vertical 已完成：

- all-years → Year A → Year B → all-years scope correlation；
- 七个 Annual scenes；raw/per-10k、Owner/Other/Both、Clean Mode、custom hidden word 和 accessible Word Cloud list；
- Share Preview vocabulary off/on、真实 AppKit PNG Save/cancel/retry/readback；PNG 为 1200×1500、opaque、无禁用 metadata；
- Detailed draft 保留到一次 Apply，八条 route 均可达；aggregate JSON 导出读回通过且不泄露 fixture/source path；
- cancel/retry/reselect、无 stale hidden word/DTO、quit/no orphan、restart/clean state。

## Evidence Reused

Alpha/B1–B5 已接受的 canonical event、opaque transport、host lease、PNG chunk/RGBA、word-cloud geometry、privacy、browser-v1 和 B5 native-save/readback 矩阵继续作为受保护基线；B5 rollback 保留在：

`build/stage11/macos-arm64/b5-rebuild-4/final-release`

B6 没有重复完整的旧矩阵，也没有修改 Dashboard、word-cloud geometry 或 export authority。B6 仅新增 final packaged integration seams 与导出完成后的状态回读补偿路径，避免 native save 返回后 renderer 恰好错过 `exported` event 时错误显示“已取消”。

## User Manual Gate — 10–20 minutes

此部分必须由用户使用自己的数据完成；Agent 不选择、打开、解析、截图或判断真实聊天内容。

1. 从 DMG 复制并启动 `.app`，选择一个年度 JSON；如需 overlap/verification，再选择一份可验证源。
2. 完成分析后检查 Home → Annual → Detailed；确认日期范围、Owner/Other、空状态和错误提示符合预期。
3. 在 Annual 中切换 all-years、两个代表年份并恢复 all-years；切换 raw/per-10k、Owner/Other/Both、Clean Mode 和自定义隐藏词，确认显示内容与标签一致。
4. 打开 Share Preview，分别保持词汇关闭/打开，实际保存一次 PNG，再各测试一次取消和重试；检查 PNG 只包含你选择的摘要内容。
5. 在 Detailed 编辑日期但先不 Apply，再 Apply；浏览八个 route，并测试一次 aggregate JSON/CSV 导出。
6. 在分析或导出附近退出并重新启动，确认应用能正常恢复，之后删除你自行生成的测试导出文件。

真实数据若出现问题，请记录复现步骤、界面状态和脱敏后的错误码；不要上传聊天正文、原始 JSON、截图或导出文件。完成这份 checklist 后，B6 才可由用户确认进入真实 Beta 使用；在此之前不得将它标记为 Release。

## Storage and limitations

旧的 `package-20260810T065335Z` 仍按约定保留，需由用户手动删除；Agent 不执行递归或批量删除。完成删除后再由 Agent 做只读 artifact audit。构建缓存和 `target` 不清理。

本包是 ad-hoc prototype，未做 Developer ID、notarization、stapling、Gatekeeper/public distribution 或 Release hardening。productization 12.7/12.8、legacy 13.10/15.10 和 Release 8.5/D.1–D.10 均未被本报告标记完成。
