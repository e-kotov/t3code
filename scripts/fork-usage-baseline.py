#!/usr/bin/env python3
"""Adapt only relocated imports in historical usage-display screenshot fixtures.

The baseline component body stays byte-for-byte unchanged. This lets its original
English UI render against the current shared API after the i18n copy extraction;
it does not shim production exports or replace the baseline with current markup.
"""
import re
import sys
from pathlib import Path

COPY_EXPORTS = frozenset({
    "collectExternalUsageLinks", "collectLimitNotices", "cursorUsageWindowDetails",
    "formatDuration", "formatResetsIn", "limitsNotice", "resetCreditChoices",
})
IMPORT = re.compile(
    r'import\s*\{(?P<bindings>[^}]*)\}\s*from\s*'
    r'(?P<quote>[\"\'])@t3tools/shared/usageLimits(?P=quote);'
)
SPECIFIER = re.compile(r"(?P<type>type\s+)?(?P<name>\w+)(?:\s+as\s+\w+)?")


def adapt_imports(source: str) -> str:
    def adapt(match: re.Match[str]) -> str:
        retained, moved = [], []
        for binding in match["bindings"].split(","):
            binding = binding.strip()
            if not binding:
                continue
            specifier = SPECIFIER.fullmatch(binding)
            if specifier is None:
                raise ValueError(f"Unsupported historical import specifier: {binding!r}")
            target = moved if not specifier["type"] and specifier["name"] in COPY_EXPORTS else retained
            target.append(binding)
        if not moved:
            return match[0]
        imports = []
        if retained:
            imports.append('import { ' + ', '.join(retained) + ' } from "@t3tools/shared/usageLimits";')
        imports.append('import { ' + ', '.join(moved) + ' } from "@t3tools/shared/usageLimitsCopy";')
        return "\n".join(imports)

    return IMPORT.sub(adapt, source)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: fork-usage-baseline.py COMPONENT [COMPONENT ...]")
    for filename in sys.argv[1:]:
        path = Path(filename)
        path.write_text(adapt_imports(path.read_text()))
