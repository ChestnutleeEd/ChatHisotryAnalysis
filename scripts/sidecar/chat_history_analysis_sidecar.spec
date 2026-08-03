# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.building.build_main import Analysis, PYZ, EXE, COLLECT
from PyInstaller.utils.hooks import collect_dynamic_libs


ROOT = Path(SPECPATH).resolve().parent.parent
ENTRYPOINT = ROOT / "scripts" / "sidecar" / "sidecar_entry.py"
FIXTURE = ROOT / "contracts" / "sidecar-synthetic-fixture.json"
TRUST_ANCHOR = ROOT / "src-tauri" / "resources" / "sidecar-trust-anchor.json"

PRODUCTION_HIDDEN_IMPORTS = [
    "chat_history_analysis.application",
    "chat_history_analysis.backend",
    "chat_history_analysis.dataset_persistence",
    "chat_history_analysis.distribution",
    "chat_history_analysis.errors",
    "chat_history_analysis.frozen_runtime",
    "chat_history_analysis.input_preflight",
    "chat_history_analysis.message_capacity",
    "chat_history_analysis.message_normalization",
    "chat_history_analysis.operation_control",
    "chat_history_analysis.preprocessing_validation",
    "chat_history_analysis.runtime",
    "chat_history_analysis.source_validation",
    "chat_history_analysis.startup",
    "chat_history_analysis.cli",
    "chat_history_analysis.sidecar_protocol",
    "frozen_probe",
    "ijson.backends.yajl2_c",
    "ijson.backends._yajl2",
    "ijson.common",
]

a = Analysis(
    [str(ENTRYPOINT)],
    pathex=[str(ROOT / "src")],
    binaries=collect_dynamic_libs("ijson"),
    datas=[(str(FIXTURE), "."), (str(TRUST_ANCHOR), ".")],
    hiddenimports=PRODUCTION_HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tests",
        "data",
        "frontend",
        "src_tauri",
        "build",
        "dist",
        ".codex",
        "pytest",
        "vitest",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    exclude_binaries=True,
    name="chat-history-analysis-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="chat-history-analysis-sidecar",
)
