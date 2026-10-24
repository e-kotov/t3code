import { DEVICE_COMMANDS_MAX_COUNT, type DeviceCommand } from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { SettingsPageContainer, SettingsSection } from "../components/settings/settingsLayout";
import { DEVICE_COMMAND_ICON_OPTIONS, DeviceCommandGlyph } from "./DeviceCommandGlyphs";
import {
  ensureDeviceCommandsLoaded,
  getDeviceCommandsBridge,
  moveDeviceCommand,
  newDeviceCommandId,
  reloadDeviceCommands,
  runDeviceCommand,
  saveDeviceCommands,
  useDeviceCommandsStore,
} from "./deviceCommandsStore";

export function DeviceCommandsSettings() {
  const commands = useDeviceCommandsStore((state) => state.commands);
  const loaded = useDeviceCommandsStore((state) => state.loaded);
  const loadError = useDeviceCommandsStore((state) => state.loadError);
  const storagePath = useDeviceCommandsStore((state) => state.storagePath);
  const [draft, setDraft] = useState<ReadonlyArray<DeviceCommand> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const items = draft ?? commands;
  useEffect(() => {
    ensureDeviceCommandsLoaded();
  }, []);

  async function persist(next = items) {
    setSaving(true);
    setError(null);
    // A promise handler instead of try/finally, which the React Compiler cannot compile.
    const failure = await saveDeviceCommands(next).then(
      () => null,
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    );
    setSaving(false);
    if (failure !== null) {
      setError(failure);
      return false;
    }
    setDraft(null);
    return true;
  }
  function update(id: string, patch: Partial<DeviceCommand>) {
    setDraft(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  const valid = items.every((item) => item.name.trim() && item.command.trim());
  return (
    <SettingsPageContainer>
      <SettingsSection title="Commands" id="device-commands">
        {!getDeviceCommandsBridge() ? (
          <p>
            Commands are available in the macOS and Linux desktop app. Android has its own Commands
            tab using Termux.
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Commands run in your login shell and stay on this device. Drag the handle or use the
              arrows to reorder.
            </p>
            {loadError ? (
              <div>
                <p role="alert">{loadError}</p>
                <Button variant="outline" onClick={() => void reloadDeviceCommands()}>
                  Reload commands
                </Button>
              </div>
            ) : null}
            {items.map((item, index) => (
              <div
                key={item.id}
                className="space-y-3 rounded-lg border p-4"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = items.findIndex((candidate) => candidate.id === dragId);
                  setDraft(moveDeviceCommand(items, from, index));
                  setDragId(null);
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    draggable={!saving}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => setDragId(null)}
                    aria-label="Drag to reorder"
                    className="cursor-grab"
                  >
                    <GripVerticalIcon className="size-4" />
                  </span>
                  <DeviceCommandGlyph icon={item.icon} />
                  <div className="flex-1">
                    <Input
                      aria-label="Command name"
                      value={item.name}
                      disabled={saving}
                      onChange={(event) => update(item.id, { name: event.target.value })}
                      placeholder="Command name"
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${item.name} up`}
                    disabled={saving || index === 0}
                    onClick={() => setDraft(moveDeviceCommand(items, index, index - 1))}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move ${item.name} down`}
                    disabled={saving || index === items.length - 1}
                    onClick={() => setDraft(moveDeviceCommand(items, index, index + 1))}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>Shell command</span>
                  <Textarea
                    value={item.command}
                    disabled={saving}
                    onChange={(event) => update(item.id, { command: event.target.value })}
                    placeholder="Your shell command"
                  />
                </label>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Command icon">
                  {DEVICE_COMMAND_ICON_OPTIONS.map(({ id, label, Icon }) => (
                    <Button
                      key={id}
                      size="icon-sm"
                      variant={item.icon === id ? "secondary" : "ghost"}
                      aria-label={label}
                      aria-pressed={item.icon === id}
                      disabled={saving}
                      onClick={() => update(item.id, { icon: id })}
                    >
                      <Icon />
                    </Button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={item.confirm}
                    disabled={saving}
                    onCheckedChange={(confirm) => update(item.id, { confirm })}
                  />
                  Ask before running
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={item.showInCommandPalette}
                    disabled={saving}
                    onCheckedChange={(showInCommandPalette) =>
                      update(item.id, { showInCommandPalette })
                    }
                  />
                  Show in command palette
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving || !valid || !!loadError}
                    onClick={() =>
                      void (async () => {
                        if (await persist()) await runDeviceCommand(item);
                      })()
                    }
                  >
                    Save and test run
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive-outline"
                    disabled={saving}
                    onClick={() => setDraft(items.filter((candidate) => candidate.id !== item.id))}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {error ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={
                  !loaded || saving || !!loadError || items.length >= DEVICE_COMMANDS_MAX_COUNT
                }
                onClick={() =>
                  setDraft([
                    ...items,
                    {
                      id: newDeviceCommandId("command", items),
                      name: "",
                      command: "",
                      icon: "terminal",
                      confirm: false,
                      showInCommandPalette: true,
                    },
                  ])
                }
              >
                <PlusIcon />
                Add command
              </Button>
              <Button
                disabled={!draft || saving || !valid || !!loadError}
                onClick={() => void persist()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
              {draft ? (
                <Button variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                  Discard changes
                </Button>
              ) : null}
            </div>
            {storagePath ? (
              <p className="break-all text-xs text-muted-foreground">
                Saved on this device: {storagePath}
              </p>
            ) : null}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
