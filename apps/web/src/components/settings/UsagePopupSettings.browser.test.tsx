import "~/index.css";
import { render } from "../../../test/render";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { UsagePopupSettings } from "./UsagePopupSettings";

const state = vi.hoisted(() => ({
  settings: null as any,
  updateSettings: vi.fn(),
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => state.settings) as never,
  useUpdateScopedSettings: () => state.updateSettings,
}));

function setup(overrides: Partial<typeof DEFAULT_CLIENT_SETTINGS> = {}) {
  state.settings = { ...DEFAULT_CLIENT_SETTINGS, ...overrides };
  state.updateSettings.mockClear();
}

it("toggles usage quota preview off and on", async () => {
  setup({ usagePopupEnabled: true });
  await using _screen = await render(<UsagePopupSettings />);
  const toggle = page.getByRole("switch", { name: "Usage quota preview" });
  await expect.element(toggle).toBeChecked();
  await userEvent.click(toggle);
  expect(state.updateSettings).toHaveBeenCalledWith({ usagePopupEnabled: false });
});

it("disables delay input when popup preview is toggled off", async () => {
  setup({ usagePopupEnabled: false });
  await using _screen = await render(<UsagePopupSettings />);
  const input = page.getByRole("spinbutton", { name: "Usage popup hover delay in milliseconds" });
  await expect.element(input).toBeDisabled();
});

it("commits hover delay input on blur with rounding and clamping", async () => {
  setup({ usagePopupEnabled: true, usagePopupHoverDelayMs: 300 });
  await using _screen = await render(<UsagePopupSettings />);
  const input = page.getByRole("spinbutton", { name: "Usage popup hover delay in milliseconds" });
  await expect.element(input).toHaveValue(300);

  await userEvent.clear(input);
  await userEvent.type(input, "450.6");
  await userEvent.tab();
  expect(state.updateSettings).toHaveBeenCalledWith({ usagePopupHoverDelayMs: 451 });

  state.updateSettings.mockClear();
  await userEvent.clear(input);
  await userEvent.type(input, "9999");
  await userEvent.tab();
  expect(state.updateSettings).toHaveBeenCalledWith({ usagePopupHoverDelayMs: 5000 });

  state.updateSettings.mockClear();
  await userEvent.clear(input);
  await userEvent.type(input, "-50");
  await userEvent.tab();
  expect(state.updateSettings).toHaveBeenCalledWith({ usagePopupHoverDelayMs: 0 });
});

it("commits hover delay input on Enter key", async () => {
  setup({ usagePopupEnabled: true, usagePopupHoverDelayMs: 300 });
  await using _screen = await render(<UsagePopupSettings />);
  const input = page.getByRole("spinbutton", { name: "Usage popup hover delay in milliseconds" });
  await userEvent.clear(input);
  await userEvent.type(input, "600");
  await userEvent.keyboard("{Enter}");
  expect(state.updateSettings).toHaveBeenCalledWith({ usagePopupHoverDelayMs: 600 });
});

it("restores previous value on blur when empty or whitespace", async () => {
  setup({ usagePopupEnabled: true, usagePopupHoverDelayMs: 300 });
  await using _screen = await render(<UsagePopupSettings />);
  const input = page.getByRole("spinbutton", { name: "Usage popup hover delay in milliseconds" });
  await userEvent.clear(input);
  await userEvent.tab();
  expect(state.updateSettings).not.toHaveBeenCalled();
  await expect.element(input).toHaveValue(300);
});

it("supports resetting preview toggle", async () => {
  setup({ usagePopupEnabled: false });
  await using _screen = await render(<UsagePopupSettings />);
  const resetToggle = page.getByRole("button", {
    name: "Reset usage quota preview to default",
  });
  await expect.element(resetToggle).toBeVisible();
  await userEvent.click(resetToggle);
  expect(state.updateSettings).toHaveBeenCalledWith({
    usagePopupEnabled: DEFAULT_CLIENT_SETTINGS.usagePopupEnabled,
  });
});

it("supports resetting hover delay", async () => {
  setup({ usagePopupEnabled: true, usagePopupHoverDelayMs: 600 });
  await using _screen = await render(<UsagePopupSettings />);
  const resetDelay = page.getByRole("button", {
    name: "Reset usage popup hover delay to default",
  });
  await expect.element(resetDelay).toBeVisible();
  await userEvent.click(resetDelay);
  expect(state.updateSettings).toHaveBeenCalledWith({
    usagePopupHoverDelayMs: DEFAULT_CLIENT_SETTINGS.usagePopupHoverDelayMs,
  });
});

it("hides hover delay reset button when popup is disabled", async () => {
  setup({ usagePopupEnabled: false, usagePopupHoverDelayMs: 600 });
  await using _screen = await render(<UsagePopupSettings />);
  const resetDelay = page.getByRole("button", {
    name: "Reset usage popup hover delay to default",
  });
  await expect.element(resetDelay).not.toBeInTheDocument();
});
