import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../test/render";
import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
  ThreadPanelHeaderControl,
} from "../components/chat/PanelLayoutControls";

vi.mock(import("./useHeaderUsage"), () => ({
  useHeaderUsage: () => ({
    accounts: [],
    drivers: new Set(["codex"]),
    notices: [],
    disconnected: false,
    onOpenFullView: () => {},
  }),
}));

const props = {
  terminalAvailable: true,
  terminalOpen: false,
  terminalShortcutLabel: null,
  threadPanelOpen: false,
  threadPanelPresentation: "inline",
  threadPanelShortcutLabel: null,
  rightPanelAvailable: true,
  rightPanelOpen: false,
  rightPanelShortcutLabel: null,
  onToggleTerminal: () => {},
  onToggleThreadPanel: () => {},
  onToggleRightPanel: () => {},
} satisfies PanelLayoutControlsProps;

const usage = () => page.getByRole("button", { name: /^Usage remaining/ });

function expectBeforeThreadToggle() {
  const toggle = page.getByRole("button", { name: "Toggle thread details panel" }).element();
  expect(
    usage().element().compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
}

it("shows one usage group left of the panel toggles with the right panel closed", async () => {
  await using _screen = await render(<PanelLayoutControls {...props} />);
  await expect.element(usage()).toBeVisible();
  expectBeforeThreadToggle();
});

it("keeps one usage group in the chat header beside an open inline panel", async () => {
  await using _screen = await render(
    <div className="relative">
      <PanelLayoutControls {...props} rightPanelOpen showThreadPanelControl={false} />
      <ThreadPanelHeaderControl {...props} rightPanelOpen />
    </div>,
  );
  await expect.element(usage()).toBeVisible();
  expectBeforeThreadToggle();
});

it("omits the usage group where no thread toggle is shown", async () => {
  await using _screen = await render(
    <PanelLayoutControls {...props} showTerminalControl={false} showThreadPanelControl={false} />,
  );
  await expect.element(page.getByRole("button", { name: "Toggle right panel" })).toBeVisible();
  await expect.element(usage()).not.toBeInTheDocument();
});
