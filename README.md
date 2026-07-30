# ChatHisotryAnalysis

本项目用于开发和验证本地聊天历史分析能力。当前阶段包含可复现的合成数据基线、本地 Python 预处理器的可信启动边界，以及只使用合成探针的本地前端基础设施；尚不包含原始消息预处理、真实聊天导入、完整词云业务应用、后端 API、数据库解密或微信/CipherTalk 连接功能。

## 当前阶段：合成数据基线

`scripts/generate_mock_chat.py` 使用 Python 标准库生成接近 CipherTalk `detailed-json` 结构的虚构私聊记录。相同的参数会得到内容和顺序完全一致的 JSON，包括确定性的 `exportedAt`。

生成默认的 2025 年、5000 条消息测试数据：

```bash
python3 scripts/generate_mock_chat.py \
  --output data/mock/ciphertalk_detailed_chat_2025.json \
  --count 5000 \
  --year 2025 \
  --seed 20250729
```

命令行参数：

- `--output`：输出 JSON 路径。
- `--count`：消息总数，必须至少为 1。
- `--year`：完整覆盖的日历年份。
- `--seed`：确定性随机种子。

默认 fixture 位于 `data/mock/ciphertalk_detailed_chat_2025.json`。格式约定参见 [CipherTalk detailed-json 结构说明](docs/CIPHERTALK_EXPORT_SCHEMA.md)。

## Python 预处理器启动检查

当前唯一支持的预处理运行时是 macOS arm64 上的 CPython 3.12.x。完整安装必须在仓库外的干净构建目录中完成，并遵循以下边界：

- 用 `requirements-build.lock` 中唯一权威的 `--hash` 值锁定 `pip` 和 `setuptools`；
- 用 `requirements-preprocessor.lock` 下载唯一批准的 `ijson` 轮子；
- 通过 `scripts/bootstrap_preprocessor.py` 在安装前验证并保留轮子，以隔离且净化环境的 pip 子进程安装，并在成功前核对全部安装字节、原生后端和解析器探针；
- 使用 `--no-build-isolation` 从锁定的构建边界生成项目 wheel；
- 使用 `--no-deps --no-index` 安装项目 wheel；
- 直接运行已安装的 `chat-history-analysis` 命令，不依赖 `PYTHONPATH` 或 editable install。

完整命令和信任模型见 [Python preprocessor runtime boundary](docs/PREPROCESSOR_RUNTIME.md)。安装后的只读检查命令是：

```bash
<external-venv>/bin/chat-history-analysis startup-check
```

该命令只验证运行时、保留的官方 `ijson` 制品、已安装包字节、原生 `yajl2_c` 后端和内存解析器自检；它不接受、打开或处理 CipherTalk 文件。项目元数据允许 Python 3.9+ 安装，仅用于让已安装的兼容入口在不支持的解释器上输出稳定拒绝；应用运行时仍严格限定为 CPython 3.12.x/macOS/arm64。

## Stage 1B 前端基础设施

`frontend/` 目前只验证 React/TypeScript/Vite、Worker 内
`jieba-wasm@2.4.0` 合成分词、ECharts 词云扩展和本地 PNG 导出。在 Finder
双击仓库根目录的 `Start Chat Analysis.command` 即可启动；如果
`frontend/node_modules` 缺失或关键直接依赖不完整，脚本会自动根据权威
`package-lock.json` 运行项目本地 `npm ci`，成功后继续 build、启动并打开
浏览器，不需要用户先输入终端命令。依赖首次安装可以访问 npm registry；
应用 build 完成后的本地运行仍不产生外部请求。用 `Stop Chat
Analysis.command` 可安全停止该项目实例。
运行时边界、命令和安全模型见
[Frontend runtime boundary](docs/FRONTEND_RUNTIME.md)，依赖证据见
[Stage 1B dependency evidence](docs/STAGE_1B_DEPENDENCY_EVIDENCE.md)。
生产构建随附的完整第三方文本来自
`frontend/public/THIRD_PARTY_NOTICES.txt`。

## 验证

快速单元测试：

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src \
  python3.12 -m unittest discover -s tests -v
```

真实可信安装测试会在仓库外的临时 APFS 磁盘映像中创建 CPython 3.12、Apple Python 3.9 和 CPython 3.13 环境，完成后卸载映像并删除单个映像文件：

```bash
scripts/run_trusted_integration.sh
```

## 隐私警告

仓库中没有任何真实聊天记录。`data/mock/` 只允许提交合成 fixture；真实 CipherTalk 或 WeChat 导出必须放在被 Git 忽略的 `data/private/` 或 `data/exports/` 中。请勿提交真实姓名、微信号、手机号、地址、聊天内容或其他个人信息。
