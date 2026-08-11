# macOS Alpha 构建与验收

本入口生成本地 macOS arm64 `.app` 和 prototype `.dmg`。构建只使用仓库锁定的
frontend/Cargo/Python 依赖，不读取真实聊天数据，也不提交二进制 artifact。

## 前置条件

- macOS arm64；
- CPython 3.12，默认路径为 `/opt/anaconda3/bin/python3.12`，也可通过
  `CHAT_HISTORY_ANALYSIS_PYTHON312` 指定一个明确的 CPython 3.12 路径；
- 已安装并锁定的 `frontend/node_modules`、npm、Cargo 和 Tauri CLI；
- `hdiutil`、`codesign`、`file`、`lipo` 和 `sandbox-exec`。

构建脚本不会静默切换到系统 Python、Conda 中其他版本或开发服务器。若需要首次
准备 sidecar build wheel，`requirements-sidecar-build.lock` 已指定 hash-locked
清华 PyPI 镜像；npm 依赖应按现有 `package-lock.json` 和项目镜像策略准备。

## 构建

从仓库根目录执行：

```bash
scripts/build_macos_alpha.sh
```

脚本会依次检查 arm64、锁定依赖和 frontend，运行 Python sidecar onedir 构建，构建
frontend/Tauri `.app`，执行 nested-first ad-hoc signing，生成并验证 DMG，运行隔离
HOME/TMPDIR、无网络的合成 sidecar smoke，并调用验收脚本。末尾输出本次 `.app`、`.dmg`
的绝对路径和 SHA-256。构建目录位于被 Git 忽略的 `build/stage11/macos-arm64/`。

## B6 合成 Beta 包验收

B6 使用固定边界目录，仅保留一个正式发布目录，不读取真实聊天数据：

```text
build/stage11/macos-arm64/b6-final-acceptance/final-release/
├── Chat History Analysis.app
├── Chat History Analysis Prototype.dmg
└── package-manifest.json
```

当前正式 artifact 可直接从该目录验收。manifest 记录 arm64、nested-first ad-hoc
签名、DMG 校验与挂载、隔离 clean-install、合成离线 smoke、负向篡改/架构检查和
临时输出清理结果。B6 的 fixture 清单位于 `contracts/b6-fixtures/`；fixture 只用于
覆盖多年度、稀疏/不可用和 malformed 输入，不是生产数据替代品。

```bash
scripts/verify_macos_alpha.sh \
  build/stage11/macos-arm64/b6-final-acceptance/final-release/package-manifest.json
```

手动验收时，从 DMG 将 `.app` 复制到 Applications-like 目录后启动，使用自己的
数据完成 Annual scope、Vocabulary/Clean Mode、Share Preview/native PNG、Detailed
Apply、aggregate export 和重启检查。完整的 10–20 分钟 checklist 与限制见
[`docs/BETA_FINAL_ACCEPTANCE.md`](BETA_FINAL_ACCEPTANCE.md)。完成用户验收前，状态仍为
`PASS WITH USER ACCEPTANCE PENDING`，不代表 Release ready。

## 单独验收已有 artifact

```bash
scripts/verify_macos_alpha.sh <path-to-package-manifest.json>
```

不传参数时使用最新的本地 package manifest。验收包括 manifest 状态、bundle-relative
resource、arm64 Mach-O、ad-hoc nested signature、DMG `hdiutil verify`、挂载/复制/卸载、
隔离合成 smoke 结果和 Git artifact 排除检查。`spctl` 只用于信息参考；未 notarized
的 Alpha 不因 `spctl` 结果自动失败。

## 源码验证

```bash
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --tests
PYTHONPATH=src /opt/anaconda3/bin/python3.12 -m unittest discover -s tests -v
openspec validate productize-local-chat-analysis-desktop --strict
```

浏览器 v1、desktop opaque transport、导出、生命周期、privacy 和错误恢复均使用公开
或合成 fixture。Stage 13.10、Stage 15.10、D.1–D.10 不在这个入口中执行。

## Future Windows boundary

本批不生成 Windows artifact，也不作 Windows 支持声明。未来 target-built sidecar
必须绑定 Windows 目标运行时和固定依赖证据；文件选择与缓存必须覆盖 Unicode path、
owner-only cache containment 和路径分隔符；进程监督需要 Job Object、等价的取消/父进程
丢失处理；发布前还需要 Windows signing、installer、clean-machine 和 offline 验证。
共享的 protocol/schema、opaque dataset contract、分析 DTO 和 UI 状态不应因此重新设计。

## 构建身份

当前身份由 source/config 中的版本常量共同约束：产品 `0.1.0`、bundle build `1`、
canonical v2、analytics result v3、sidecar `0.1.0`、aggregate export v2。构建 manifest
只记录相对 artifact 名称；最终交付时由本地终端报告实际 artifact 路径和 hash。
