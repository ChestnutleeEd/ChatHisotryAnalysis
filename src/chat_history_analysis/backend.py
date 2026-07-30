"""Exact native ijson backend loading and identity evidence."""

from __future__ import annotations

from dataclasses import dataclass
import importlib
from pathlib import Path
import sys
from typing import Any, Callable, Final, Iterable

from .distribution import installed_package_file


EXPECTED_BACKEND_MODULE: Final = "ijson.backends.yajl2_c"
EXPECTED_BACKEND_NAME: Final = "yajl2_c"

Parser = Callable[..., Iterable[tuple[str, str, Any]]]


class BackendLoadFailure(Exception):
    """Internal content-free marker for native backend import failure."""


@dataclass(frozen=True)
class BackendEvidence:
    """Identity evidence for the explicitly imported parser backend."""

    module_name: str
    backend_name: str
    selected_backend_name: str
    selected_parse_matches: bool
    module_origin_matches_distribution: bool
    native_origin_matches_distribution: bool
    parser_error_origin_matches_distribution: bool
    parse: Parser
    parser_error_types: tuple[type[Exception], ...]


def _same_installed_file(module_file: str, relative_name: str) -> bool:
    try:
        expected = installed_package_file(relative_name.removeprefix("ijson/")).resolve(
            strict=True
        )
        observed = Path(module_file).resolve(strict=True)
    except Exception:
        return False
    return observed == expected


def load_exact_backend() -> BackendEvidence:
    """Import only the approved backend and detect automatic substitution."""

    try:
        backend_module = importlib.import_module(EXPECTED_BACKEND_MODULE)
        native_module = importlib.import_module("ijson.backends._yajl2")
        common_module = importlib.import_module("ijson.common")
        package_module = sys.modules["ijson"]
        parser = backend_module.parse
        selected_parser = package_module.parse
        parser_error = common_module.JSONError
        if not isinstance(parser_error, type) or not issubclass(
            parser_error,
            Exception,
        ):
            raise TypeError
    except Exception:
        raise BackendLoadFailure from None

    return BackendEvidence(
        module_name=getattr(backend_module, "__name__", ""),
        backend_name=getattr(backend_module, "backend", ""),
        selected_backend_name=getattr(package_module, "backend", ""),
        selected_parse_matches=selected_parser is parser,
        module_origin_matches_distribution=_same_installed_file(
            getattr(backend_module, "__file__", ""),
            "ijson/backends/yajl2_c.py",
        ),
        native_origin_matches_distribution=_same_installed_file(
            getattr(native_module, "__file__", ""),
            "ijson/backends/_yajl2.cpython-312-darwin.so",
        ),
        parser_error_origin_matches_distribution=_same_installed_file(
            getattr(common_module, "__file__", ""),
            "ijson/common.py",
        ),
        parse=parser,
        parser_error_types=(parser_error,),
    )


def backend_identity_is_exact(evidence: BackendEvidence) -> bool:
    """Return true only when explicit and selected identities are yajl2_c."""

    return (
        evidence.module_name == EXPECTED_BACKEND_MODULE
        and evidence.backend_name == EXPECTED_BACKEND_NAME
        and evidence.selected_backend_name == EXPECTED_BACKEND_NAME
        and evidence.selected_parse_matches
        and evidence.module_origin_matches_distribution
        and evidence.native_origin_matches_distribution
        and evidence.parser_error_origin_matches_distribution
    )
