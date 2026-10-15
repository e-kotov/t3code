import { randomUUID } from "../../lib/utils";
import { EDITORS, REMOTE_CAPABLE_EDITOR_IDS } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironments } from "../../state/environments";
import { useRemoteCapableEditors } from "../../remoteOpen";
import {
  configuredEditorEntries,
  EMPTY_EDITOR_PREFERENCES,
  setEditorVisibility,
  useEditorPreferences,
  type CustomEditor,
  type EditorVisibility,
} from "../../forkEditorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "../ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { SettingsSection, SettingsRow } from "./settingsLayout";
import { validateCustomEditor } from "./customEditorDraft";

function EditorSelect({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={choices}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const VISIBILITY_CHOICES = [
  { value: "auto", label: "Automatic" },
  { value: "show", label: "Always show" },
  { value: "hide", label: "Hide" },
];

export function EditorSettings() {
  return typeof window === "undefined" ? null : <ClientEditorSettings />;
}

function ClientEditorSettings() {
  const { environments } = useEnvironments();
  const [scope, setScope] = useState("remote");
  const remote = scope === "remote";
  const environment = environments.find((entry) => entry.environmentId === scope);
  const [preferences, setPreferences] = useEditorPreferences(
    environment?.environmentId ?? null,
    remote,
  );
  const remoteEditors = useRemoteCapableEditors();
  const detected = remote ? remoteEditors : (environment?.serverConfig?.availableEditors ?? []);
  const entries = configuredEditorEntries(preferences, detected, remote);
  const [editing, setEditing] = useState<CustomEditor | null>(null);
  const targetLabel = remote ? "this device" : (environment?.label ?? "the selected environment");
  const choices = [
    { value: "remote", label: "Remote links on this device" },
    ...environments.map((entry) => ({
      value: entry.environmentId,
      label: `Local commands on ${entry.label}`,
    })),
  ];
  return (
    <SettingsSection id="editors" title="Editors">
      <SettingsRow
        title="Open in editor"
        description="Choose which editors appear in Open in. These preferences are saved in this app or browser profile; commands are kept separately for each environment."
      >
        <div className="space-y-4 py-3">
          <EditorSelect
            label="Editor configuration target"
            value={scope}
            choices={choices}
            onChange={(value) => {
              setScope(value);
              setEditing(null);
            }}
          />
          <p className="text-sm text-muted-foreground">
            {remote
              ? "Links open an editor on this device and connect to the project over SSH. Browsers cannot detect installed editors; choose Always show for the ones you use. Automatic falls back to VS Code when detection is unavailable."
              : `Used when opening projects locally on ${targetLabel}. Remote connections use this device’s editor links instead.`}
          </p>
          {!remote && !environment ? (
            <p role="status">Select an available environment.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">Default editor</span>
                <div className="min-w-48 flex-1">
                  <EditorSelect
                    label="Default editor"
                    value={
                      entries.some((entry) => entry.id === preferences.preferred)
                        ? preferences.preferred!
                        : "automatic"
                    }
                    choices={[
                      { value: "automatic", label: "Automatic" },
                      ...entries.map((entry) => ({ value: entry.id, label: entry.name })),
                    ]}
                    onChange={(value) =>
                      setPreferences((current) => ({
                        ...current,
                        preferred: value === "automatic" ? null : value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="divide-y divide-border/50">
                {EDITORS.filter(
                  (editor) => !remote || REMOTE_CAPABLE_EDITOR_IDS.includes(editor.id),
                ).map((editor) => {
                  const visibility =
                    preferences.builtIns.find((entry) => entry.id === editor.id)?.visibility ??
                    "auto";
                  return (
                    <div key={editor.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm">
                        {editorLabelForPlatform(editor.id, navigator.platform)}
                      </span>
                      <div className="w-40">
                        <EditorSelect
                          label={`${editor.label} visibility`}
                          value={visibility}
                          choices={VISIBILITY_CHOICES}
                          onChange={(value) =>
                            setPreferences((current) =>
                              setEditorVisibility(current, editor.id, value as EditorVisibility),
                            )
                          }
                        />
                      </div>
                    </div>
                  );
                })}
                {preferences.custom.map((editor) => (
                  <div key={editor.id} className="flex flex-wrap items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{editor.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {remote ? editor.remoteUrl : editor.command}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPreferences((current) => ({
                          ...current,
                          custom: current.custom.map((item) =>
                            item.id === editor.id ? { ...item, enabled: !item.enabled } : item,
                          ),
                        }))
                      }
                    >
                      {editor.enabled ? "Hide" : "Show"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(editor)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPreferences((current) => ({
                          ...current,
                          preferred: current.preferred === editor.id ? null : current.preferred,
                          custom: current.custom.filter((item) => item.id !== editor.id),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      id: `custom:${randomUUID()}`,
                      name: "",
                      command: "",
                      args: ["{path}"],
                      remoteUrl: "",
                      enabled: true,
                    })
                  }
                >
                  Add custom editor
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreferences(EMPTY_EDITOR_PREFERENCES)}
                >
                  Reset editors
                </Button>
              </div>
            </>
          )}
        </div>
      </SettingsRow>
      {editing ? (
        <CustomEditorDialog
          key={`${scope}:${editing.id}`}
          editor={editing}
          remote={remote}
          targetLabel={targetLabel}
          onClose={() => setEditing(null)}
          onSave={(editor) => {
            setPreferences((current) => ({
              ...current,
              custom: current.custom.some((item) => item.id === editor.id)
                ? current.custom.map((item) => (item.id === editor.id ? editor : item))
                : [...current.custom, editor],
            }));
            setEditing(null);
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

function CustomEditorDialog({
  editor,
  remote,
  targetLabel,
  onSave,
  onClose,
}: {
  editor: CustomEditor;
  remote: boolean;
  targetLabel: string;
  onSave: (editor: CustomEditor) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(editor);
  const [argumentsText, setArgumentsText] = useState(editor.args.join("\n"));
  const parsed = {
    ...draft,
    name: draft.name.trim(),
    command: draft.command.trim(),
    remoteUrl: draft.remoteUrl.trim(),
    args: argumentsText === "" ? [] : argumentsText.split("\n"),
  };
  const error = validateCustomEditor(parsed, remote);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!error) onSave(parsed);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Custom editor</DialogTitle>
          <DialogDescription>
            {remote
              ? `Open an editor on ${targetLabel} over SSH.`
              : `Run an editor command on ${targetLabel}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>Name</span>
              <Input
                required
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            {remote ? (
              <label className="block space-y-1.5 text-sm">
                <span>Remote URL template</span>
                <Input
                  required
                  value={draft.remoteUrl}
                  placeholder="myeditor://ssh/{host}{path}"
                  onChange={(event) => setDraft({ ...draft, remoteUrl: event.target.value })}
                />
                <span className="block text-xs text-muted-foreground">
                  Use {"{host}"} and {"{path}"}. For a path in a query parameter, use{" "}
                  {"{pathQuery}"}. Optional: {"{line}"} and {"{column}"}. Values are URL encoded.
                </span>
              </label>
            ) : (
              <>
                <label className="block space-y-1.5 text-sm">
                  <span>Executable</span>
                  <Input
                    required
                    value={draft.command}
                    placeholder="/usr/local/bin/myeditor"
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>Arguments (one per line)</span>
                  <Textarea
                    value={argumentsText}
                    onChange={(event) => setArgumentsText(event.target.value)}
                  />
                  <span className="block text-xs text-muted-foreground">
                    Use {"{path}"}, {"{line}"}, and {"{column}"}. Do not add shell quotes around
                    arguments. If {"{path}"} is omitted, it is appended.
                  </span>
                </label>
              </>
            )}
            {error ? (
              <p role="status" className="text-xs text-muted-foreground">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={error !== null}>
            Save editor
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
