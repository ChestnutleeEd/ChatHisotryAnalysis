from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest
import zipfile


APPROVED_FILENAME = "ijson-3.5.1-cp312-cp312-macosx_11_0_arm64.whl"
APPROVED_SHA256 = (
    "b9517efbe6604bce16f3e50d49b0cd1bdc58917f98cf2eab026599c5c0422991"
)
SENSITIVE_VALUE = "/private/example/raw-chat.json?token=secret-message"
LOCK_HASH_PATTERN = re.compile(r"--hash=sha256:[0-9a-f]{64}")


def _integration_enabled() -> bool:
    return os.environ.get("CHA_RUN_TRUSTED_INTEGRATION") == "1"


@unittest.skipUnless(
    _integration_enabled(),
    "trusted clean-environment integration is explicitly enabled",
)
class TrustedCleanInstallationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            cls.repository = Path(__file__).resolve().parents[1]
            cls.external_root = Path(
                os.environ["CHA_TRUSTED_INTEGRATION_ROOT"]
            ).resolve(strict=True)
            cls.source_copy = cls.external_root / "source-copy"
            cls._copy_project_source()
            cls.python312 = cls._find_python("python3.12", (3, 12))
            cls.python313 = cls._find_python("python3", (3, 13))
            cls.python39 = cls._apple_python39()
            cls.venv312 = cls.external_root / "venv312"
            cls._create_venv(cls.python312, cls.venv312)
            cls.venv312_python = cls.venv312 / "bin" / "python"
            cls._install_build_boundary()
            cls.downloads = cls.external_root / "downloads"
            cls.downloads.mkdir()
            cls._download_locked_ijson()
            cls.approved_wheel = cls.downloads / APPROVED_FILENAME
            cls._assert_file_hash(cls.approved_wheel, APPROVED_SHA256)
            cls.hostile_venv = cls.external_root / "hostile-venv"
            cls._create_venv(cls.python312, cls.hostile_venv)
            cls.hostile_venv_python = cls.hostile_venv / "bin" / "python"
            cls._prove_bootstrap_rejects_symlink_input()
            cls._prove_bootstrap_rejects_wrong_filename()
            cls._prove_bootstrap_rejects_wrong_hash()
            cls._bootstrap_approved_ijson()
            cls._prove_retained_evidence_does_not_bypass_bad_input()
            cls.evidence = (
                cls.venv312
                / "share"
                / "chat-history-analysis"
                / APPROVED_FILENAME
            )
            cls.site_packages = cls._site_packages(cls.venv312_python)
            cls.package_root = cls.site_packages / "ijson"
            cls.dist_info = cls.site_packages / "ijson-3.5.1.dist-info"
            cls.project_wheel = cls._build_project_wheel()
            cls._install_project(cls.venv312_python)
            cls.console312 = cls.venv312 / "bin" / "chat-history-analysis"
            cls.venv39 = cls.external_root / "venv39"
            cls.venv313 = cls.external_root / "venv313"
            cls._create_venv(cls.python39, cls.venv39)
            cls._create_venv(cls.python313, cls.venv313)
            cls._install_project(cls.venv39 / "bin" / "python")
            cls._install_project(cls.venv313 / "bin" / "python")
        except Exception:
            raise AssertionError("INTEGRATION_SETUP_FAILED") from None

    @classmethod
    def _copy_project_source(cls) -> None:
        cls.source_copy.mkdir()
        for filename in (
            "README.md",
            "pyproject.toml",
            "requirements-build.lock",
            "requirements-preprocessor.lock",
        ):
            shutil.copy2(cls.repository / filename, cls.source_copy / filename)
        ignored = shutil.ignore_patterns("__pycache__", "*.pyc")
        shutil.copytree(
            cls.repository / "src",
            cls.source_copy / "src",
            ignore=ignored,
        )
        shutil.copytree(
            cls.repository / "scripts",
            cls.source_copy / "scripts",
            ignore=ignored,
        )

    @classmethod
    def _find_python(cls, command: str, version: tuple[int, int]) -> Path:
        executable = shutil.which(command)
        if executable is None:
            raise AssertionError
        result = cls._run(
            [executable, "-c", "import sys; print(*sys.version_info[:2])"],
        )
        if tuple(int(part) for part in result.stdout.split()) != version:
            raise AssertionError
        return Path(executable)

    @classmethod
    def _apple_python39(cls) -> Path:
        executable = Path("/usr/bin/python3")
        result = cls._run(
            [
                str(executable),
                "-c",
                (
                    "import platform,sys;"
                    "print(platform.python_implementation(),"
                    "platform.system(),platform.machine(),"
                    "*sys.version_info[:2])"
                ),
            ],
        )
        if result.stdout.strip() != "CPython Darwin arm64 3 9":
            raise AssertionError
        return executable

    @classmethod
    def _clean_environment(cls) -> dict[str, str]:
        environment = dict(os.environ)
        for name in (
            "PYTHONPATH",
            "PYTHONHOME",
            "IJSON_BACKEND",
            "PIP_REQUIRE_VIRTUALENV",
        ):
            environment.pop(name, None)
        environment["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
        environment["PIP_NO_CACHE_DIR"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        return environment

    @classmethod
    def _run(
        cls,
        command: list[str],
        *,
        cwd: Path | None = None,
        environment: dict[str, str] | None = None,
        expected: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                env=environment or cls._clean_environment(),
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=180,
            )
        except Exception:
            raise AssertionError("INTEGRATION_COMMAND_FAILED") from None
        if result.returncode != expected:
            raise AssertionError("INTEGRATION_COMMAND_FAILED")
        return result

    @classmethod
    def _create_venv(cls, interpreter: Path, destination: Path) -> None:
        cls._run([str(interpreter), "-m", "venv", str(destination)])

    @classmethod
    def _install_build_boundary(cls) -> None:
        cls._run(
            [
                str(cls.venv312_python),
                "-m",
                "pip",
                "install",
                "--require-hashes",
                "--no-deps",
                "-r",
                str(cls.source_copy / "requirements-build.lock"),
            ]
        )

    @classmethod
    def _download_locked_ijson(cls) -> None:
        cls._run(
            [
                str(cls.venv312_python),
                "-m",
                "pip",
                "download",
                "--require-hashes",
                "--no-deps",
                "--only-binary=:all:",
                "--dest",
                str(cls.downloads),
                "-r",
                str(cls.source_copy / "requirements-preprocessor.lock"),
            ]
        )

    @staticmethod
    def _assert_file_hash(path: Path, expected: str) -> None:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(65_536), b""):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise AssertionError

    @classmethod
    def _bootstrap_command(cls, wheel: Path) -> list[str]:
        return [
            str(cls.venv312_python),
            "-I",
            str(cls.source_copy / "scripts" / "bootstrap_preprocessor.py"),
            "--wheel",
            str(wheel),
        ]

    @classmethod
    def _bootstrap_command_for(cls, python: Path, wheel: Path) -> list[str]:
        return [
            str(python),
            "-I",
            str(cls.source_copy / "scripts" / "bootstrap_preprocessor.py"),
            "--wheel",
            str(wheel),
        ]

    @classmethod
    def _prove_bootstrap_rejects_symlink_input(cls) -> None:
        symlink_parent = cls.external_root / "symlink-input"
        symlink_parent.mkdir()
        symlink = symlink_parent / APPROVED_FILENAME
        symlink.symlink_to(cls.approved_wheel)
        result = cls._run(
            cls._bootstrap_command(symlink),
            expected=2,
        )
        cls._assert_failure_payload(
            result,
            "IJSON_DISTRIBUTION_UNVERIFIED",
            phase="bootstrap",
        )
        symlink.unlink()

    @classmethod
    def _prove_bootstrap_rejects_wrong_filename(cls) -> None:
        wrong = cls.external_root / "wrong-name.whl"
        shutil.copy2(cls.approved_wheel, wrong)
        result = cls._run(cls._bootstrap_command(wrong), expected=2)
        cls._assert_failure_payload(
            result,
            "IJSON_DISTRIBUTION_UNVERIFIED",
            phase="bootstrap",
        )

    @classmethod
    def _prove_bootstrap_rejects_wrong_hash(cls) -> None:
        directory = cls.external_root / "wrong-hash"
        directory.mkdir()
        wrong = directory / APPROVED_FILENAME
        original = cls.approved_wheel.read_bytes()
        wrong.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        result = cls._run(cls._bootstrap_command(wrong), expected=2)
        cls._assert_failure_payload(
            result,
            "IJSON_DISTRIBUTION_UNVERIFIED",
            phase="bootstrap",
        )

    @classmethod
    def _bootstrap_approved_ijson(cls) -> None:
        result = cls._run(cls._bootstrap_command(cls.approved_wheel))
        if json.loads(result.stdout) != {
            "phase": "bootstrap",
            "status": "ready",
        }:
            raise AssertionError
        if result.stderr:
            raise AssertionError

    @classmethod
    def _prove_retained_evidence_does_not_bypass_bad_input(cls) -> None:
        wrong = cls.external_root / "still-wrong-name.whl"
        shutil.copy2(cls.approved_wheel, wrong)
        result = cls._run(cls._bootstrap_command(wrong), expected=2)
        cls._assert_failure_payload(
            result,
            "IJSON_DISTRIBUTION_UNVERIFIED",
            phase="bootstrap",
        )

    @classmethod
    def _site_packages(cls, python: Path) -> Path:
        result = cls._run(
            [
                str(python),
                "-c",
                "import sysconfig; print(sysconfig.get_path('purelib'))",
            ]
        )
        return Path(result.stdout.strip())

    @classmethod
    def _build_project_wheel(cls) -> Path:
        wheels = cls.external_root / "project-wheels"
        wheels.mkdir()
        cls._run(
            [
                str(cls.venv312_python),
                "-m",
                "pip",
                "wheel",
                "--no-deps",
                "--no-build-isolation",
                "--wheel-dir",
                str(wheels),
                str(cls.source_copy),
            ],
            cwd=cls.external_root,
        )
        candidates = list(wheels.glob("chat_history_analysis-0.1.0-*.whl"))
        if len(candidates) != 1:
            raise AssertionError
        return candidates[0]

    @classmethod
    def _install_project(cls, python: Path) -> None:
        cls._run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--no-deps",
                "--no-index",
                "--force-reinstall",
                str(cls.project_wheel),
            ]
        )

    @classmethod
    def _assert_private_output(cls, result: subprocess.CompletedProcess[str]) -> None:
        combined = result.stdout + result.stderr
        forbidden = (
            str(cls.repository),
            str(cls.external_root),
            "Traceback",
            "files.pythonhosted.org",
            APPROVED_SHA256,
            APPROVED_FILENAME,
            "_yajl2.cpython-312-darwin.so",
            "version.py",
            SENSITIVE_VALUE,
        )
        for value in forbidden:
            if value in combined:
                raise AssertionError("PRIVATE_OUTPUT")

    @classmethod
    def _assert_failure_payload(
        cls,
        result: subprocess.CompletedProcess[str],
        reason_code: str,
        *,
        phase: str = "startup",
    ) -> None:
        if result.stdout:
            raise AssertionError
        if json.loads(result.stderr) != {
            "phase": phase,
            "reasonCode": reason_code,
        }:
            raise AssertionError
        cls._assert_private_output(result)

    @classmethod
    def _run_console(
        cls,
        *,
        executable: Path | None = None,
        arguments: list[str] | None = None,
        environment: dict[str, str] | None = None,
        expected: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        return cls._run(
            [
                str(executable or cls.console312),
                *(arguments or ["startup-check"]),
            ],
            cwd=cls.external_root,
            environment=environment,
            expected=expected,
        )

    @classmethod
    def _assert_empty_directory(cls, directory: Path) -> None:
        if any(directory.iterdir()):
            raise AssertionError("REDIRECTED_INSTALLATION")

    @classmethod
    def _mutated_lock_copy(cls, source: Path, destination: Path) -> None:
        text = source.read_text(encoding="utf-8")
        if "#sha256=" in text:
            raise AssertionError("DUPLICATE_HASH_AUTHORITY")
        mutated, count = LOCK_HASH_PATTERN.subn(
            "--hash=sha256:" + ("0" * 64),
            text,
            count=1,
        )
        if count != 1 or mutated == text:
            raise AssertionError("LOCK_HASH_NOT_MUTATED")
        destination.write_text(mutated, encoding="utf-8")

    @classmethod
    def _comment_only_lock_copy(cls, source: Path, destination: Path) -> None:
        text = source.read_text(encoding="utf-8")
        destination.write_text(
            "# synthetic unrelated comment\n" + text,
            encoding="utf-8",
        )

    @classmethod
    def _download_lock(
        cls,
        lock: Path,
        destination: Path,
        *,
        expected: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        destination.mkdir()
        return cls._run(
            [
                str(cls.venv312_python),
                "-m",
                "pip",
                "download",
                "--disable-pip-version-check",
                "--require-hashes",
                "--no-deps",
                "--only-binary=:all:",
                "--dest",
                str(destination),
                "-r",
                str(lock),
            ],
            expected=expected,
        )

    @classmethod
    def _run_bootstrap_with_pip_hook(
        cls,
        label: str,
        mode: str,
    ) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
        venv = cls.external_root / ("post-install-" + label)
        destination = cls.external_root / ("post-install-destination-" + label)
        destination.mkdir()
        cls._create_venv(cls.python312, venv)
        python = venv / "bin" / "python"
        driver = (
            "import importlib.util,pathlib,subprocess,sys,sysconfig;"
            "spec=importlib.util.spec_from_file_location('bootstrap_under_test',"
            "sys.argv[1]);"
            "module=importlib.util.module_from_spec(spec);"
            "spec.loader.exec_module(module);"
            "original_run=module.subprocess.run;"
            "mode=sys.argv[3];destination=pathlib.Path(sys.argv[4]);"
            "purelib=pathlib.Path(sysconfig.get_path('purelib'))\n"
            "def hooked(command,**kwargs):\n"
            "    if len(command)>=4 and command[0]==sys.executable and "
            "command[1:4]==['-I','-m','pip']:\n"
            "        if mode=='noop':\n"
            "            return subprocess.CompletedProcess(command,0,'','')\n"
            "        selected=list(command)\n"
            "        if mode=='redirect':\n"
            "            selected[-1:-1]=['--target',str(destination)]\n"
            "        result=original_run(selected,**kwargs)\n"
            "        if result.returncode==0 and mode=='python':\n"
            "            target=purelib/'ijson'/'version.py';"
            "target.write_bytes(target.read_bytes()+b'\\n# synthetic mutation\\n')\n"
            "        if result.returncode==0 and mode=='native':\n"
            "            target=purelib/'ijson'/'backends'/"
            "'_yajl2.cpython-312-darwin.so';data=target.read_bytes();"
            "target.write_bytes(data[:-1]+bytes([data[-1]^1]))\n"
            "        if result.returncode==0 and mode=='unexpected':\n"
            "            (purelib/'ijson'/'synthetic_unexpected.py').write_text("
            "'SYNTHETIC=True\\n',encoding='utf-8')\n"
            "        return result\n"
            "    return original_run(command,**kwargs)\n"
            "module.subprocess.run=hooked;"
            "raise SystemExit(module.main(['--wheel',sys.argv[2]]))"
        )
        result = cls._run(
            [
                str(python),
                "-c",
                driver,
                str(cls.source_copy / "scripts" / "bootstrap_preprocessor.py"),
                str(cls.approved_wheel),
                mode,
                str(destination),
            ],
            cwd=cls.external_root,
            expected=2,
        )
        return result, venv, destination

    def test_real_console_and_native_backend_are_ready(self):
        result = self._run_console()
        self.assertEqual(
            json.loads(result.stdout),
            {"phase": "startup", "status": "ready"},
        )
        self.assertEqual(result.stderr, "")
        self._assert_private_output(result)

    def test_hostile_python_and_pip_environment_cannot_redirect_bootstrap(self):
        fake_root = self.external_root / "fake-pip-root"
        fake_package = fake_root / "pip"
        fake_package.mkdir(parents=True)
        fake_marker = self.external_root / "fake-pip-imported"
        (fake_package / "__init__.py").write_text("", encoding="utf-8")
        (fake_package / "__main__.py").write_text(
            "from pathlib import Path\n"
            + f"Path({str(fake_marker)!r}).write_text('imported', encoding='utf-8')\n",
            encoding="utf-8",
        )
        malicious_config = self.external_root / "malicious-pip.conf"
        config_destination = self.external_root / "config-destination"
        malicious_config.write_text(
            "[global]\n"
            f"target = {config_destination}\n"
            f"index-url = {SENSITIVE_VALUE}\n"
            f"find-links = {fake_root}\n",
            encoding="utf-8",
        )

        cases = (
            ("pythonpath", {"PYTHONPATH": str(fake_root)}),
            ("target", {"PIP_TARGET": str(self.external_root / "target")}),
            ("prefix", {"PIP_PREFIX": str(self.external_root / "prefix")}),
            ("root", {"PIP_ROOT": str(self.external_root / "root")}),
            (
                "user",
                {
                    "PIP_USER": "1",
                    "PYTHONUSERBASE": str(self.external_root / "userbase"),
                },
            ),
            ("config", {"PIP_CONFIG_FILE": str(malicious_config)}),
            (
                "indexes",
                {
                    "PIP_INDEX_URL": SENSITIVE_VALUE,
                    "PIP_EXTRA_INDEX_URL": SENSITIVE_VALUE,
                    "PIP_FIND_LINKS": str(fake_root),
                },
            ),
            (
                "combined",
                {
                    "PYTHONPATH": str(fake_root),
                    "PYTHONHOME": str(self.external_root / "python-home"),
                    "PYTHONSTARTUP": str(self.external_root / "python-startup"),
                    "PYTHONINSPECT": "1",
                    "PYTHONUSERBASE": str(self.external_root / "combined-userbase"),
                    "PYTHONWARNINGS": SENSITIVE_VALUE,
                    "PIP_TARGET": str(self.external_root / "combined-target"),
                    "PIP_PREFIX": str(self.external_root / "combined-prefix"),
                    "PIP_ROOT": str(self.external_root / "combined-root"),
                    "PIP_USER": "1",
                    "PIP_CONFIG_FILE": str(malicious_config),
                    "PIP_INDEX_URL": SENSITIVE_VALUE,
                    "PIP_EXTRA_INDEX_URL": SENSITIVE_VALUE,
                    "PIP_FIND_LINKS": str(fake_root),
                },
            ),
        )

        for name, hostile in cases:
            with self.subTest(name=name):
                environment = self._clean_environment()
                environment.update(hostile)
                result = self._run(
                    self._bootstrap_command_for(
                        self.hostile_venv_python,
                        self.approved_wheel,
                    ),
                    cwd=fake_root,
                    environment=environment,
                )
                self.assertEqual(
                    json.loads(result.stdout),
                    {"phase": "bootstrap", "status": "ready"},
                )
                self.assertEqual(result.stderr, "")
                self._assert_private_output(result)
                self.assertFalse(fake_marker.exists())

        package_root = self._site_packages(self.hostile_venv_python) / "ijson"
        self.assertTrue(package_root.is_dir())
        for name in (
            "target",
            "prefix",
            "root",
            "userbase",
            "config-destination",
            "combined-target",
            "combined-prefix",
            "combined-root",
            "combined-userbase",
        ):
            destination = self.external_root / name
            if destination.exists():
                self._assert_empty_directory(destination)

    def test_post_install_verification_rejects_adversarial_states(self):
        for mode in ("noop", "redirect", "python", "native", "unexpected"):
            with self.subTest(mode=mode):
                result, venv, destination = self._run_bootstrap_with_pip_hook(
                    mode,
                    mode,
                )
                self._assert_failure_payload(
                    result,
                    "IJSON_DISTRIBUTION_UNVERIFIED",
                    phase="bootstrap",
                )
                package_root = self._site_packages(venv / "bin" / "python") / "ijson"
                if mode in {"noop", "redirect"}:
                    self.assertFalse(package_root.exists())
                if mode == "redirect":
                    self.assertTrue((destination / "ijson").is_dir())

    def test_lock_hashes_are_single_authorities_and_mutations_fail(self):
        locks = (
            ("build", self.source_copy / "requirements-build.lock", 2),
            (
                "preprocessor",
                self.source_copy / "requirements-preprocessor.lock",
                1,
            ),
        )
        for name, source, expected_wheels in locks:
            with self.subTest(name=name):
                text = source.read_text(encoding="utf-8")
                self.assertNotIn("#sha256=", text)
                self.assertEqual(
                    text.count("--hash=sha256:"),
                    text.count(" @ https://"),
                )

                comment_lock = self.external_root / (name + "-comment.lock")
                self._comment_only_lock_copy(source, comment_lock)
                comment_downloads = self.external_root / (name + "-comment-downloads")
                self._download_lock(comment_lock, comment_downloads)
                self.assertEqual(
                    len(list(comment_downloads.glob("*.whl"))),
                    expected_wheels,
                )

                mutated_lock = self.external_root / (name + "-mutated.lock")
                self._mutated_lock_copy(source, mutated_lock)
                mutated_downloads = self.external_root / (name + "-mutated-downloads")
                self._download_lock(
                    mutated_lock,
                    mutated_downloads,
                    expected=1,
                )
                self.assertEqual(list(mutated_downloads.iterdir()), [])

    def test_installed_wheel_has_no_frontend_or_server_artifacts(self):
        with zipfile.ZipFile(self.project_wheel) as archive:
            names = archive.namelist()
        forbidden = (
            "node_modules/",
            "package.json",
            ".html",
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
        )
        for name in names:
            self.assertFalse(any(token in name for token in forbidden))

    def test_runtime_attempts_no_network_access(self):
        result = self._run(
            [
                str(self.venv312_python),
                "-c",
                (
                    "import socket;"
                    "socket.socket=lambda *a,**k:(_ for _ in ()).throw("
                    "AssertionError('network'));"
                    "from chat_history_analysis.bootstrap_cli import main;"
                    "raise SystemExit(main(['startup-check']))"
                ),
            ],
            cwd=self.external_root,
        )
        self.assertEqual(
            json.loads(result.stdout),
            {"phase": "startup", "status": "ready"},
        )
        self.assertEqual(result.stderr, "")
        self._assert_private_output(result)

    def test_missing_retained_archive_fails_closed(self):
        backup = self.external_root / "retained-backup.whl"
        self.evidence.replace(backup)
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            backup.replace(self.evidence)

    def test_symlinked_retained_archive_fails_closed(self):
        backup = self.external_root / "retained-symlink-backup.whl"
        self.evidence.replace(backup)
        self.evidence.symlink_to(backup)
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            self.evidence.unlink()
            backup.replace(self.evidence)

    def test_valid_installed_metadata_cannot_mask_modified_retained_archive(self):
        original = self.evidence.read_bytes()
        self.evidence.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            self.evidence.write_bytes(original)

    def test_wrong_archive_hash_fails_closed(self):
        original = self.evidence.read_bytes()
        self.evidence.write_bytes(b"synthetic invalid archive")
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            self.evidence.write_bytes(original)

    def test_modified_installed_python_file_fails_closed(self):
        target = self.package_root / "version.py"
        original = target.read_bytes()
        target.write_bytes(original + b"\n# synthetic mutation\n")
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            target.write_bytes(original)

    def test_modified_native_extension_fails_closed(self):
        target = self.package_root / "backends" / "_yajl2.cpython-312-darwin.so"
        original = target.read_bytes()
        target.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            target.write_bytes(original)

    def test_unexpected_package_file_fails_closed(self):
        unexpected = self.package_root / "synthetic_unexpected.py"
        unexpected.write_text("SYNTHETIC = True\n", encoding="utf-8")
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            unexpected.unlink()

    def test_forged_direct_url_cannot_make_altered_installation_pass(self):
        direct_url = self.dist_info / "direct_url.json"
        target = self.package_root / "version.py"
        original_direct_url = direct_url.read_bytes()
        original_target = target.read_bytes()
        direct_url.write_text(
            json.dumps(
                {
                    "url": SENSITIVE_VALUE,
                    "archive_info": {"hashes": {"sha256": APPROVED_SHA256}},
                }
            ),
            encoding="utf-8",
        )
        target.write_bytes(original_target + b"\n# synthetic mutation\n")
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            target.write_bytes(original_target)
            direct_url.write_bytes(original_direct_url)

    def test_forged_record_cannot_make_altered_installation_pass(self):
        record = self.dist_info / "RECORD"
        target = self.package_root / "version.py"
        original_record = record.read_bytes()
        original_target = target.read_bytes()
        record.write_text(
            "ijson/version.py,sha256=synthetic,999\n",
            encoding="utf-8",
        )
        target.write_bytes(original_target + b"\n# synthetic mutation\n")
        try:
            result = self._run_console(expected=2)
            self._assert_failure_payload(result, "IJSON_DISTRIBUTION_UNVERIFIED")
        finally:
            target.write_bytes(original_target)
            record.write_bytes(original_record)

    def test_valid_installation_ignores_forged_metadata(self):
        direct_url = self.dist_info / "direct_url.json"
        record = self.dist_info / "RECORD"
        original_direct_url = direct_url.read_bytes()
        original_record = record.read_bytes()
        direct_url.write_text(SENSITIVE_VALUE, encoding="utf-8")
        record.write_text(SENSITIVE_VALUE, encoding="utf-8")
        try:
            result = self._run_console()
            self.assertEqual(
                json.loads(result.stdout),
                {"phase": "startup", "status": "ready"},
            )
            self._assert_private_output(result)
        finally:
            direct_url.write_bytes(original_direct_url)
            record.write_bytes(original_record)

    def test_python39_installed_console_rejects_before_application_import(self):
        console = self.venv39 / "bin" / "chat-history-analysis"
        result = self._run_console(executable=console, expected=2)
        self._assert_failure_payload(result, "UNSUPPORTED_PYTHON_RUNTIME")
        probe = self._run(
            [
                str(self.venv39 / "bin" / "python"),
                "-c",
                (
                    "import sys;"
                    "from chat_history_analysis import bootstrap_cli;"
                    "result=bootstrap_cli.main(['startup-check']);"
                    "assert 'chat_history_analysis.cli' not in sys.modules;"
                    "assert 'ijson' not in sys.modules;"
                    "raise SystemExit(result)"
                ),
            ],
            cwd=self.external_root,
            expected=2,
        )
        self._assert_failure_payload(probe, "UNSUPPORTED_PYTHON_RUNTIME")

    def test_python313_installed_console_rejects_and_cannot_bypass(self):
        console = self.venv313 / "bin" / "chat-history-analysis"
        result = self._run_console(executable=console, expected=2)
        self._assert_failure_payload(result, "UNSUPPORTED_PYTHON_RUNTIME")
        probe = self._run(
            [
                str(self.venv313 / "bin" / "python"),
                "-c",
                (
                    "import inspect,sys;"
                    "from chat_history_analysis import bootstrap_cli;"
                    "assert tuple(inspect.signature(bootstrap_cli.main).parameters)"
                    " == ('argv',);"
                    "result=bootstrap_cli.main(['startup-check']);"
                    "assert 'chat_history_analysis.cli' not in sys.modules;"
                    "assert 'ijson' not in sys.modules;"
                    "raise SystemExit(result)"
                ),
            ],
            cwd=self.external_root,
            expected=2,
        )
        self._assert_failure_payload(probe, "UNSUPPORTED_PYTHON_RUNTIME")

    def test_backend_override_fails_as_mismatch(self):
        environment = self._clean_environment()
        environment["IJSON_BACKEND"] = "python"
        result = self._run_console(environment=environment, expected=2)
        self._assert_failure_payload(result, "IJSON_BACKEND_MISMATCH")

    def test_invalid_arguments_are_content_free(self):
        result = self._run_console(
            arguments=[SENSITIVE_VALUE],
            expected=2,
        )
        self.assertEqual(result.stdout, "")
        self.assertIn("usage: chat-history-analysis", result.stderr)
        self._assert_private_output(result)


if __name__ == "__main__":
    unittest.main()
