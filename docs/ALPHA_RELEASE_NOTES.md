# macOS Alpha Release Notes

## 版本与边界

- 产品版本：`0.1.0`
- macOS bundle build version：`1`
- Bundle ID：`com.chathistoryanalysis.desktop`
- 目标：macOS arm64，最低 macOS 11.0
- canonical event/manifest：v2
- preprocessor/sidecar contract：`0.1.0` / `chat-history-analysis.sidecar.v1`
- analytics result：`chat-history-analysis.analytics-result.v3`
- aggregate export：`chat-analysis-export.v2`

这是可供本地手动测试的 Alpha 原型，不是正式公开发布。

## 当前支持

- macOS arm64 本地应用和 prototype DMG；
- CipherTalk `detailed-json` 原始导出；
- 一个或多个年度源，以及单独标记的可选 overlap verification 源；
- 本地 validation、merge、canonical sort、deterministic dedupe 和 v2 dataset；
- packaged PyInstaller `onedir` sidecar，不依赖用户安装 Python、Conda 或 Node；
- 本地 analytics Worker、UTC+08:00 筛选和固定阈值会话统计；
- Overview、Trends、Comparison、Activity、Words & Years、Message Types、
  Replies & Sessions、Export 八个页面；
- 当前筛选图表 PNG、aggregate CSV 和 aggregate JSON；
- 取消、重试、替换、关闭清理和启动恢复；
- 离线运行、无账号、无上传、无遥测、无云端分析。

产品文档固定说明：所有日/月/年和活动日期使用 UTC+08:00，日期范围首尾 inclusive；
sender、date、year 和 1/3/6/12/24 小时 session threshold 是确定性筛选项；关键词、
长度、回复和会话算法只返回 versioned aggregate DTO，不作关系、情绪或心理推断。界面
保留键盘顺序、焦点、status/alert、可访问表格、图表替代文本、最小窗口和 reduced-motion
边界；Export 页的 JSON/CSV/PNG 仅输出已提交的 aggregate 结果。

## 当前不支持或不承诺

- Windows；Intel macOS，除非另行提供目标构建；
- Developer ID 签名、notarization、stapling 或正式 Gatekeeper 认证；
- 自动更新、云同步、账号、远程 API 或外部模型；
- 其他微信/聊天平台导出格式；
- 损坏到无法解析的 JSON；
- 超出已声明事件、数据集或 chunk 限制的数据；
- 正式发布级 supply-chain、安全、最大容量或 p95 性能认证；
- 正式公开分发或安装器承诺。

## Alpha 已接受的 residual risks

Alpha 使用固定 host-compiled sidecar evidence anchor 和 ad-hoc signing，不能替代
Release trust root。renderer 与 Worker 视为同一个不可信前端域，host 不声称能够
证明二者的调用者身份。macOS process identity 在 PID/PGID 复用窗口中仍有理论竞态，
同 UID 的完全恶意进程也不属于 Alpha 可消除的形式化范围。完整的 tamper、crash、
disconnect、IPC race、clean-machine Release 和容量证据继续保留在 D.1–D.10。

这些限制不改变当前的本地隐私边界：没有网络上传、没有自动历史保留，输入文件只读，
默认会话在替换或退出时清理；导出仍属于可能敏感的本地聚合数据。

## 用户交付

构建和验收入口见 [macOS Alpha build](MACOS_ALPHA_BUILD.md)，用户手动测试见
[macOS Alpha user test guide](MACOS_ALPHA_USER_TEST_GUIDE_ZH.md)。
