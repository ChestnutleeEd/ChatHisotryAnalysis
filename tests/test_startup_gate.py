from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
import inspect
import io
import json
import unittest
from unittest.mock import patch

from chat_history_analysis.application import (
    _PreprocessorApplication,
    _SourceAuthorization,
    run_source_operation,
)
from chat_history_analysis.backend import BackendEvidence
from chat_history_analysis.cli import _run_for_test, main
from chat_history_analysis.distribution import (
    APPROVED_ARTIFACT,
    EXPECTED_DISTRIBUTION_NAME,
    EXPECTED_DISTRIBUTION_VERSION,
    EXPECTED_LICENSE_EXPRESSION,
    InstalledDistributionEvidence,
)
from chat_history_analysis.errors import StartupError, StartupReasonCode
from chat_history_analysis.runtime import RuntimeFacts
from chat_history_analysis.startup import (
    SELF_CHECK_EVENTS,
    SELF_CHECK_REJECTED_DOCUMENTS,
    StartupGate,
)


SENSITIVE_VALUE = "/private/example/raw-chat.json?token=secret-message"


class SyntheticParserError(Exception):
    pass


def valid_runtime() -> RuntimeFacts:
    return RuntimeFacts(
        implementation="CPython",
        version=(3, 12, 9),
        system="Darwin",
        architecture="arm64",
    )


def valid_distribution() -> InstalledDistributionEvidence:
    return InstalledDistributionEvidence(
        name=EXPECTED_DISTRIBUTION_NAME,
        version=EXPECTED_DISTRIBUTION_VERSION,
        license_expression=EXPECTED_LICENSE_EXPRESSION,
        artifact_filename=APPROVED_ARTIFACT.filename,
        artifact_sha256=APPROVED_ARTIFACT.sha256,
        wheel_tags=frozenset({APPROVED_ARTIFACT.wheel_tag}),
        installed_files_match=True,
        native_extension_matches=True,
    )


def successful_parse(source: object, **options: object):
    if not isinstance(source, io.BytesIO):
        raise AssertionError
    document = source.read()
    if options != {
        "use_float": False,
        "multiple_values": False,
        "allow_comments": False,
        "buf_size": 65_536,
    }:
        raise AssertionError
    if document in SELF_CHECK_REJECTED_DOCUMENTS:
        raise SyntheticParserError
    if document != b'{"ready":[1]}':
        raise AssertionError
    return iter(SELF_CHECK_EVENTS)


def valid_backend() -> BackendEvidence:
    return BackendEvidence(
        module_name="ijson.backends.yajl2_c",
        backend_name="yajl2_c",
        selected_backend_name="yajl2_c",
        selected_parse_matches=True,
        module_origin_matches_distribution=True,
        native_origin_matches_distribution=True,
        parser_error_origin_matches_distribution=True,
        parse=successful_parse,
        parser_error_types=(SyntheticParserError,),
    )


def gate_with(
    *,
    runtime: RuntimeFacts | None = None,
    distribution: InstalledDistributionEvidence | None = None,
    backend_provider=None,
) -> StartupGate:
    selected_runtime = runtime if runtime is not None else valid_runtime()
    selected_distribution = (
        distribution if distribution is not None else valid_distribution()
    )
    selected_backend_provider = (
        backend_provider if backend_provider is not None else valid_backend
    )
    return StartupGate(
        runtime_provider=lambda: selected_runtime,
        distribution_provider=lambda: selected_distribution,
        backend_provider=selected_backend_provider,
    )


def run_with_gate(gate: StartupGate, operation):
    with patch(
        "chat_history_analysis.application.StartupGate",
        return_value=gate,
    ):
        return run_source_operation(operation)


class SourceOpenSentinel:
    def __init__(self) -> None:
        self.calls = 0

    def open(self, authorization: object) -> str:
        self.calls += 1
        return "opened"


class StartupGateTests(unittest.TestCase):
    def failure_cases(self):
        def unavailable_backend():
            raise RuntimeError(SENSITIVE_VALUE)

        def failed_parser(source: object, **options: object):
            raise RuntimeError(SENSITIVE_VALUE)

        return (
            (
                "unsupported implementation",
                gate_with(
                    runtime=replace(
                        valid_runtime(),
                        implementation=SENSITIVE_VALUE,
                    )
                ),
                StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME,
            ),
            (
                "unsupported Python version",
                gate_with(runtime=replace(valid_runtime(), version=(3, 13, 0))),
                StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME,
            ),
            (
                "unsupported operating system",
                gate_with(runtime=replace(valid_runtime(), system=SENSITIVE_VALUE)),
                StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME,
            ),
            (
                "unsupported architecture",
                gate_with(
                    runtime=replace(valid_runtime(), architecture=SENSITIVE_VALUE)
                ),
                StartupReasonCode.UNSUPPORTED_PYTHON_RUNTIME,
            ),
            (
                "wrong ijson version",
                gate_with(
                    distribution=replace(
                        valid_distribution(),
                        version=SENSITIVE_VALUE,
                    )
                ),
                StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED,
            ),
            (
                "unapproved distribution hash",
                gate_with(
                    distribution=replace(
                        valid_distribution(),
                        artifact_sha256=SENSITIVE_VALUE,
                    )
                ),
                StartupReasonCode.IJSON_DISTRIBUTION_UNVERIFIED,
            ),
            (
                "unavailable backend",
                gate_with(backend_provider=unavailable_backend),
                StartupReasonCode.IJSON_BACKEND_UNAVAILABLE,
            ),
            (
                "mismatched backend",
                gate_with(
                    backend_provider=lambda: replace(
                        valid_backend(),
                        module_name=SENSITIVE_VALUE,
                    )
                ),
                StartupReasonCode.IJSON_BACKEND_MISMATCH,
            ),
            (
                "automatic Python fallback",
                gate_with(
                    backend_provider=lambda: replace(
                        valid_backend(),
                        selected_backend_name="python",
                    )
                ),
                StartupReasonCode.IJSON_BACKEND_MISMATCH,
            ),
            (
                "parser initialization failure",
                gate_with(
                    backend_provider=lambda: replace(
                        valid_backend(),
                        parse=failed_parser,
                    )
                ),
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED,
            ),
            (
                "unexpected parser event sequence",
                gate_with(
                    backend_provider=lambda: replace(
                        valid_backend(),
                        parse=lambda source, **options: iter(()),
                    )
                ),
                StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED,
            ),
        )

    def test_every_failure_keeps_source_unopened_and_errors_content_free(self):
        for name, gate, expected_reason in self.failure_cases():
            with self.subTest(name=name):
                sentinel = SourceOpenSentinel()
                with self.assertRaises(StartupError) as raised:
                    run_with_gate(gate, sentinel.open)

                self.assertEqual(sentinel.calls, 0)
                self.assertEqual(raised.exception.reason_code, expected_reason)
                returned_error = json.dumps(
                    raised.exception.public_payload(),
                    sort_keys=True,
                )
                self.assertNotIn(SENSITIVE_VALUE, returned_error)
                self.assertNotIn(SENSITIVE_VALUE, str(raised.exception))

                stdout = io.StringIO()
                stderr = io.StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    exit_code = _run_for_test(["startup-check"], gate.verify)
                self.assertEqual(exit_code, 2)
                self.assertEqual(stdout.getvalue(), "")
                self.assertNotIn(SENSITIVE_VALUE, stderr.getvalue())
                self.assertNotIn("Traceback", stderr.getvalue())
                payload = json.loads(stderr.getvalue())
                self.assertEqual(payload["phase"], "startup")
                self.assertEqual(payload["reasonCode"], expected_reason.value)
                self.assertEqual(
                    set(payload),
                    {"category", "phase", "reasonCode"},
                )
                self.assertEqual(payload["category"], "startup")

    def test_success_calls_source_open_only_after_all_checks(self):
        sentinel = SourceOpenSentinel()
        result = run_with_gate(gate_with(), sentinel.open)
        self.assertEqual(result, "opened")
        self.assertEqual(sentinel.calls, 1)

    def test_startup_check_success_is_content_free(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = _run_for_test(["startup-check"], gate_with().verify)
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"phase": "startup", "status": "ready"},
        )

    def test_invalid_readiness_invocation_does_not_echo_user_input(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = main([SENSITIVE_VALUE])
        self.assertEqual(exit_code, 64)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(SENSITIVE_VALUE, stderr.getvalue())

    def test_runtime_failure_stops_later_providers(self):
        calls = []

        def distribution_provider():
            calls.append("distribution")
            return valid_distribution()

        def backend_provider():
            calls.append("backend")
            return valid_backend()

        gate = StartupGate(
            runtime_provider=lambda: replace(valid_runtime(), version=(3, 13, 0)),
            distribution_provider=distribution_provider,
            backend_provider=backend_provider,
        )
        with self.assertRaises(StartupError):
            gate.verify()
        self.assertEqual(calls, [])

    def test_success_order_precedes_source_open(self):
        calls = []

        def runtime_provider():
            calls.append("runtime")
            return valid_runtime()

        def distribution_provider():
            calls.append("distribution")
            return valid_distribution()

        def ordered_parse(source: object, **options: object):
            calls.append("parser")
            return successful_parse(source, **options)

        def backend_provider():
            calls.append("backend")
            return replace(valid_backend(), parse=ordered_parse)

        def source_open():
            calls.append("source-open")

        gate = StartupGate(
            runtime_provider=runtime_provider,
            distribution_provider=distribution_provider,
            backend_provider=backend_provider,
        )
        run_with_gate(
            gate,
            lambda authorization: source_open(),
        )
        self.assertEqual(
            calls,
            [
                "runtime",
                "distribution",
                "backend",
                "parser",
                "parser",
                "parser",
                "parser",
                "source-open",
            ],
        )

    def test_public_main_has_no_gate_injection_parameter(self):
        self.assertEqual(
            tuple(inspect.signature(main).parameters),
            ("argv",),
        )
        with self.assertRaises(TypeError):
            main(["startup-check"], gate=gate_with())

    def test_application_construction_rejects_an_ordinary_caller(self):
        with self.assertRaises(TypeError):
            _PreprocessorApplication(object(), gate_with())
        with self.assertRaises(TypeError):
            _SourceAuthorization(object())

    def test_continuation_exception_occurs_only_after_successful_gate(self):
        calls = []

        def operation(authorization: object):
            calls.append("source-operation")
            raise RuntimeError(SENSITIVE_VALUE)

        with self.assertRaises(RuntimeError):
            run_with_gate(gate_with(), operation)
        self.assertEqual(calls, ["source-operation"])

    def test_cancellation_like_gate_interruption_keeps_continuation_unopened(self):
        sentinel = SourceOpenSentinel()

        class InterruptingGate:
            def verify(self):
                raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            run_with_gate(InterruptingGate(), sentinel.open)
        self.assertEqual(sentinel.calls, 0)

    def test_negative_probe_acceptance_fails_readiness(self):
        def permissive_parse(source: object, **options: object):
            document = source.read()
            if document == b'{"ready":[1]}':
                return iter(SELF_CHECK_EVENTS)
            return iter(())

        backend = replace(valid_backend(), parse=permissive_parse)
        with self.assertRaises(StartupError) as raised:
            gate_with(backend_provider=lambda: backend).verify()
        self.assertEqual(
            raised.exception.reason_code,
            StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED,
        )

    def test_unexpected_negative_probe_exception_fails_readiness(self):
        def wrong_failure_parse(source: object, **options: object):
            document = source.read()
            if document == b'{"ready":[1]}':
                return iter(SELF_CHECK_EVENTS)
            raise ValueError(SENSITIVE_VALUE)

        backend = replace(valid_backend(), parse=wrong_failure_parse)
        with self.assertRaises(StartupError) as raised:
            gate_with(backend_provider=lambda: backend).verify()
        self.assertEqual(
            raised.exception.reason_code,
            StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED,
        )
        self.assertNotIn(SENSITIVE_VALUE, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
