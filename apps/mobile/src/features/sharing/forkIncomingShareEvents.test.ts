import { describe, expect, it, vi } from "vite-plus/test";

import { subscribeForkIncomingShareEvents } from "./forkIncomingShareEvents";

const events = vi.hoisted(() => ({
  urls: new Set<(event: { url: string }) => void>(),
  resumes: new Set<() => void>(),
}));

vi.mock("expo-linking", () => ({
  addEventListener: (_type: string, listener: (event: { url: string }) => void) => {
    events.urls.add(listener);
    return { remove: () => events.urls.delete(listener) };
  },
}));

vi.mock("../../lib/appState", () => ({
  subscribeAppActive: (listener: () => void) => {
    events.resumes.add(listener);
    return () => events.resumes.delete(listener);
  },
}));

describe("incoming share events", () => {
  it.each(["t3code", "t3code-dev", "t3code-preview"])(
    "imports a %s share delivered while the app is already active",
    (scheme) => {
      const refresh = vi.fn();
      const stop = subscribeForkIncomingShareEvents(refresh);
      try {
        for (const listener of events.urls) listener({ url: `${scheme}://expo-sharing` });
        expect(refresh).toHaveBeenCalledTimes(1);
      } finally {
        stop();
      }
    },
  );

  it("still checks shares when the app resumes and ignores unrelated links", () => {
    const refresh = vi.fn();
    const stop = subscribeForkIncomingShareEvents(refresh);
    try {
      for (const url of [
        "t3code://settings/connections",
        "t3code://other/expo-sharing",
        "t3code://expo-sharing.example.com",
        "invalid url",
      ]) {
        for (const listener of events.urls) listener({ url });
      }
      expect(refresh).not.toHaveBeenCalled();
      for (const listener of events.resumes) listener();
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("removes both listeners on disposal so a remount imports once", () => {
    const oldRefresh = vi.fn();
    const stop = subscribeForkIncomingShareEvents(oldRefresh);
    stop();
    const refresh = vi.fn();
    const stopReplacement = subscribeForkIncomingShareEvents(refresh);
    try {
      for (const listener of events.urls) listener({ url: "t3code://expo-sharing" });
      expect(oldRefresh).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      stopReplacement();
    }
    expect(events.urls.size).toBe(0);
    expect(events.resumes.size).toBe(0);
  });
});
