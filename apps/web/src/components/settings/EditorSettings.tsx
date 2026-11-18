import { T, Var, msg, useGT, useMessages } from "gt-react";
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
  const messages = useMessages();
  const translatedChoices = choices.map((choice) => ({ ...choice, label: messages(choice.label) }));
  return (
    <Select
      value={value}
      items={translatedChoices}
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
            {messages(choice.label)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const VISIBILITY_CHOICES = [
  { value: "auto", label: msg("Automatic") },
  { value: "show", label: msg("Always show") },
  { value: "hide", label: msg("Hide") },
];

export function EditorSettings() {
  return typeof window === "undefined" ? null : <ClientEditorSettings />;
}

function ClientEditorSettings() {
  const gt = useGT();
  const messages = useMessages();
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
    { value: "remote", label: gt("Remote links on this device") },
    ...environments.map((entry) => ({
      value: entry.environmentId,
      label: gt("Local commands on {value1}", { value1: entry.label }),
    })),
  ];
  return (
    <SettingsSection id="editors" title={gt("Editors")}>
      <SettingsRow
        title={gt("Open in editor")}
        description={gt(
          "Choose which editors appear in Open in. These preferences are saved in this app or browser profile; commands are kept separately for each environment.",
        )}
      >
        <div className="space-y-4 py-3">
          <EditorSelect
            label={gt("Editor configuration target")}
            value={scope}
            choices={choices}
            onChange={(value) => {
              setScope(value);
              setEditing(null);
            }}
          />
          <p className="text-sm text-muted-foreground">
            {remote
              ? gt(
                  "Links open an editor on this device and connect to the project over SSH. Browsers cannot detect installed editors; choose Always show for the ones you use. Automatic falls back to VS Code when detection is unavailable.",
                )
              : gt(
                  "Used when opening projects locally on {targetLabel}. Remote connections use this device’s editor links instead.",
                  { targetLabel: targetLabel },
                )}
          </p>
          {!remote && !environment ? (
            <p role="status">
              <T>Select an available environment.</T>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  <T>Default editor</T>
                </span>
                <div className="min-w-48 flex-1">
                  <EditorSelect
                    label={gt("Default editor")}
                    value={
                      entries.some((entry) => entry.id === preferences.preferred)
                        ? preferences.preferred!
                        : "automatic"
                    }
                    choices={[
                      { value: "automatic", label: gt("Automatic") },
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
                        {editorLabelForPlatform(editor.id, navigator.platform, messages)}
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
                      {editor.enabled ? gt("Hide") : gt("Show")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(editor)}>
                      <T>Edit</T>
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
                      <T>Remove</T>
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
                  <T>Add custom editor</T>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreferences(EMPTY_EDITOR_PREFERENCES)}
                >
                  <T>Reset editors</T>
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
  const gt = useGT();
  const messages = useMessages();
  const [draft, setDraft] = useState(editor);
  const [argumentsText, setArgumentsText] = useState(editor.args.join("\n"));
  const parsed = {
    ...draft,
    name: draft.name.trim(),
    command: draft.command.trim(),
    remoteUrl: draft.remoteUrl.trim(),
    args: argumentsText === "" ? [] : argumentsText.split("\n"),
  };
  const error = validateCustomEditor(parsed, remote, messages);
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
          <DialogTitle>
            <T>Custom editor</T>
          </DialogTitle>
          <DialogDescription>
            {remote
              ? gt("Open an editor on {targetLabel} over SSH.", { targetLabel: targetLabel })
              : gt("Run an editor command on {targetLabel}.", { targetLabel: targetLabel })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span>
                <T>Name</T>
              </span>
              <Input
                required
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            {remote ? (
              <label className="block space-y-1.5 text-sm">
                <span>
                  <T>Remote URL template</T>
                </span>
                <Input
                  required
                  value={draft.remoteUrl}
                  placeholder="myeditor://ssh/{host}{path}"
                  onChange={(event) => setDraft({ ...draft, remoteUrl: event.target.value })}
                />
                <span className="block text-xs text-muted-foreground">
                  <T>
                    Use <Var>{"{host}"}</Var> and <Var>{"{path}"}</Var>. For a path in a query
                    parameter, use <Var>{"{pathQuery}"}</Var>. Optional: <Var>{"{line}"}</Var> and{" "}
                    <Var>{"{column}"}</Var>. Values are URL encoded.
                  </T>
                </span>
              </label>
            ) : (
              <>
                <label className="block space-y-1.5 text-sm">
                  <span>
                    <T>Executable</T>
                  </span>
                  <Input
                    required
                    value={draft.command}
                    placeholder="/usr/local/bin/myeditor"
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span>
                    <T>Arguments (one per line)</T>
                  </span>
                  <Textarea
                    value={argumentsText}
                    onChange={(event) => setArgumentsText(event.target.value)}
                  />
                  <span className="block text-xs text-muted-foreground">
                    <T>
                      Use <Var>{"{path}"}</Var>, <Var>{"{line}"}</Var>, and <Var>{"{column}"}</Var>.
                      Do not add shell quotes around arguments. If <Var>{"{path}"}</Var> is omitted,
                      it is appended.
                    </T>
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
            <T>Cancel</T>
          </Button>
          <Button type="submit" disabled={error !== null}>
            <T>Save editor</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
