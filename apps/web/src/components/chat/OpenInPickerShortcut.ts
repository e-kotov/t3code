import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

import { useConfiguredEditors } from "../../useConfiguredEditors";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";

export function useOpenFavoriteEditorShortcut({
  enabled,
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
}: {
  enabled: boolean;
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const { preferredEditor, open } = useConfiguredEditors(environmentId, availableEditors);

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(event, keybindings)) return;
      if (!openInCwd || !preferredEditor) return;

      event.preventDefault();
      void open(openInCwd);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, keybindings, openInCwd, open, preferredEditor]);
}
