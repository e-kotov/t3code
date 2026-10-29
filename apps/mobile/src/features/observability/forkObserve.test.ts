import { afterEach, expect, it, vi } from "vite-plus/test";

const config = vi.hoisted(() => ({
  extra: {} as { eas?: { projectId?: unknown }; relay?: { url: string } },
}));
const nativeImport = vi.hoisted(() => vi.fn());
vi.mock("expo-constants", () => ({ default: { expoConfig: config } }));
vi.mock("expo-observe", () => {
  nativeImport();
  throw new Error("Project ID is required to send observability metrics.");
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  nativeImport.mockClear();
  config.extra = {};
});

it.each([undefined, "", "  ", null])(
  "starts without loading native Observe when the project ID is %s",
  async (projectId) => {
    vi.stubGlobal("__DEV__", false);
    config.extra = {
      ...(projectId === undefined ? {} : { eas: { projectId } }),
      relay: { url: "https://relay.example.test" },
    };
    const startup = await import("./observe");
    expect(startup.crashReportingAvailable).toBe(false);
    await expect(startup.setCrashReportsEnabled(true)).resolves.toBeUndefined();
    const { Observe } = await import("./forkObserve");
    expect(() => Observe.reportError(new Error("render failure"))).not.toThrow();
    expect(nativeImport).not.toHaveBeenCalled();
  },
);
