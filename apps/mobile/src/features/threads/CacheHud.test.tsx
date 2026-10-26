import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { CacheHud } from "./CacheHud";

vi.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

function setup() {
  const host = document.createElement("div");
  const root = createRoot(host);
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    host,
    render: (modelLabel: string, effortLabel: string | null, compact = false) =>
      act(() =>
        root.render(
          <CacheHud
            hud={null}
            modelLabel={modelLabel}
            effortLabel={effortLabel}
            compact={compact}
          />,
        ),
      ),
    [Symbol.dispose]() {
      act(() => root.unmount());
      globals.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

it("updates the model and effort together and removes an unavailable effort", () => {
  using screen = setup();
  screen.render("gpt-6.1-sol", "High");
  expect(screen.host.textContent).toContain("High");
  screen.render("claude-opus-5-5", "Medium");
  expect(screen.host.textContent).toContain("Medium");
  expect(screen.host.textContent).not.toContain("High");
  screen.render("claude-opus-5-5", null);
  expect(screen.host.textContent).not.toContain("Medium");
  expect(screen.host.textContent).not.toBe("");
});

it("keeps the compact conversation-list HUD free of model details", () => {
  using screen = setup();
  screen.render("gpt-6.1-sol", "High", true);
  expect(screen.host.textContent).toBe("");
});
