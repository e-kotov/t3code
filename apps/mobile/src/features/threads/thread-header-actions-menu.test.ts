import { describe, expect, it, vi } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";
import {
  buildThreadHeaderActionsMenu,
  resolveThreadHeaderPlacement,
} from "./thread-header-actions-menu";

const NOW = "2026-06-01T10:00:00.000Z";
const supported = { now: NOW, settlementSupported: true, snoozeSupported: true };

function menu(overrides: Partial<Parameters<typeof buildThreadHeaderActionsMenu>[0]> = {}) {
  return buildThreadHeaderActionsMenu({
    placement: "active",
    settlementSupported: true,
    snoozeChoices: [{ id: "later-today", label: "Later today", whenLabel: "6:00 PM" }],
    titleRegeneration: "idle",
    onSettle: vi.fn(),
    onUnsettle: vi.fn(),
    onWake: vi.fn(),
    onSnooze: vi.fn(),
    onCustomSnooze: vi.fn(),
    onRename: vi.fn(),
    onRegenerateTitle: vi.fn(),
    ...overrides,
  });
}

function ids(items: ReturnType<typeof menu>["items"]): string[] {
  return items.flatMap((item) => ("items" in item ? [item.id, ...ids(item.items)] : [item.id]));
}

describe("resolveThreadHeaderPlacement", () => {
  it.each([
    [{ snoozedUntil: "2026-06-01T12:00:00.000Z" }, supported, "snoozed"],
    [{ snoozedUntil: "2026-06-01T09:00:00.000Z" }, supported, "active"],
    [{ settledOverride: "settled" as const }, supported, "settled"],
    [
      { settledOverride: "settled" as const },
      { ...supported, settlementSupported: false },
      "active",
    ],
    [{ settledOverride: "active" as const }, supported, "active"],
  ])("resolves %o", (overrides, input, expected) => {
    expect(resolveThreadHeaderPlacement(makeThreadShellFixture(overrides), input)).toBe(expected);
  });
});

describe("buildThreadHeaderActionsMenu", () => {
  it("offers settle and snooze presets on an active thread", () => {
    expect(ids(menu().items)).toEqual([
      "settle",
      "snooze",
      "snooze:later-today",
      "snooze:custom",
      "rename",
      "regenerate-title",
    ]);
  });

  it("offers each way back out of a placement", () => {
    expect(ids(menu({ placement: "settled" }).items)).toEqual([
      "unsettle",
      "rename",
      "regenerate-title",
    ]);
    expect(ids(menu({ placement: "snoozed" }).items)).toEqual([
      "unsnooze",
      "rename",
      "regenerate-title",
    ]);
  });

  it("drops actions the thread or server cannot take", () => {
    expect(
      ids(
        menu({ settlementSupported: false, snoozeChoices: null, titleRegeneration: "unsupported" })
          .items,
      ),
    ).toEqual(["rename"]);
  });

  it("routes a snooze preset to its choice and disables a running title regeneration", () => {
    const onSnooze = vi.fn();
    const built = menu({ onSnooze, titleRegeneration: "regenerating" });
    const snooze = built.items.find((item) => item.id === "snooze");
    const preset = snooze && "items" in snooze ? snooze.items[0] : undefined;
    if (preset && "onPress" in preset) preset.onPress();
    expect(onSnooze).toHaveBeenCalledWith("later-today");
    expect(built.items.at(-1)).toMatchObject({ title: "Regenerating…", disabled: true });
  });
});
