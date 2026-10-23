import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ConversationThreadListFilters } from "./ConversationThreadListFilters";
import { conversationListControls, DEFAULT_CONVERSATION_LIST_OPTIONS } from "./conversationListOptions";

vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, accessibilityLabel, onPress }: { children: ReactNode; accessibilityLabel?: string; onPress?: () => void }) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>,
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/Chip", () => ({ Chip: ({ label }: { label: string }) => <span>{label}</span> }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({ useAppearancePreferences: () => ({ themeAppearance: "light" }) }));
vi.mock("../../components/ui/Menu", () => ({
  Menu: ({ title, actions, onPressAction, children }: { title: string; actions: { id?: string; title?: string; state?: string }[]; onPressAction: (event: { nativeEvent: { event: string } }) => void; children: ReactNode }) => (
    <section aria-label={title}>{children}{actions.map((action) => <button key={action.id} data-action={action.id} aria-checked={action.state === "on"} onClick={() => onPressAction({ nativeEvent: { event: action.id ?? "" } })}>{action.title}</button>)}</section>
  ),
}));

function HomeFilters() {
  const [options, setOptions] = useState(DEFAULT_CONVERSATION_LIST_OPTIONS);
  return <ConversationThreadListFilters environments={[]} projects={[]} selectedEnvironmentId={null} selectedProjectKey={null} onEnvironmentChange={() => {}} onProjectChange={() => {}} conversationList={conversationListControls(options, setOptions)} />;
}

it("lets the iOS filter row change sort and grouping independently and return to defaults", () => {
  const reactGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  using _screen = { [Symbol.dispose]() { act(() => root.unmount()); reactGlobals.IS_REACT_ACT_ENVIRONMENT = previous; } };
  act(() => root.render(<HomeFilters />));
  const choice = (id: string) => { const button = host.querySelector<HTMLButtonElement>(`[data-action="${id}"]`); if (!button) throw new Error(`Missing ${id}`); return button; };
  act(() => choice("sort:cache_expiry").click());
  act(() => choice("grouping:machine").click());
  expect(choice("sort:cache_expiry").getAttribute("aria-checked")).toBe("true");
  expect(choice("grouping:machine").getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector('button[aria-label="Sort conversations"]')?.textContent).toBe("Cache expiry");
  expect(host.querySelector('button[aria-label="Group conversations"]')?.textContent).toBe("By machine");
  act(() => choice("sort:updated_at").click());
  expect(choice("grouping:machine").getAttribute("aria-checked")).toBe("true");
  act(() => choice("grouping:none").click());
  expect(choice("sort:updated_at").getAttribute("aria-checked")).toBe("true");
  expect(choice("grouping:none").getAttribute("aria-checked")).toBe("true");
});
