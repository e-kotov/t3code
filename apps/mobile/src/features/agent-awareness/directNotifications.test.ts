import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("../../state/use-remote-environment-registry", () => ({}));
vi.mock("../../state/workspace", () => ({}));
import { makeDirectNotificationConnection } from "./directNotifications";

const connection = {
  environmentId: EnvironmentId.make("environment"),
  environmentLabel: "Server",
  pairingUrl: "",
  displayUrl: "http://127.0.0.1:3773",
  httpBaseUrl: "http://127.0.0.1:3773",
  wsBaseUrl: "ws://127.0.0.1:3773/?wsTicket=old&extra=1",
  bearerToken: "test-token",
};
describe("direct notification route", () => {
  it("uses the paired SSH loopback route with protocol 2 and keeps credentials out of URLs", () => {
    expect(makeDirectNotificationConnection(connection)).toEqual({
      environmentId: "environment",
      url: "ws://127.0.0.1:3773/ws?orchestrationProtocol=2",
      token: "test-token",
    });
  });
  it("does not pass cloud DPoP tokens or unpaired routes to the native service", () => {
    expect(
      makeDirectNotificationConnection({
        ...connection,
        authenticationMethod: "dpop",
        dpopAccessToken: "cloud-token",
      }),
    ).toBeNull();
    expect(makeDirectNotificationConnection({ ...connection, bearerToken: null })).toBeNull();
    expect(makeDirectNotificationConnection({ ...connection, wsBaseUrl: "" })).toBeNull();
    expect(
      makeDirectNotificationConnection({
        ...connection,
        wsBaseUrl: "wss://user:password@example.com",
      }),
    ).toBeNull();
  });
});
