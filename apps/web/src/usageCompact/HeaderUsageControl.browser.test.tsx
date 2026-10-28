import { ProviderDriverKind } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import type { CSSProperties } from "react";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { RightPanelTabs } from "../components/RightPanelTabs";
import type { RightPanelSurface } from "../rightPanelStore";
import "../index.css";
import {
  PanelLayoutControls,
  type PanelLayoutControlsProps,
  ThreadPanelHeaderControl,
  WorkspaceTitlebarControls,
} from "../components/chat/PanelLayoutControls";

vi.mock(import("./useHeaderUsage"), () => ({
  useHeaderUsage: () => ({
    accounts: ["codex", "claudeAgent", "antigravity"].map((driver) => ({
      key: driver,
      driver: ProviderDriverKind.make(driver),
      displayName: null,
      email: undefined,
      plan: undefined,
      accentColor: undefined,
      environments: [],
      sourceLabel: null,
      redeem: null,
      limits: {
        checkedAt: "2026-10-26T11:59:00Z",
        windows: [{ id: "session", kind: "session" as const, label: "5h", usedPercent: 0 }],
      },
    })),
    drivers: new Set(["codex", "claudeAgent", "antigravity"]),
    notices: [],
    authNotices: [],
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

const workspaceVars = {
  "--workspace-topbar-height": "48px",
  "--workspace-controls-top": "0px",
  "--workspace-controls-right": "0px",
} as CSSProperties;

function MaximizablePanel() {
  const [maximized, setMaximized] = useState(false);
  const rootUsage = { showUsageControl: maximized };
  const headerUsage = { showUsageControl: !maximized };
  return (
    <div data-chat-workspace className="relative flex h-100 w-screen" style={workspaceVars}>
      <WorkspaceTitlebarControls
        showMaximizeControl
        rightPanelOpen
        animationsActive={false}
        maximized={maximized}
        onToggleMaximized={() => setMaximized((value) => !value)}
      >
        <PanelLayoutControls {...props} {...rootUsage} showThreadPanelControl={false} />
      </WorkspaceTitlebarControls>
      <div hidden={maximized} className="relative w-1/2">
        <ThreadPanelHeaderControl {...props} {...headerUsage} rightPanelOpen />
      </div>
    </div>
  );
}

it("keeps usage accessible when the inline panel maximizes and restores", async () => {
  await page.viewport(1280, 800);
  await using _screen = await render(<MaximizablePanel />);
  await expect.element(usage()).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Maximize panel" }));
  await expect.element(usage()).toBeVisible();
  await userEvent.hover(usage());
  const details = page.getByText("Quota remaining", { exact: true });
  await expect.element(details).toBeVisible();
  await commands.resetPointer();
  await expect.element(details).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Restore panel size" }));
  await expect.element(usage()).toBeVisible();
  expectBeforeThreadToggle();
});

it("keeps overflowing panel tabs scrollable beside all three usage meters when maximized", async () => {
  await page.viewport(900, 600);
  const surfaces = Array.from({ length: 12 }, (_, index): RightPanelSurface => ({
    id: `file:${index}`,
    kind: "file",
    relativePath: `long-document-${index}.ts`,
    revealLine: null,
    revealRequestId: 0,
  }));
  const noop = () => {};
  await using _screen = await render(
    <div
      data-chat-workspace
      className="relative flex h-100 w-screen [--header-usage-reserve:--spacing(56)] [--header-usage-tabs-reserve:calc(--spacing(28)+var(--header-usage-reserve))]"
      style={
        {
          "--workspace-topbar-height": "48px",
          "--workspace-controls-top": "0px",
          "--workspace-controls-right": "0px",
        } as CSSProperties
      }
    >
      <WorkspaceTitlebarControls
        showMaximizeControl
        rightPanelOpen
        animationsActive={false}
        maximized
        onToggleMaximized={noop}
      >
        <PanelLayoutControls {...props} showUsageControl showThreadPanelControl={false} />
      </WorkspaceTitlebarControls>
      <RightPanelTabs
        mode="inline"
        maximized
        open
        keybindings={compileResolvedKeybindingsConfig([])}
        getShortcutContext={() => ({
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: true,
          isWeb: true,
          isDesktop: false,
        })}
        surfaces={surfaces}
        environmentId={null}
        activeSurfaceId={surfaces[0]!.id}
        pendingSurfaceIds={new Set()}
        previewSessions={{}}
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={noop}
        onCloseSurface={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurfacesToRight={noop}
        onCloseAllSurfaces={noop}
        onCopyFilePath={noop}
        onAddBrowser={noop}
        onAddBrowserInProfile={noop}
        onAddTerminal={noop}
        onAddDiff={noop}
        onAddFiles={noop}
        onAddPullRequest={noop}
        onAddPullRequests={noop}
        onAddDevice={noop}
        browserAvailable={false}
        terminalAvailable={false}
        diffAvailable={false}
        filesAvailable={false}
        pullRequestAvailable={false}
        pullRequestsAvailable={false}
        deviceAvailable={false}
      >
        Panel content
      </RightPanelTabs>
    </div>,
  );
  const left = page.getByRole("button", { name: "Scroll tabs left", exact: true });
  const right = page.getByRole("button", { name: "Scroll tabs right", exact: true });
  await expect.element(usage()).toBeVisible();
  await expect.element(left).toBeDisabled();
  await userEvent.click(right);
  await expect.element(left).not.toBeDisabled();
});
