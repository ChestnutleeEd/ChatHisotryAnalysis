# macOS Alpha 用户手动测试指南

这是 Chat History Analysis 的本地 macOS arm64 Alpha 原型测试说明。它使用
ad-hoc 签名，未经过 Developer ID、notarization 或正式 Gatekeeper 发布认证；
测试结果不能代表正式公开版本。

## 安装

1. 找到本地构建输出中的 `Chat History Analysis Prototype.dmg`。
2. 双击挂载 DMG，把 `Chat History Analysis.app` 拖到 Applications 或其他本地目录。
3. 双击启动应用。
4. 如果 macOS 提示开发者无法验证，这是当前 Alpha 的 ad-hoc 原型提示。可以在
   Finder 中对应用右键选择“打开”，确认只针对这一个本地应用；也可以按系统提示
   在“系统设置 → 隐私与安全性”中批准这一次打开。
5. 不要关闭整个 Gatekeeper，不要执行全局安全设置绕过命令。这个原型不是正式签名
   发布版。

## 导入

1. 首次打开先阅读隐私说明并继续。
2. 点击“选择年度源”，选择一个或多个 CipherTalk `detailed-json` 原始导出。
3. 不要选择其他格式，也不要把验证文件当作年度源。
4. 如需检查重叠，可单独使用“选择可选验证源”；验证源只用于校验，不计入统计。
5. 点击“开始分析”，等待验证、预处理、数据交接和本地 analytics Worker 完成。

所有处理都在本机完成，不上传聊天数据。应用不会修改原始 JSON；默认会在替换数据或
退出应用时清理临时分析会话。输入格式错误时，应用只显示稳定错误类别和恢复操作，
不会显示文件名、绝对路径、联系人或聊天正文。

## 查看结果

结果页包含 8 个固定页面：

- **Overview**：消息数、聊天日、最长连续聊天日、发送方比较、回复和会话摘要。
- **Trends**：按日、月、年的 user-message 趋势。
- **Comparison**：owner/other 消息数量、占比和 eligible text 长度。
- **Activity**：小时、星期、聊天日和连续区间。
- **Words & Years**：词汇变化、年度关键词和可追溯的固定摘要。
- **Message Types**：15 个稳定消息类别、eligible-text、unknown 和 system diagnostic。
- **Replies & Sessions**：回复间隔、会话开场次数和 1/3/6/12/24 小时阈值。
- **Export**：当前已提交筛选结果的 JSON、CSV 或当前图表 PNG 导出。

日期筛选是包含首尾日期的 UTC+08:00 日历范围。发送方筛选不改变本身属于比较统计的
sender、reply 和 initiator 面板；页面会明确说明这一点。修改筛选或阈值时，旧结果会
保留并标记为等待更新，完成新的本地计算后才允许导出。

## 导出

JSON、CSV 和 PNG 都是聚合结果，不包含聊天正文，但仍可能暴露敏感的统计模式。保存前
确认当前筛选、时区、指标版本和页面范围；请谨慎分享导出文件。导出使用原生保存面板，
取消保存不会改变当前结果。

## 真实数据测试观察项

请由用户本人观察并记录：

- 文件能否被选中，年度源和验证源计数是否正确；
- 预处理、数据交接和 analytics 进度是否持续更新；
- 是否出现错误码，以及重试、取消、重新选择是否可用；
- 统计结果是否符合直觉，跨年范围是否正常；
- 重复文件或重叠源是否按预期去重；
- 8 个页面是否可操作，筛选和阈值是否正确更新；
- 导出 JSON、CSV、PNG 是否成功；
- 关闭应用后是否完成清理，重新启动后是否仍能正常使用。

## 反馈模板

请只填写不含正文的环境和现象信息：

```text
App version:
macOS version:
Mac model:
Input file count:
Approximate year range:
Approximate total file size:
Step where issue occurred:
Visible error code:
Expected behavior:
Actual behavior:
Screenshot with private information removed:
```

不要发送真实聊天 JSON、包含聊天正文的截图、联系人名称、绝对文件路径或真实导出
内容；不要粘贴真实统计数字、token、文件名或日志。

已知限制见 [Alpha release notes](ALPHA_RELEASE_NOTES.md)。
