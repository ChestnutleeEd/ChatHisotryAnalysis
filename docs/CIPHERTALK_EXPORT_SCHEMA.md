# CipherTalk detailed-json 结构说明

本文档记录本项目合成测试数据采用的 CipherTalk `detailed-json` 基线。它是根据当前已知结构整理的开发约定，不代表 CipherTalk 的稳定公开接口。

## 顶层结构

导出文件是一个 UTF-8 JSON 对象，包含三个顶层字段：

- `exportInfo`：导出版本、确定性的导出时间、生成器名称和格式。
- `session`：会话参与者、平台、起止时间和消息总数。
- `messages`：按 `createTime` 升序排列的消息对象数组。

`exportInfo.version` 当前为 `0.0.2`，`generator` 为 `CipherTalk`，`format` 为 `detailed-json`。合成数据的 `exportedAt` 固定为请求年份最后一秒的 Unix 秒级时间戳（UTC+8），不会随生成时间变化。

私聊会话的 `session` 包含：

| 字段 | 含义 |
| --- | --- |
| `wxid`、`nickname`、`remark`、`displayName` | 会话联系人标识和显示名称 |
| `type`、`platform`、`isGroup` | 会话类型、平台和群聊标记 |
| `ownerId` | 导出者的合成账号标识 |
| `firstTimestamp`、`lastTimestamp` | 第一条和最后一条消息的 Unix 秒级时间戳 |
| `messageCount` | `messages` 数组中的实际消息数 |

## 消息字段

每条消息的主要字段如下：

| 字段 | 含义 |
| --- | --- |
| `localId` | 从 1 开始的顺序整数 |
| `platformMessageId` | 文件内唯一、可复现的合成消息标识 |
| `createTime` | Unix 秒级时间戳 |
| `formattedTime` | UTC+8 的 `YYYY-MM-DD HH:MM:SS` |
| `type` | 中文消息类型名称 |
| `localType` | WeChat 本地消息类型代码 |
| `chatLabType` | 当前分析层使用的映射代码 |
| `content` | 可读内容、占位文本、空字符串或 `null` |
| `rawContent` | 原始结构的合成表示 |
| `isSend` | 导出者发送为 `1`，联系人发送为 `0` |
| `senderUsername` | 两个合成账号之一 |
| `senderDisplayName` | 合成显示名称 |
| `source` | 当前固定为空字符串 |

## 常见类型映射

| `localType` | `chatLabType` | 中文类型 |
| ---: | ---: | --- |
| 1 | 0 | 文本消息 |
| 3 | 1 | 图片消息 |
| 34 | 2 | 语音消息 |
| 43 | 3 | 视频消息 |
| 47 | 5 | 动画表情 |
| 49 | 4 | 链接、文件或引用消息 |
| 50 | 6 | 系统或通话消息 |

当前合成基线用 `localType=50` 表示系统或通话类记录；真实导出中也可能出现 `10000` 或其他代码。

## 可选字段

- `replyToMessageId`：仅部分 `localType=49` 引用消息具有，且必须指向文件中更早的有效 `platformMessageId`。
- `senderAvatar`：真实导出中可能出现；当前合成数据未生成。
- `chatRecords`：合并聊天记录可能使用；当前合成数据未生成。

## 隐私边界

`data/mock/` 只能存放虚构、可公开提交的合成测试数据。本项目不包含真实聊天记录、真实微信号、手机号、地址或其他个人信息。

真实 CipherTalk 或 WeChat 导出只能保存在被 Git 忽略的 `data/private/` 或 `data/exports/`，不得复制到 `data/mock/`，也不得提交到版本库。

## 待真实样本验证的假设

取得经授权并完成脱敏的真实 CipherTalk 导出后，需要重新核对：

- `exportedAt`、`createTime` 的时区和秒/毫秒精度；
- `localId` 与 `platformMessageId` 的真实类型和稳定性；
- `chatLabType` 的完整映射，尤其是 `localType=49`、`50` 和 `10000`；
- 图片、语音、视频、表情、文件和引用消息的真实 `rawContent` 结构；
- 空内容、撤回消息、通话消息和异常记录的表示；
- `senderAvatar`、`chatRecords` 及其他可选字段的出现条件；
- 群聊与私聊在 `session` 和发送者字段上的差异。
