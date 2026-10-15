#!/usr/bin/env bash
# Focused checks for the editor-preferences feature. Run in a dependency-equipped CI checkout.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="$PWD/node_modules/.bin:$PATH"
command -v vp >/dev/null || { echo 'Run vp install on the CI runner first.' >&2; exit 1; }
check_status=0
vp run --concurrency-limit 2 --filter @t3tools/contracts --filter t3 --filter @t3tools/web --filter @t3tools/desktop typecheck || check_status=1
(cd packages/contracts && vp test run --config ../../vite.config.ts src/customEditors.test.ts src/forkEditors.test.ts) || check_status=1
(cd apps/server && vp test run src/process/customEditorLaunch.test.ts src/process/externalLauncher.test.ts) || check_status=1
(cd apps/desktop && vp test run src/ipc/methods/customEditors.test.ts src/electron/ElectronShell.test.ts src/electron/forkEditors.test.ts) || check_status=1
(cd apps/web && vp test run --project unit src/forkEditorPreferences.test.ts src/useConfiguredEditors.test.ts src/forkLocalEditorActions.test.ts src/components/settings/customEditorDraft.test.ts src/components/settings/EditorSettings.test.tsx src/components/chat/forkOpenInOptions.test.ts src/components/chat/OpenInPicker.test.ts src/editorPreferences.test.ts src/components/ChatMarkdown.test.tsx src/components/ChatMarkdown.assets.test.tsx src/components/settings/IntegrationsSettings.test.tsx src/components/settings/settingsSearch.test.ts) || check_status=1
exit "$check_status"
