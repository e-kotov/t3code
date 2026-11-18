"""The screenshot baseline adapter changes imports, never historical UI behavior."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "fork_usage_baseline", Path(__file__).with_name("fork-usage-baseline.py"),
)
assert spec and spec.loader
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class UsageBaselineTest(unittest.TestCase):
    def test_mixed_import_preserves_binding_names_types_and_component(self):
        body = '\nexport function Previous() { return <p>Old markup {formatResetsIn(null, 0)}</p>; }\n'
        source = '''import {
  collectLimitAccounts,
  collectLimitNotices,
  formatResetsIn,
  type LimitPool,
  cursorUsageWindowDetails as details,
} from "@t3tools/shared/usageLimits";''' + body
        result = baseline.adapt_imports(source)
        self.assertEqual(result, (
            'import { collectLimitAccounts, type LimitPool } from "@t3tools/shared/usageLimits";\n'
            'import { collectLimitNotices, formatResetsIn, cursorUsageWindowDetails as details } '
            'from "@t3tools/shared/usageLimitsCopy";' + body
        ))
        self.assertEqual(baseline.adapt_imports(result), result)

    def test_compact_display_import_is_relocated_without_changing_body(self):
        source = 'import { formatDuration } from "@t3tools/shared/usageLimits";\nconst view = "Before";\n'
        self.assertEqual(baseline.adapt_imports(source), source.replace(
            'from "@t3tools/shared/usageLimits"', 'from "@t3tools/shared/usageLimitsCopy"',
        ))

    def test_already_current_and_unrelated_imports_are_unchanged(self):
        source = ('import { formatDuration } from "@t3tools/shared/usageLimitsCopy";\n'
                  'import { remainingPercent } from "@t3tools/shared/usageLimits";\n')
        self.assertEqual(baseline.adapt_imports(source), source)

    def test_unsupported_import_is_not_silently_changed(self):
        with self.assertRaises(ValueError):
            baseline.adapt_imports('import { /* review this */ formatDuration } from "@t3tools/shared/usageLimits";')


if __name__ == "__main__":
    unittest.main()
