# CipherTalk detailed-json 结构说明

本文档记录项目对 CipherTalk `detailed-json` 的公开、安全基线。结论来自合成夹具和一次经授权、只输出聚合结果的真实导出审计。本文不会记录真实参与者、消息、标识符、文件哈希、精确私人年度统计或可识别的日期范围。

文中使用三种证据级别：

- **已确认观察**：在所审计的多个真实年度私聊导出中一致观察到的聚合结构。
- **实现策略**：本项目为安全、确定性分析选定的规范，不代表 CipherTalk 自身保证。
- **仍待验证**：未被现有聚合审计覆盖，或未来 CipherTalk 版本可能改变的行为。

## 数据规模与处理边界

**已确认观察**

- 同一私聊会话可由多个年度 `detailed-json` 文件组成。
- 完整数据集可能超过旧版单文件浏览器导入边界，因此不能据此假定原始导出适合直接进入浏览器内存。
- 一个近期验证导出可与年度来源完全重叠，因此不能作为额外分析时期计数。
- 原始文件名不能作为权威日期范围或排序依据。

**实现策略**

- 原始 CipherTalk 导出只由本地 macOS Python CLI 顺序流式读取。
- CLI 使用 bounded digest/UTF-8、validation/range 和 final-ranked staging passes；每个后续 pass 都复核 source hash，且 final `fileRank` 已确定后才插入 SQLite。
- 浏览器不接受原始 CipherTalk JSON，只接受预处理产生的 normalized manifest 和 bounded NDJSON chunks。
- 输入角色必须显式标记为 `annual source` 或 `overlap verification`，不得从文件名或目录名推断。
- `annual source` 参与完整历史合并；`overlap verification` 仅验证重复导出一致性，永不贡献总数或时间段。

## Preprocessor startup gate

**实现策略**

任何 raw source 被打开前，CLI 必须验证：

- runtime 是 macOS arm64 上的 CPython `>=3.12.0,<3.13.0`；
- installed `ijson` version exactly `3.5.1`；
- installed distribution SHA-256 属于该 exact runtime/platform 的 approved list；
- backend exactly `ijson.backends.yajl2_c`，无 automatic/Python fallback；
- minimal in-memory parser initialization self-check 成功。

失败类别固定为：

- `UNSUPPORTED_PYTHON_RUNTIME`
- `IJSON_DISTRIBUTION_UNVERIFIED`
- `IJSON_BACKEND_UNAVAILABLE`
- `IJSON_BACKEND_MISMATCH`
- `IJSON_PARSER_INITIALIZATION_FAILED`

Startup gate 失败时不得打开 raw source，底层 exception message 不得直接呈现。

## 顶层结构

**已确认观察**

导出根值是 UTF-8 JSON object，主要包含：

| 字段 | 观察到的类型 | 说明 |
| --- | --- | --- |
| `exportInfo` | object | 导出版本、时间、生成器和格式元数据 |
| `session` | object | 私聊会话元数据 |
| `messages` | array | 消息记录 |

`exportInfo.format` 为 `detailed-json`。`exportInfo.version` 为 string，`exportedAt` 为 Unix 秒级 integer，`generator` 存在。

**实现策略**

- 严格 UTF-8；不得用替换字符修复无效字节。
- 只接受一个顶层 JSON 值，不接受注释或尾随值。
- 根、`exportInfo`、`session` 和 `messages` 类型不符属于 fatal dataset error。
- 未知非判别字段可被忽略，但不得因此进入 normalized allow-list。

## 私聊会话结构

**已确认观察**

| 字段 | 观察 | 隐私说明 |
| --- | --- | --- |
| `type` | string，表示私聊 | 可用于会话类型判别 |
| `platform` | string | 可用于同会话一致性 |
| `isGroup` | boolean，私聊为 `false` | 群聊不在本 MVP 范围 |
| `ownerId` | string | 敏感标识，仅瞬时比较 |
| `wxid` | string | 敏感标识，仅瞬时比较 |
| `nickname`、`remark`、`displayName` | string | 敏感显示信息，不得规范化输出 |
| `firstTimestamp`、`lastTimestamp` | integer | 会话声明范围 |
| `messageCount` | integer | 会话声明消息数 |

多个年度来源的会话元数据和双参与者集合可用于确认它们属于同一私聊。

**实现策略**

- 合并前瞬时比较 format、platform、private/group 状态、owner identity、peer identity 和 participant set。
- 对版本化、长度前缀的 canonical private-session identity 计算 SHA-256 conversation fingerprint。
- fingerprint 是 **pseudonymous（假名化）**，不是 anonymous（匿名）；持有候选标识的人可能重新计算它。
- 本地 manifest 可保存 fingerprint，但不得同时保存任何原始名称或标识符。
- 不同会话的 annual source 是 fatal dataset error。

## 消息字段

**已确认观察**

| 字段 | 观察到的类型或行为 |
| --- | --- |
| `localId` | integer；可能在单个导出和不同导出之间重复 |
| `platformMessageId` | string；不得转换为 JavaScript number |
| `createTime` | Unix 秒级 integer |
| `formattedTime` | strict `YYYY-MM-DD HH:mm:ss`，与 UTC+08:00 一致 |
| `type` | 中文消息类型 string |
| `localType` | integer；结构化消息可能远超 signed 32-bit |
| `chatLabType` | integer；当前最稳定的 primary classifier |
| `content` | string 或 `null` |
| `rawContent` | string；可能包含 XML、URL 和嵌入式敏感元数据 |
| `isSend` | numeric integer `0` 或 `1` |
| `senderUsername` | string，敏感标识 |
| `senderDisplayName` | string，敏感显示信息 |
| `source` | string；真实导出中并非固定空值，结构可变 |
| `chatRecords` | optional array |
| `senderAvatar` | optional string；不同导出模式可能出现或省略 |
| `replyToMessageId` | 在已审计导出中未观察到 |
| `groupNickname` | 私聊审计中未观察到 |

`platformMessageId` 即使外观为十进制数字也必须保留为 string。将它转换成 JavaScript number 会产生不安全的十进制 ID 处理风险。

`localId` 不能作为 primary identity。`timestamp` 和 source-array index 也不能单独作为去重键。

## 消息分类

### `chatLabType` primary mapping

**已确认观察**

| `chatLabType` | Normalized category |
| ---: | --- |
| 0 | text |
| 1 | image |
| 2 | voice |
| 3 | video |
| 4 | file |
| 5 | animated emoji |
| 7 | structured/link/other application content |
| 8 | location |
| 23 | call |
| 24 | mini-program/share |
| 25 | reply |
| 27 | contact card |
| 80 | system |
| 99 | other/special transaction content |

### `type` consistency signal

**实现策略**

`type` 用于：

- 验证 `chatLabType` 的预期分类；
- 发现分类冲突；
- 在不确定时保守排除非文本记录；
- 防止 `chatLabType` 异常时把图片、媒体或结构化记录当作文本。

未知 `chatLabType` 默认是 non-text，而不是猜测为文本。

### `localType` raw metadata

**已确认观察**

| Category | Stable simple example |
| --- | ---: |
| text | 1 |
| image | 3 |
| voice | 34 |
| video | 43 |
| animated emoji | 47 |
| call | 50 |
| system | 10000 |

结构化消息还可使用更大的代码。例如，在聚合审计中，link、file、reply 类分别观察到 `21474836529`、`25769803825`、`244813135921` 一类的大整数。`localType=49` 未被确认是 canonical structured-message mapping。

**实现策略**

- Python 侧只接受非 boolean integer。
- TypeScript 侧必须通过 `Number.isSafeInteger`。
- 禁止 bitwise operator、signed 32-bit cast、`Int32Array` 和 32-bit 数据库列。
- 不拒绝未知但安全的 integer。
- `localType` 不得作为 sole classifier 或 primary identity。

**仍待验证**

- 未来 CipherTalk 版本可能引入新的 `chatLabType` 或超出当前安全整数观察范围的 `localType`。

## Eligible text rule

**实现策略**

只有同时满足以下条件的记录才可进入 data-minimized local analysis dataset：

```text
chatLabType === 0
type === "文本消息"
localType === 1
content is a non-empty string
```

三个分类信号冲突时：

- 排除该记录；
- 只增加 aggregate warning counter；
- warning 不包含 content 或 identifier。

随后依次排除：

- bracketed media/system placeholder；
- XML-like content；
- URL-only content；
- 移除 URL 后为空的内容；
- malformed value。

混合文本中的 URL span 被移除，剩余 human-readable text 保留。

## 时间与发送者语义

**已确认观察**

- `createTime` 是 Unix seconds。
- `formattedTime` 严格匹配 `YYYY-MM-DD HH:mm:ss`，并与 UTC+08:00 对应。
- `isSend` 为 numeric integer `0` 或 `1`。
- 相同 timestamp 可以对应多条不同消息。
- owner/sender metadata 偶尔可能与有效 `isSend` 冲突。

**实现策略**

- 使用显式 UTC arithmetic 和固定 UTC+08:00，不使用 host timezone 或 locale。
- `isSend=1` 规范化为 `senderScope: "owner"`；`isSend=0` 为 `"other"`。
- 有效 `isSend` 始终权威；身份元数据冲突只产生 aggregate warning。
- 文件实际范围由消息时间推导，排序依次使用 minimum `createTime`、maximum `createTime`、用户提供顺序。
- 相同时间的不同消息依次按 deterministic file rank 和 original source-array index 排序。
- 去重后分配 monotonically increasing canonical source index。
- 年度 gap 允许；年度 overlap 需要去重并产生 aggregate validation information。

## Deduplication policy

**实现策略**

所有 variable-length byte field 都使用 unsigned 64-bit big-endian 长度前缀，fixed-width integer 使用 signed 64-bit big-endian。Conversation fingerprint bytes 是从 validated 64-character lowercase hexadecimal fingerprint 解码得到的 exact 32 bytes。Primary identity 的 canonical input 为：

```text
domain: ChatHistoryAnalysis/dedup/platform-id/v1
conversation fingerprint bytes
UTF-8 platformMessageId bytes
```

Primary key 是该编码的 SHA-256。独立 verifier 使用同一字段和不同 domain：

```text
ChatHistoryAnalysis/dedup/platform-id-verifier/v1
```

并计算 16-byte BLAKE2b digest。`platformMessageId` 只在流式解析时保持 string，摘要计算后立即丢弃；它不被转为 number、记录到日志、存入 SQLite 或写入 normalized output。

当 `platformMessageId` 缺失、为空或不是 string 时，fallback identity 使用独立 domain：

```text
ChatHistoryAnalysis/dedup/fallback/v1
```

对以下 canonical values 计算 SHA-256：

- conversation fingerprint；
- `createTime`；
- `formattedTime`；
- authoritative sender scope；
- normalized message type；
- cleaned content 的 cryptographic hash。

Fallback verifier 使用相同字段和 `ChatHistoryAnalysis/dedup/fallback-verifier/v1`，计算独立 16-byte BLAKE2b digest。原始 cleaned content 不直接进入 identity encoding。

相同 identity kind、SHA-256 和 verifier 表示 duplicate。相同 kind 与 SHA-256 但 verifier 不同表示 fatal `CRYPTOGRAPHIC_IDENTITY_COLLISION`；预处理立即停止，不保留两条记录，也不选择 first/last，并且错误不暴露 ID、content、digest 或位置。

## Private SQLite staging

**实现策略**

SQLite 是一次性 staging store，不是应用数据库。它只包含一个 record table 和十列：

- non-null `identity_kind` text：`platform-id-v1` 或 `fallback-v1`
- non-null 32-byte `identity_digest` blob
- non-null 16-byte `identity_verifier` blob
- non-null integer `create_time`
- non-null text `formatted_time`
- non-null text `calendar_date`
- non-null `sender_scope` text：`owner` 或 `other`
- non-null cleaned text `content`
- non-null non-negative integer `file_rank`
- non-null non-negative integer `source_array_index`

唯一约束为 `(identity_kind, identity_digest, identity_verifier)`；collision lookup 使用 `(identity_kind, identity_digest)`；canonical ordering index 使用 `(create_time, file_rank, source_array_index)`。SQLite 不得保存 raw/session/sender 字段、raw message ID、URL、XML、application/media payload、input path 或 basename。

Staging directory 是 requested final directory 的 unique sibling，位于显式选择的 Git-ignored normalized-output parent，因此与 final destination 同一 filesystem。进程使用等价 `0077` umask，directory 等价 `0700`，database/marker/regular files 等价 `0600`。位置永不输出，也不使用 global user database directory 或 generic shared temporary directory。

Private insert 前必须 set 并 read back：

```text
PRAGMA journal_mode=DELETE
PRAGMA temp_store=MEMORY
PRAGMA secure_delete=ON
PRAGMA busy_timeout=0
```

禁止 WAL 与 shared cache。当前 schema 没有 foreign key；未来如引入则必须先验证 `PRAGMA foreign_keys=ON`。`temp_store=MEMORY` 用于避免 sort/index spill 到系统临时目录，必须通过 supported maximum profiling；失败时停止并修订 OpenSpec，不能静默改为 disk spill。禁止 deprecated 或 process-global SQLite temp-directory 配置。`secure_delete=ON` 只能减少普通 deleted-page remnants，不能保证 SSD 上的 forensic 或 cryptographic erasure。

## Data-minimized local analysis dataset

**实现策略**

每条 normalized text record 的 allow-list 仅包括：

- `createTime`
- `formattedTime`
- `calendarDate`
- `senderScope`
- `content`
- `fileRank`
- `sourceIndex`

明确禁止 normalized output、browser state、logs、snapshots 和 errors 包含：

- `rawContent`
- `source`
- `senderUsername`
- `senderDisplayName`
- `senderAvatar`
- session nickname、remark、display name
- `wxid`
- `ownerId`
- `platformMessageId`
- `localId`
- avatar/CDN/media URL
- XML
- mini-program/application payload
- `chatRecords`
- `replyToMessageId`
- `groupNickname`
- media metadata
- non-text message content

保留的聊天文本本身仍可能包含个人信息，因此该输出只能称为 **data-minimized local analysis dataset**，不能称为匿名数据。

## Normalized manifest 与 chunks

**实现策略**

输出位于 Git-ignored 本地目录，例如：

```text
data/exports/normalized/<dataset-name>/
  manifest.json
  chunk-0001.ndjson
  chunk-0002.ndjson
```

Manifest 包含 schema/tool version、pseudonymous conversation fingerprint、UTC+08:00 policy、input roles 和 hashes、ordered chunk metadata 和 hashes、aggregate counts、skip/duplicate/warning counters、data-derived range、sender-scope counts 和 privacy-validation result。它不包含 raw path、raw identity、raw message 或当前 wall-clock generation time。

Chunks 使用 canonical order、compact UTF-8 JSON、固定字段顺序和 LF。Record 与 chunk 边界使用实际 encoded UTF-8 bytes，并包含每条 record 的 trailing LF：

- 单条 record 恰好 33,554,432 bytes：接受；
- 单条 record 33,554,433 bytes：fatal `NORMALIZED_RECORD_TOO_LARGE`，不写 oversized chunk，不 promote；
- chunk 恰好 33,554,432 bytes：接受；
- next record 会超限：关闭当前 non-empty chunk，完整 record 进入 next chunk；
- first eligible record 才创建 first chunk，永不创建 empty chunk；
- zero eligible records：fatal `NO_ELIGIBLE_TEXT_RECORDS`，不创建 normalized dataset，CLI 可重新使用。

相同 inputs、roles、order、versions 和 settings 必须产生 byte-identical manifest 与 chunks；recoverable record skip 不改变 surviving canonical order 的确定性。

## Atomic promotion、cleanup 与 recovery

**实现策略**

Final destination 必须不存在。已存在的 file、directory 或 symbolic link 导致 `OUTPUT_DESTINATION_EXISTS`；MVP 不 overwrite、merge、delete 或 replace。Candidate 只通过一次 same-filesystem atomic directory rename 提升，不使用 copy 或 cross-filesystem fallback。Manifest/chunk hashes 在 rename 前重新验证。

Success、validation/parsing/capacity/output failure、cancellation 和 handled interruption 都必须逐个枚举并清理 main database、`-journal`、`-wal`、`-shm`、statement journal、temporary manifest/chunk、marker 和 staging 中的其他 entry。Rename 前必须确认 database、sidecar、marker 与 non-output artifacts 全部消失，目录只含 validated manifest 和 referenced non-empty chunks。

Disk exhaustion、write/flush failure、hash mismatch、interrupted write、pre-rename cleanup failure 或 promotion failure 都不得留下 apparent valid final dataset。Abrupt termination、OS crash 或 power failure 可能留下 owner-only marked sibling；recovery mode：

- 只扫描用户显式选择的 normalized-output parent；
- 只识别 fixed staging prefix 与 `.chathistoryanalysis-private-stage-v1` marker；
- 只报告 ordinal counts 和 state codes；
- 不输出 path、filename 或 content；
- 拒绝 symbolic link、unexpected ownership/permissions/type 或 parent 外对象；
- explicit confirmation 后每次只逐项删除一个 selected candidate；
- 不宣称 forensic erasure。

Stages 5–6 已覆盖 promotion 前异常/中断的资源关闭与 staging cleanup；Stage 7 的显式 SIGINT flag、安全 checkpoint、独立 cancellation exit status 和 progress presentation 尚未实施。

## Error-output privacy

Errors、warnings、progress、logs、screenshots、stdout/stderr、browser errors、progress events、snapshots、debug logs 和 manifest warnings 只能包含：

- source ordinal
- input role
- processing phase
- field name
- line/record ordinal
- stable reason code
- aggregate count
- percentage
- non-sensitive capacity value

禁止 absolute/relative path、basename、directory/output/SQLite location、user-derived dataset label、participant value、message ID、individual-message hash、content fragment、URL 和 raw parser excerpt。Source 只以 `annual-source #1`、`annual-source #2`、`overlap-verification #1` 一类 fixed role/ordinal label 呈现。Output failure 只呈现 phase 与 reason code。Internal exception 必须先转换为 content-free project category。

## Mandatory Worker-memory gate

浏览器容量实现完成前，必须用纯合成数据在或接近 1,000,000 eligible records、134,217,728 normalized bytes 和 33,554,432 bytes per chunk 三个 maximum boundary 进行 profiling。每次只记录 browser/version、OS、architecture、loaded bytes、record count、可测的 peak Worker memory、main-thread responsiveness、cancellation、cache representation 和 pass/fail。

证据必须选择：shared token table + token-ID arrays、per-record metadata + token-offset arrays、partitioned token caches，或先修订 OpenSpec 后降低 limit。Browser termination、persistent main-thread unresponsiveness、Worker tokenization 不能完成、cache 不能安全保留、cancellation 不可用或超过未合理化的 memory envelope 时，capacity task 保持 incomplete，后续 maximum acceptance 停止，也不能声称当前 limits 受支持。

禁止 complete-dataset main-thread processing、cloud fallback、silent limit reduction、duplicate full-text/tokenized representations 或在 gate 失败时继续。Worker 构造完每个 chunk 的 compact cache 后必须释放该 chunk text 与 buffer。

## 隐私与仓库边界

`data/mock/` 只能包含明确虚构、可公开提交的合成数据。真实 raw CipherTalk exports 和 normalized datasets 只能保存在 Git-ignored 的 `data/private/`、`data/exports/` 或等价本地位置。

不得把真实 content、identifiers、URLs、avatar values、hashes、精确私人统计或可识别日期范围复制到：

- fixtures；
- tests；
- Markdown；
- source code；
- `public/`；
- `dist/`；
- logs；
- snapshots；
- issue/commit/PR text。

预处理和分析不使用远程服务，不上传数据，也不提供 online fallback。

## 仍待验证

- 未来 CipherTalk 版本的新增字段、分类代码和 optional-field 组合。
- `replyToMessageId` 是否会在其他导出模式出现。
- 群聊结构和发送者语义；群聊仍明确不受支持。
- 不同平台或 CipherTalk 版本是否保持相同 UTC+08:00 policy。
- Approved CPython 3.12/macOS arm64 `ijson==3.5.1` distribution hash 与 streaming performance evidence。
- 浏览器 maximum-boundary profiling 将选择哪一种 compact/partitioned token-cache architecture。
