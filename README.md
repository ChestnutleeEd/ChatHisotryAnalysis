# ChatHisotryAnalysis

本项目用于开发和验证本地聊天历史分析能力。当前阶段仅建立可复现的合成数据基线，不包含词云应用、前端、后端 API、数据库解密或微信/CipherTalk 连接功能。

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

## 验证

```bash
python3 -m unittest discover -s tests -v
```

## 隐私警告

仓库中没有任何真实聊天记录。`data/mock/` 只允许提交合成 fixture；真实 CipherTalk 或 WeChat 导出必须放在被 Git 忽略的 `data/private/` 或 `data/exports/` 中。请勿提交真实姓名、微信号、手机号、地址、聊天内容或其他个人信息。
